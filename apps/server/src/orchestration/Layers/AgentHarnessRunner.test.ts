import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationThread,
  type OrchestrationThreadShell,
} from "@notcodex/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { AgentHarnessRunner } from "../Services/AgentHarnessRunner.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { AgentHarnessRunnerLive } from "./AgentHarnessRunner.ts";

const timestamp = "2026-07-17T00:00:00.000Z";
const projectId = ProjectId.make("project-1");
const turnId = TurnId.make("turn-1");
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5",
};

function makeShell(
  threadId: ThreadId,
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell {
  return {
    id: threadId,
    projectId,
    title: "Integration run",
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: {
      turnId,
      state: "completed",
      requestedAt: timestamp,
      startedAt: timestamp,
      completedAt: timestamp,
      assistantMessageId: MessageId.make("message-1"),
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    session: null,
    latestUserMessageAt: timestamp,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function makeDetail(threadId: ThreadId): OrchestrationThread {
  return {
    ...makeShell(threadId),
    deletedAt: null,
    messages: [
      {
        id: MessageId.make("message-1"),
        role: "assistant",
        text: "finished from Not Codex",
        turnId,
        streaming: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
  };
}

function makeHarnessLayer(input: {
  readonly commands: OrchestrationCommand[];
  readonly shell: (threadId: ThreadId) => OrchestrationThreadShell;
}) {
  let randomByte = 0;
  const dependencies = Layer.mergeAll(
    Layer.succeed(
      Crypto.Crypto,
      Crypto.make({
        randomBytes: (size) => {
          randomByte += 1;
          return new Uint8Array(size).fill(randomByte);
        },
        digest: (_algorithm, data) => Effect.succeed(data),
      }),
    ),
    Layer.succeed(OrchestrationEngineService, {
      readEvents: () => Stream.empty,
      dispatch: (command) =>
        Effect.sync(() => {
          input.commands.push(command);
          return { sequence: input.commands.length };
        }),
      streamDomainEvents: Stream.empty,
    }),
    Layer.succeed(ProjectionSnapshotQuery, {
      getCommandReadModel: () => Effect.die("unused"),
      getSnapshot: () => Effect.die("unused"),
      getShellSnapshot: () => Effect.die("unused"),
      getArchivedShellSnapshot: () => Effect.die("unused"),
      getSnapshotSequence: () => Effect.die("unused"),
      getCounts: () => Effect.die("unused"),
      getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
      getProjectShellById: () => Effect.succeed(Option.none()),
      getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
      getThreadCheckpointContext: () => Effect.succeed(Option.none()),
      getFullThreadDiffContext: () => Effect.succeed(Option.none()),
      getThreadShellById: (threadId) => Effect.succeed(Option.some(input.shell(threadId))),
      getThreadDetailById: (threadId) => Effect.succeed(Option.some(makeDetail(threadId))),
      getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
    }),
  );
  return AgentHarnessRunnerLive.pipe(Layer.provide(dependencies));
}

describe("AgentHarnessRunner", () => {
  it.effect(
    "creates an ordinary thread, starts a turn, and returns the final assistant output",
    () => {
      const commands: OrchestrationCommand[] = [];
      return Effect.gen(function* () {
        const harness = yield* AgentHarnessRunner;
        const result = yield* harness.run({
          projectId,
          title: "[Integration] Loopy run",
          prompt: "Perform the next bounded loop step.",
          modelSelection,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          timeoutMs: 5_000,
          approvalHandling: "fail",
        });

        expect(commands.map((command) => command.type)).toEqual([
          "thread.create",
          "thread.turn.start",
        ]);
        expect(result.output).toBe("finished from Not Codex");
        expect(result.state).toBe("completed");
      }).pipe(Effect.provide(makeHarnessLayer({ commands, shell: (id) => makeShell(id) })));
    },
  );

  it.effect("fails closed when an unattended integration turn requests approval", () => {
    const commands: OrchestrationCommand[] = [];
    const threadId = ThreadId.make("thread-approval");
    return Effect.gen(function* () {
      const harness = yield* AgentHarnessRunner;
      const error = yield* harness
        .awaitTurn({ threadId, timeoutMs: 5_000, approvalHandling: "fail" })
        .pipe(Effect.flip);

      expect(error.phase).toBe("waiting-for-input");
      expect(error.message).toContain("approval");
    }).pipe(
      Effect.provide(
        makeHarnessLayer({
          commands,
          shell: (id) => makeShell(id, { hasPendingApprovals: true }),
        }),
      ),
    );
  });

  it.effect("interrupts a provider turn when a managed run pauses for approval", () => {
    const commands: OrchestrationCommand[] = [];
    return Effect.gen(function* () {
      const harness = yield* AgentHarnessRunner;
      const error = yield* harness
        .run({
          projectId,
          title: "[Integration] unattended run",
          prompt: "Complete one safe step.",
          modelSelection,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          timeoutMs: 5_000,
          approvalHandling: "fail",
        })
        .pipe(Effect.flip);

      expect(error.phase).toBe("waiting-for-input");
      expect(commands.map((command) => command.type)).toEqual([
        "thread.create",
        "thread.turn.start",
        "thread.turn.interrupt",
      ]);
    }).pipe(
      Effect.provide(
        makeHarnessLayer({
          commands,
          shell: (id) => makeShell(id, { hasPendingApprovals: true }),
        }),
      ),
    );
  });

  it.effect("interrupts a provider turn when a managed run times out", () => {
    const commands: OrchestrationCommand[] = [];
    return Effect.gen(function* () {
      const harness = yield* AgentHarnessRunner;
      const runFiber = yield* harness
        .run({
          projectId,
          title: "[Integration] timed run",
          prompt: "Complete one bounded step.",
          modelSelection,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          timeoutMs: 500,
          approvalHandling: "fail",
        })
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("1 second");
      const error = yield* Fiber.join(runFiber).pipe(Effect.flip);

      expect(error.phase).toBe("timeout");
      expect(commands.map((command) => command.type)).toEqual([
        "thread.create",
        "thread.turn.start",
        "thread.turn.interrupt",
      ]);
    }).pipe(
      Effect.provide(
        makeHarnessLayer({
          commands,
          shell: (id) =>
            makeShell(id, {
              latestTurn: {
                ...makeShell(id).latestTurn!,
                state: "running",
                completedAt: null,
                assistantMessageId: null,
              },
            }),
        }),
      ),
    );
  });
});
