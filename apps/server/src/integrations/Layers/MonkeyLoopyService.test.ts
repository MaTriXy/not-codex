import * as NodeServices from "@effect/platform-node/NodeServices";
import { Journal } from "@loopyc/runtime";
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
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { TestClock } from "effect/testing";

import { ServerConfig } from "../../config.ts";
import {
  AgentHarnessError,
  AgentHarnessRunner,
} from "../../orchestration/Services/AgentHarnessRunner.ts";
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

const waitingSpec = validSpec
  .replace("id: not-codex-smoke", "id: not-codex-resume")
  .replace(
    "body:\n  - id: ask-agent",
    "body:\n  - id: approve-step\n    kind: breakpoint\n    ask: Continue this governed run?\n  - id: ask-agent",
  );

const runInput = (yaml: string) => ({
  requestId: "request-12345678",
  projectId: ProjectId.make("project-1"),
  yaml,
  inputs: {},
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "approval-required" as const,
  timeoutMinutes: 5,
});

function makeTestLayer(
  outputs: string[],
  overrides: Partial<AgentHarnessRunner["Service"]> = {},
  baseDirOrPrefix: string | { readonly prefix: string } = { prefix: "not-codex-loopy-test" },
) {
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
  const configLayer = ServerConfig.layerTest("/workspace", baseDirOrPrefix).pipe(
    Layer.provide(NodeServices.layer),
  );
  return MonkeyLoopyServiceLive.pipe(
    Layer.provide(Layer.succeed(AgentHarnessRunner, harness)),
    Layer.provide(configLayer),
    Layer.provide(NodeServices.layer),
  );
}

