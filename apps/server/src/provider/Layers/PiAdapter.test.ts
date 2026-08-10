import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  PiSettings,
  ApprovalRequestId,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@notcodex/contracts";
import type { PiRpcEvent } from "effect-pi-rpc/schema";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import { PiRuntime, type PiRuntimeShape } from "../piRuntime.ts";
import { makePiAdapter } from "./PiAdapter.ts";

const settings = Schema.decodeSync(PiSettings)({ enabled: true });
const threadId = ThreadId.make("pi-adapter-test");

function makeFakeRuntime(events: Queue.Queue<PiRpcEvent>) {
  const notifications: Array<Record<string, unknown>> = [];
  const commands: Array<Record<string, unknown>> = [];
  const runtime: PiRuntimeShape = {
    start: () =>
      Effect.succeed({
        pid: 42,
        exitCode: Effect.never,
        kill: Effect.void,
        client: {
          events: Stream.fromQueue(events),
          request: (command) => {
            commands.push(command);
            const data =
              command.type === "get_state"
                ? {
                    sessionId: "pi-session-1",
                    sessionFile: "/tmp/pi-session-1.jsonl",
                    model: { provider: "anthropic", id: "claude-sonnet" },
                  }
                : command.type === "get_entries"
                  ? { entries: [], leafId: "leaf-1" }
                  : command.type === "get_messages"
                    ? { messages: [] }
                    : undefined;
            return Effect.succeed({
              type: "response" as const,
              command: command.type,
              success: true,
              ...(data === undefined ? {} : { data }),
            });
          },
          notify: (command) => Effect.sync(() => notifications.push(command)),
        },
      }),
    runCommand: () => Effect.succeed({ stdout: "0.82.1\n", stderr: "", code: 0 }),
  };
  return { runtime, notifications, commands };
}

describe("PiAdapter", () => {
  it.effect("maps Pi RPC streaming and settlement into canonical events", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const nativeEvents = yield* Queue.unbounded<PiRpcEvent>();
        const fake = makeFakeRuntime(nativeEvents);
        const testLayer = Layer.mergeAll(
          Layer.succeed(PiRuntime, fake.runtime),
          ServerConfig.layerTest(process.cwd(), { prefix: "notcodex-pi-test-" }),
        ).pipe(Layer.provideMerge(NodeServices.layer));
        const adapter = yield* makePiAdapter(settings, {
          instanceId: ProviderInstanceId.make("pi_main"),
        }).pipe(Effect.provide(testLayer));
        const collected = yield* adapter.streamEvents.pipe(
          Stream.take(5),
          Stream.runCollect,
          Effect.forkScoped,
        );
        const session = yield* adapter.startSession({
          threadId,
          providerInstanceId: ProviderInstanceId.make("pi_main"),
          cwd: process.cwd(),
          runtimeMode: "approval-required",
        });
        expect(session.resumeCursor).toEqual({
          schemaVersion: 1,
          sessionId: "pi-session-1",
          sessionFile: "/tmp/pi-session-1.jsonl",
        });
        const turn = yield* adapter.sendTurn({
          threadId,
          input: "hello",
          modelSelection: {
            instanceId: ProviderInstanceId.make("pi_main"),
            model: "anthropic/claude-sonnet",
          },
        });
        yield* Queue.offer(nativeEvents, {
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hello" },
        });
        yield* Queue.offer(nativeEvents, { type: "agent_settled" });
        const canonical = yield* Fiber.join(collected);
        expect(canonical.map((event: ProviderRuntimeEvent) => event.type)).toEqual([
          "session.started",
          "thread.started",
          "turn.started",
          "content.delta",
          "turn.completed",
        ]);
        expect(canonical[3]).toMatchObject({
          turnId: turn.turnId,
          payload: { streamKind: "assistant_text", delta: "Hello" },
        });
      }),
    ),
  );

  it.effect("round-trips permission bridge decisions through extension UI", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const nativeEvents = yield* Queue.unbounded<PiRpcEvent>();
        const fake = makeFakeRuntime(nativeEvents);
        const testLayer = Layer.mergeAll(
          Layer.succeed(PiRuntime, fake.runtime),
          ServerConfig.layerTest(process.cwd(), { prefix: "notcodex-pi-test-" }),
        ).pipe(Layer.provideMerge(NodeServices.layer));
        const adapter = yield* makePiAdapter(settings).pipe(Effect.provide(testLayer));
        yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });
        const openedFiber = yield* adapter.streamEvents.pipe(
          Stream.filter((event) => event.type === "request.opened"),
          Stream.runHead,
          Effect.forkScoped,
        );
        yield* Queue.offer(nativeEvents, {
          type: "extension_ui_request",
          id: "pi-ui-1",
          method: "select",
          title:
            '{"protocol":"notcodex-pi-approval-v1","requestType":"command_execution_approval","toolName":"bash","args":{"command":"git status"}}',
          options: ["accept", "acceptForSession", "decline"],
        });
        const opened = yield* Fiber.join(openedFiber);
        expect(opened._tag).toBe("Some");
        yield* adapter.respondToRequest(
          threadId,
          ApprovalRequestId.make("pi-ui-1"),
          "acceptForSession",
        );
        expect(fake.notifications).toContainEqual({
          type: "extension_ui_response",
          id: "pi-ui-1",
          value: "acceptForSession",
        });
      }),
    ),
  );

  it.effect("marks an unrecovered Pi model error as a failed turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const nativeEvents = yield* Queue.unbounded<PiRpcEvent>();
        const fake = makeFakeRuntime(nativeEvents);
        const testLayer = Layer.mergeAll(
          Layer.succeed(PiRuntime, fake.runtime),
          ServerConfig.layerTest(process.cwd(), { prefix: "notcodex-pi-test-" }),
        ).pipe(Layer.provideMerge(NodeServices.layer));
        const adapter = yield* makePiAdapter(settings).pipe(Effect.provide(testLayer));
        const collected = yield* adapter.streamEvents.pipe(
          Stream.take(5),
          Stream.runCollect,
          Effect.forkScoped,
        );
        yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });
        yield* adapter.sendTurn({ threadId, input: "hello" });
        yield* Queue.offer(nativeEvents, {
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "error",
            errorMessage: "provider unavailable",
          },
        });
        yield* Queue.offer(nativeEvents, { type: "agent_settled" });

        const canonical = yield* Fiber.join(collected);
        expect(canonical[3]).toMatchObject({
          type: "turn.completed",
          payload: {
            state: "failed",
            stopReason: "error",
            errorMessage: "provider unavailable",
          },
        });
        expect(canonical[4]).toMatchObject({
          type: "runtime.error",
          payload: { message: "provider unavailable", class: "provider_error" },
        });
      }),
    ),
  );
});
