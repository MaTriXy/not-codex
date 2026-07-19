import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  IntegrationRunId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@notcodex/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../../config.ts";
import { AgentHarnessRunner } from "../../orchestration/Services/AgentHarnessRunner.ts";
import { MonkeyLoopyService } from "../Services/MonkeyLoopyService.ts";
import { MonkeyLoopyServiceLive } from "./MonkeyLoopyService.ts";

const validSpec = `
loopspec: "0.1"
id: not-codex-smoke
meta:
  name: Not Codex smoke loop
pattern: react
state:
  store: journal
  vars:
    agent_runs: { type: int, init: 0 }
body:
  - id: ask-agent
    kind: agent
    harness: not-codex
    prompt: Complete one safe step.
    on_done: { incr: agent_runs }
terminate:
  signal: state-predicate
  until: "\${state.agent_runs >= 1}"
caps:
  max_iterations: 2
  on_cap_exceeded: fail
schedule: { mode: manual }
`;

function makeTestLayer(outputs: string[], overrides: Partial<AgentHarnessRunner["Service"]> = {}) {
  const harness = AgentHarnessRunner.of({
    createThread: () => Effect.succeed(ThreadId.make("thread-loopy-1")),
    startTurn: (request) => Effect.sync(() => void outputs.push(request.prompt)),
    interrupt: () => Effect.die("unused"),
    awaitTurn: ({ threadId }) =>
      Effect.succeed({
        threadId,
        turnId: TurnId.make("turn-loopy-1"),
        state: "completed" as const,
        output: "safe step complete",
      }),
    run: () => Effect.die("unused"),
    ...overrides,
  });
  const configLayer = ServerConfig.layerTest("/workspace", { prefix: "not-codex-loopy-test" }).pipe(
    Layer.provide(NodeServices.layer),
  );
  return MonkeyLoopyServiceLive.pipe(
    Layer.provide(Layer.succeed(AgentHarnessRunner, harness)),
    Layer.provide(configLayer),
    Layer.provide(NodeServices.layer),
  );
}