describe("MonkeyLoopyService", () => {
  it.effect("exposes the canonical v0.8 catalog and execution runtime", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const loopy = yield* MonkeyLoopyService;
        const context = yield* loopy.getAuthoringContext;
        const scaffold = yield* loopy.scaffold({
          id: "not-codex-health",
          recipe: "repo-health-doctor",
        });
        const validation = yield* loopy.validate({ yaml: scaffold.yaml });

        expect(context.factoryVersion).toBe("0.8.0");
        expect(context.executionVersion).toBe("0.8.0");
        expect(context.recipes.some((recipe) => recipe.name === "repo-health-doctor")).toBe(true);
        expect(context.recipes.some((recipe) => recipe.name === "verified-gauntlet")).toBe(true);
        expect(context.blueprints.some((blueprint) => blueprint.name === "gauntlet")).toBe(true);
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

  it.effect("honors cancellation handed off before runtime registration", () => {
    const prompts: string[] = [];
    const runId = IntegrationRunId.make("monkey-pre-runtime-cancel");
    return Effect.scoped(
      Effect.gen(function* () {
        const loopy = yield* MonkeyLoopyService;
        const result = yield* loopy.run(
          {
            requestId: "request-pre-runtime-cancel",
            projectId: ProjectId.make("project-1"),
            yaml: validSpec,
            inputs: {},
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
            runtimeMode: "approval-required",
            timeoutMinutes: 5,
          },
          runId,
          {
            isCancellationRequested: () => Effect.succeed(true),
            onThreadCreated: () => Effect.void,
          },
        );

        expect(result.state).toBe("cancelled");
        expect(result.threadIds).toEqual([]);
        expect(prompts).toEqual([]);
        const settled = yield* loopy.inspectRun(runId);
        expect(settled?.diagnostics).toContain(
          "Cancellation requested before runtime registration",
        );
        yield* loopy.releaseRun(runId);
      }).pipe(Effect.provide(makeTestLayer(prompts))),
    );
  });

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

  it.effect("bounds cancellation while agent thread setup remains blocked", () =>
    Effect.gen(function* () {
      const createStarted = yield* Deferred.make<void>();
      const releaseCreate = yield* Deferred.make<void>();
      const runId = IntegrationRunId.make("monkey-cancel-blocked-setup");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const loopy = yield* MonkeyLoopyService;
          const runFiber = yield* loopy
            .run(
              {
                requestId: "request-cancel-blocked-setup",
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
          yield* TestClock.adjust("250 millis");
          const cancelled = yield* Fiber.join(cancelFiber);

          expect(cancelled?.phase).toBe("stopping");
          expect(cancelled?.diagnostics).toContain(
            "Agent setup is still finishing after cancellation",
          );
          yield* Deferred.succeed(releaseCreate, undefined);
          expect((yield* Fiber.join(runFiber)).state).toBe("cancelled");
          yield* loopy.releaseRun(runId);
        }).pipe(
          Effect.provide(
            makeTestLayer([], {
              createThread: () =>
                Deferred.succeed(createStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseCreate)),
                  Effect.as(ThreadId.make("thread-blocked-setup")),
                ),
            }),
          ),
        ),
      );
    }),
  );

  it.effect("waits for startTurn before accepting or rejecting its interrupt", () => {
    const threadId = ThreadId.make("thread-start-turn-cancellation");
    return Effect.scoped(
      Effect.gen(function* () {
        const startTurnEntered = yield* Deferred.make<void>();
        const releaseStartTurn = yield* Deferred.make<void>();
        const awaitTurnEntered = yield* Deferred.make<void>();
        const releaseAwaitTurn = yield* Deferred.make<void>();
        const runId = IntegrationRunId.make("monkey-start-turn-cancellation");
        let interrupts = 0;
        const services = yield* Layer.build(
          makeTestLayer([], {
            createThread: () => Effect.succeed(threadId),
            startTurn: () =>
              Deferred.succeed(startTurnEntered, undefined).pipe(
                Effect.andThen(Deferred.await(releaseStartTurn)),
              ),
            awaitTurn: () =>
              Deferred.succeed(awaitTurnEntered, undefined).pipe(
                Effect.andThen(Deferred.await(releaseAwaitTurn)),
                Effect.as({
                  threadId,
                  turnId: TurnId.make("turn-start-turn-cancellation"),
                  state: "completed" as const,
                  output: "completed after rejected cancellation",
                }),
              ),
            interrupt: () =>
              Effect.sync(() => {
                interrupts += 1;
              }).pipe(
                Effect.andThen(
                  Effect.fail(
                    new AgentHarnessError({
                      phase: "interrupt",
                      message: "provider interrupt failed",
                      threadId,
                    }),
                  ),
                ),
              ),
          }),
        );

        yield* Effect.gen(function* () {
          const loopy = yield* MonkeyLoopyService;
          const runFiber = yield* loopy
            .run(
              {
                requestId: "request-start-turn-cancellation",
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
          yield* Deferred.await(startTurnEntered);

          const cancellationFiber = yield* loopy
            .cancelRun(runId)
            .pipe(Effect.flip, Effect.forkChild);
          yield* Effect.yieldNow;
          expect(interrupts).toBe(0);

          yield* Deferred.succeed(releaseStartTurn, undefined);
          const cancellationError = yield* Fiber.join(cancellationFiber);
          expect(cancellationError.message).toBe("Could not interrupt the active agent turn.");
          expect(interrupts).toBe(1);
          yield* Deferred.await(awaitTurnEntered);

          const activeAfterFailure = yield* loopy.inspectRun(runId);
          expect(activeAfterFailure?.phase).toBe("agent");
          expect(activeAfterFailure?.diagnostics).not.toContain("Cancellation requested");

          yield* Deferred.succeed(releaseAwaitTurn, undefined);
          const result = yield* Fiber.join(runFiber);
          expect(result.state).toBe("succeeded");
          expect(result.output).toBe("completed after rejected cancellation");
          yield* loopy.releaseRun(runId);
        }).pipe(Effect.provide(services));
      }),
    );
  });

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

  it.effect("keeps the runtime outcome when a stop request cannot be recorded", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "not-codex-loopy-stop-failure",
        });
        const turnStarted = yield* Deferred.make<void>();
        const releaseTurn = yield* Deferred.make<void>();
        const runId = IntegrationRunId.make("monkey-stop-request-failure");
        const services = yield* Layer.build(
          makeTestLayer(
            [],
            {
              interrupt: () => Effect.void,
              awaitTurn: ({ threadId }) =>
                Deferred.succeed(turnStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseTurn)),
                  Effect.as({
                    threadId,
                    turnId: TurnId.make("turn-stop-request-failure"),
                    state: "completed" as const,
                    output: "completed despite rejected cancellation",
                  }),
                ),
            },
            baseDir,
          ),
        );

        yield* Effect.gen(function* () {
          const loopy = yield* MonkeyLoopyService;
          const runFiber = yield* loopy
            .run(
              {
                requestId: "request-stop-failure",
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
          yield* Deferred.await(turnStarted);

          const journalDir = path.join(
            baseDir,
            "userdata",
            "integrations",
            "monkey-d-loopy",
            ".loopy",
            "runs",
            runId,
          );
          const journalBackup = `${journalDir}.backup`;
          yield* fileSystem.rename(journalDir, journalBackup);
          yield* fileSystem.writeFileString(journalDir, "block stop-request persistence");

          const cancellationError = yield* loopy.cancelRun(runId).pipe(Effect.flip);
          expect(cancellationError.message).toBe("Could not request a graceful Loopy stop.");

          yield* fileSystem.remove(journalDir);
          yield* fileSystem.rename(journalBackup, journalDir);
          yield* Deferred.succeed(releaseTurn, undefined);
          const result = yield* Fiber.join(runFiber);

          expect(result.state).toBe("succeeded");
          expect(result.output).toBe("completed despite rejected cancellation");
          const settled = yield* loopy.inspectRun(runId);
          expect(settled?.phase).toBe("terminal");
          expect(settled?.diagnostics).not.toContain("Cancellation requested");
          yield* loopy.releaseRun(runId);
        }).pipe(Effect.provide(services));
      }).pipe(Effect.provide(NodeServices.layer)),
    ),
  );

  it.effect("rolls back cancellation state when interrupting the provider turn fails", () => {
    const threadId = ThreadId.make("thread-interrupt-failure");
    let interrupts = 0;
    return Effect.scoped(
      Effect.gen(function* () {
        const turnStarted = yield* Deferred.make<void>();
        const releaseTurn = yield* Deferred.make<void>();
        const runId = IntegrationRunId.make("monkey-interrupt-failure");
        const services = yield* Layer.build(
          makeTestLayer([], {
            createThread: () => Effect.succeed(threadId),
            awaitTurn: () =>
              Deferred.succeed(turnStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseTurn)),
                Effect.as({
                  threadId,
                  turnId: TurnId.make("turn-interrupt-failure"),
                  state: "completed" as const,
                  output: "completed after failed interrupt",
                }),
              ),
            interrupt: () =>
              Effect.suspend(() => {
                interrupts += 1;
                return interrupts === 1
                  ? Effect.fail(
                      new AgentHarnessError({
                        phase: "interrupt",
                        message: "provider interrupt failed",
                        threadId,
                      }),
                    )
                  : Effect.void;
              }),
          }),
        );

        yield* Effect.gen(function* () {
          const loopy = yield* MonkeyLoopyService;
          const runFiber = yield* loopy
            .run(
              {
                requestId: "request-interrupt-failure",
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
          yield* Deferred.await(turnStarted);

          const cancellation = yield* loopy.cancelRun(runId).pipe(
            Effect.match({
              onFailure: (error) => ({ error }),
              onSuccess: (value) => ({ value }),
            }),
          );
          const activeAfterFailure = yield* loopy.inspectRun(runId);

          expect("error" in cancellation && cancellation.error.message).toBe(
            "Could not interrupt the active agent turn.",
          );
          expect(activeAfterFailure?.phase).toBe("agent");
          expect(activeAfterFailure?.diagnostics).not.toContain("Cancellation requested");

          const retried = yield* loopy.cancelRun(runId);
          expect(retried?.phase).toBe("stopping");
          yield* Deferred.succeed(releaseTurn, undefined);
          expect((yield* Fiber.join(runFiber)).state).toBe("cancelled");
          expect(interrupts).toBe(2);
          yield* loopy.releaseRun(runId);
        }).pipe(Effect.provide(services));
      }),
    );
  });

  it.effect("serializes overlapping cancellation attempts for the same run", () => {
    const threadId = ThreadId.make("thread-overlapping-cancellation");
    let interrupts = 0;
    return Effect.scoped(
      Effect.gen(function* () {
        const turnStarted = yield* Deferred.make<void>();
        const releaseTurn = yield* Deferred.make<void>();
        const firstInterruptEntered = yield* Deferred.make<void>();
        const releaseFirstInterrupt = yield* Deferred.make<void>();
        const runId = IntegrationRunId.make("monkey-overlapping-cancellation");
        const services = yield* Layer.build(
          makeTestLayer([], {
            createThread: () => Effect.succeed(threadId),
            awaitTurn: () =>
              Deferred.succeed(turnStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseTurn)),
                Effect.as({
                  threadId,
                  turnId: TurnId.make("turn-overlapping-cancellation"),
                  state: "completed" as const,
                  output: "cancelled by serialized retry",
                }),
              ),
            interrupt: () =>
              Effect.suspend(() => {
                interrupts += 1;
                if (interrupts === 1) {
                  return Deferred.succeed(firstInterruptEntered, undefined).pipe(
                    Effect.andThen(Deferred.await(releaseFirstInterrupt)),
                    Effect.andThen(
                      Effect.fail(
                        new AgentHarnessError({
                          phase: "interrupt",
                          message: "first interrupt failed",
                          threadId,
                        }),
                      ),
                    ),
                  );
                }
                return Effect.void;
              }),
          }),
        );

        yield* Effect.gen(function* () {
          const loopy = yield* MonkeyLoopyService;
          const runFiber = yield* loopy
            .run(
              {
                requestId: "request-overlapping-cancellation",
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
          yield* Deferred.await(turnStarted);

          const firstCancellation = yield* loopy
            .cancelRun(runId)
            .pipe(Effect.flip, Effect.forkChild);
          yield* Deferred.await(firstInterruptEntered);
          const secondCancellation = yield* loopy.cancelRun(runId).pipe(Effect.forkChild);
          yield* Effect.yieldNow;
          expect(interrupts).toBe(1);

          yield* Deferred.succeed(releaseFirstInterrupt, undefined);
          const firstError = yield* Fiber.join(firstCancellation);
          expect(firstError.message).toBe("Could not interrupt the active agent turn.");

          const retried = yield* Fiber.join(secondCancellation);
          expect(retried?.phase).toBe("stopping");
          expect(retried?.diagnostics).toContain("Cancellation requested");
          expect(interrupts).toBe(2);

          yield* Deferred.succeed(releaseTurn, undefined);
          expect((yield* Fiber.join(runFiber)).state).toBe("cancelled");
          yield* loopy.releaseRun(runId);
        }).pipe(Effect.provide(services));
      }),
    );
  });

  it.effect("resumes the same verified journal without duplicating run start", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const loopy = yield* MonkeyLoopyService;
        const id = IntegrationRunId.make("monkey-resume-journal");
        const input = runInput(waitingSpec);
        const first = yield* loopy.run(input, id);
        yield* loopy.releaseRun(id);

        expect(first.state).toBe("waiting");
        yield* loopy.verifyJournal(input, id, false);
        const resumed = yield* loopy.resume(input, id, false);
        yield* loopy.releaseRun(id);

        const base = first.journalPath.replace(`/.loopy/runs/${id}`, "");
        const events = new Journal(base, id).load();
        expect(resumed.runId).toBe(id);
        expect(resumed.state).toBe("waiting");
        expect(events.filter((event) => event.type === "run_start")).toHaveLength(1);
      }).pipe(Effect.provide(makeTestLayer([]))),
    ),
  );

  it.effect("rejects terminal, missing, foreign, and corrupt journals with stable errors", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const loopy = yield* MonkeyLoopyService;
        const fileSystem = yield* FileSystem.FileSystem;
        const id = IntegrationRunId.make("monkey-terminal-journal");
        const input = runInput(validSpec);
        const run = yield* loopy.run(input, id);
        yield* loopy.releaseRun(id);

        const terminal = yield* loopy.verifyJournal(input, id, false).pipe(Effect.flip);
        expect(terminal.code).toBe("run-not-recoverable");
        yield* loopy.verifyJournal(input, id, true);

        const foreign = yield* loopy
          .verifyJournal(
            { ...input, yaml: validSpec.replace("id: not-codex-smoke", "id: foreign-loop") },
            id,
            true,
          )
          .pipe(Effect.flip);
        expect(foreign.code).toBe("journal-invalid");

        const missing = yield* loopy
          .verifyJournal(input, IntegrationRunId.make("monkey-missing-journal"), false)
          .pipe(Effect.flip);
        expect(missing.code).toBe("journal-invalid");
        expect(missing.message).not.toContain("/workspace");
        yield* loopy.verifyJournal(
          input,
          IntegrationRunId.make("monkey-missing-journal"),
          true,
          true,
        );

        const eventsPath = `${run.journalPath}/events.jsonl`;
        const lines = (yield* fileSystem.readFileString(eventsPath)).trimEnd().split("\n");
        lines[0] = lines[0]!.replace(/"checksum":"[^"]+"/, `"checksum":"${"0".repeat(64)}"`);
        yield* fileSystem.writeFileString(eventsPath, `${lines.join("\n")}\n`);
        const corrupt = yield* loopy.verifyJournal(input, id, true).pipe(Effect.flip);
        expect(corrupt.code).toBe("journal-invalid");
        const corruptWithMissingAllowed = yield* loopy
          .verifyJournal(input, id, true, true)
          .pipe(Effect.flip);
        expect(corruptWithMissingAllowed.code).toBe("journal-invalid");
      }).pipe(Effect.provide(Layer.merge(makeTestLayer([]), NodeServices.layer))),
    ),
  );
});