describe("MonkeyLoopyService", () => {
  it.effect("exposes the canonical v0.5 catalog and execution runtime", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const loopy = yield* MonkeyLoopyService;
        const context = yield* loopy.getAuthoringContext;
        const scaffold = yield* loopy.scaffold({
          id: "not-codex-health",
          recipe: "repo-health-doctor",
        });
        const validation = yield* loopy.validate({ yaml: scaffold.yaml });

        expect(context.factoryVersion).toBe("0.5.0");
        expect(context.executionVersion).toBe("0.5.0");
        expect(context.recipes.some((recipe) => recipe.name === "repo-health-doctor")).toBe(true);
        expect(scaffold.yaml).toContain("id: not-codex-health");
        expect(scaffold.yaml).toContain("name: repo-health-doctor");
        expect(validation.valid).toBe(true);
        expect(validation.executionReady).toBe(false);
      }).pipe(Effect.provide(makeTestLayer([]))),
    ),
  );

  it.effect("infers a draft without executing the source", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const loopy = yield* MonkeyLoopyService;
        const inferred = yield* loopy.infer({
          filename: "watch.sh",
          source: "#!/bin/sh\nwhile curl -fsS https://example.test/status; do sleep 5; done",
        });

        expect(inferred.kind).toBe("bash");
        expect(inferred.candidatePattern).toBe("poll-until");
        expect(inferred.draftYaml).toContain('loopspec: "0.1"');
      }).pipe(Effect.provide(makeTestLayer([]))),
    ),
  );

  it.effect("marks agent harnesses that bypass Not Codex as not execution-ready", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const loopy = yield* MonkeyLoopyService;
        const result = yield* loopy.validate({
          yaml: validSpec.replace("harness: not-codex", "harness: claude-code"),
        });

        expect(result.valid).toBe(true);
        expect(result.executionReady).toBe(false);
        expect(result.diagnostics.some((item) => item.message.includes("not allowed"))).toBe(true);
      }).pipe(Effect.provide(makeTestLayer([]))),
    ),
  );

  it.effect(
    "runs a verified loop through the shared Not Codex harness and returns its journal",
    () => {
      const prompts: string[] = [];
      const observedThreads: ThreadId[] = [];
      return Effect.scoped(
        Effect.gen(function* () {
          const loopy = yield* MonkeyLoopyService;
          const validation = yield* loopy.validate({ yaml: validSpec });
          const run = yield* loopy.run(
            {
              requestId: "request-12345678",
              projectId: ProjectId.make("project-1"),
              yaml: validSpec,
              inputs: {},
              modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
              runtimeMode: "approval-required",
              timeoutMinutes: 5,
            },
            undefined,
            {
              onThreadCreated: (threadId) => Effect.sync(() => void observedThreads.push(threadId)),
            },
          );
          expect(validation.valid).toBe(true);
          expect(validation.verified).toBe(true);
          expect(validation.executionReady).toBe(true);
          expect(prompts).toEqual(["Complete one safe step."]);
          expect(run.state).toBe("succeeded");
          expect(run.output).toBe("safe step complete");
          expect(run.threadIds).toEqual([ThreadId.make("thread-loopy-1")]);
          expect(observedThreads).toEqual([ThreadId.make("thread-loopy-1")]);
          expect(run.journalPath).toContain("integrations/monkey-d-loopy/.loopy/runs/monkey-");
        }).pipe(Effect.provide(makeTestLayer(prompts))),
      );
    },
  );

  it.effect("does not start a provider turn when cancellation lands during thread setup", () =>
    Effect.gen(function* () {
      const createStarted = yield* Deferred.make<void>();
      const releaseCreate = yield* Deferred.make<void>();
      const threadId = ThreadId.make("thread-cancel-during-setup");
      const runId = IntegrationRunId.make("monkey-cancel-during-setup");
      let starts = 0;
      let interrupts = 0;

      yield* Effect.scoped(
        Effect.gen(function* () {
          const loopy = yield* MonkeyLoopyService;
          const runFiber = yield* loopy
            .run(
              {
                requestId: "request-cancel-setup",
                projectId: ProjectId.make("project-1"),
                yaml: validSpec,
                inputs: {},
                modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
                runtimeMode: "approval-required",
                timeoutMinutes: 5,
              },
              runId,
            )
            .pipe(Effect.forkChild);
          yield* Deferred.await(createStarted);

          const cancelFiber = yield* loopy.cancelRun(runId).pipe(Effect.forkChild);
          yield* Effect.yieldNow;
          expect(starts).toBe(0);
          yield* Deferred.succeed(releaseCreate, undefined);

          const [cancelled, result] = yield* Effect.all([
            Fiber.join(cancelFiber),
            Fiber.join(runFiber),
          ]);
          expect(cancelled?.phase).toBe("stopping");
          expect(cancelled?.progress.linkedThreadIds).toEqual([threadId]);
          expect(result.state).toBe("cancelled");
          expect(starts).toBe(0);
          expect(interrupts).toBe(0);
          yield* loopy.releaseRun(runId);
        }).pipe(
          Effect.provide(
            makeTestLayer([], {
              createThread: () =>
                Deferred.succeed(createStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseCreate)),
                  Effect.as(threadId),
                ),
              startTurn: () =>
                Effect.sync(() => {
                  starts += 1;
                }),
              interrupt: () =>
                Effect.sync(() => {
                  interrupts += 1;
                }),
            }),
          ),
        ),
      );
    }),
  );

  it.effect("does not cancel a runtime that already reached terminal", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const loopy = yield* MonkeyLoopyService;
        const runId = IntegrationRunId.make("monkey-already-terminal");
        const result = yield* loopy.run(
          {
            requestId: "request-already-terminal",
            projectId: ProjectId.make("project-1"),
            yaml: validSpec,
            inputs: {},
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
            runtimeMode: "approval-required",
            timeoutMinutes: 5,
          },
          runId,
        );

        const settled = yield* loopy.cancelRun(runId);

        expect(result.state).toBe("succeeded");
        expect(settled?.phase).toBe("terminal");
        expect(settled?.diagnostics).not.toContain("Cancellation requested");
        yield* loopy.releaseRun(runId);
      }).pipe(Effect.provide(makeTestLayer([]))),
    ),
  );
});
