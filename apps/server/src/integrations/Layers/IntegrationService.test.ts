import { describe, expect, it } from "@effect/vitest";
import {
  IntegrationRequestError,
  IntegrationRunId,
  type IntegrationRun,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import {
  IntegrationRunRepository,
  type IntegrationRunRepositoryShape,
  legalPreviousIntegrationRunStates,
} from "../../persistence/Services/IntegrationRunRepository.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { IntegrationService } from "../Services/IntegrationService.ts";
import { LoopAnyConnector } from "../Services/LoopAnyConnector.ts";
import { MonkeyLoopyService } from "../Services/MonkeyLoopyService.ts";
import {
  decodeMonkeyLoopyRecoveryCapsule,
  encodeMonkeyLoopyRecoveryCapsule,
  makeMonkeyLoopyRecoveryCapsule,
  monkeyLoopyRecoverySecretName,
} from "../monkeyLoopyRecovery.ts";
import { INTERRUPTED_INTEGRATION_RUN_FAILURE } from "../integrationRun.ts";
import { IntegrationServiceLive } from "./IntegrationService.ts";

function makeTestLayer(
  options: {
    repository?: IntegrationRunRepositoryShape;
    run?: MonkeyLoopyService["Service"]["run"];
    resume?: MonkeyLoopyService["Service"]["resume"];
    verifyJournal?: MonkeyLoopyService["Service"]["verifyJournal"];
    validate?: MonkeyLoopyService["Service"]["validate"];
    inspectRun?: MonkeyLoopyService["Service"]["inspectRun"];
    cancelRun?: MonkeyLoopyService["Service"]["cancelRun"];
    releaseRun?: MonkeyLoopyService["Service"]["releaseRun"];
    storedSecrets?: Map<string, Uint8Array>;
  } = {},
) {
  const stored = options.storedSecrets ?? new Map<string, Uint8Array>();
  const secrets = ServerSecretStore.of({
    get: (name) => Effect.sync(() => Option.fromNullishOr(stored.get(name))),
    set: (name, value) => Effect.sync(() => void stored.set(name, value)),
    create: (name, value) => Effect.sync(() => void stored.set(name, value)),
    getOrCreateRandom: (name, bytes) =>
      Effect.sync(() => {
        const existing = stored.get(name);
        if (existing) return existing;
        const created = new Uint8Array(bytes);
        stored.set(name, created);
        return created;
      }),
    remove: (name) => Effect.sync(() => void stored.delete(name)),
  });
  return IntegrationServiceLive.pipe(
    Layer.provide(
      Layer.succeed(
        IntegrationRunRepository,
        IntegrationRunRepository.of(
          options.repository ?? {
            insert: () => Effect.void,
            insertIfAbsent: () => Effect.succeed(true),
            get: () => Effect.succeed(Option.none()),
            list: () => Effect.succeed([]),
            transition: () => Effect.succeed(true),
            recoverMonkeyLoopy: () => Effect.succeed(true),
            pruneCompletedBefore: () => Effect.succeed([]),
          },
        ),
      ),
    ),
    Layer.provide(Layer.succeed(ServerSecretStore, secrets)),
    Layer.provide(ServerSettingsService.layerTest()),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      Layer.succeed(
        LoopAnyConnector,
        LoopAnyConnector.of({
          pollOnce: Effect.succeed(0),
          status: Effect.succeed({
            state: "disconnected",
            lastActivityAt: null,
            error: null,
            inFlight: 0,
          }),
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        MonkeyLoopyService,
        MonkeyLoopyService.of({
          getAuthoringContext: Effect.die("unused"),
          scaffold: () => Effect.die("unused"),
          infer: () => Effect.die("unused"),
          validate:
            options.validate ??
            (() =>
              Effect.succeed({
                valid: true,
                verified: true,
                executionReady: true,
                score: 100,
                name: "Test loop",
                factoryVersion: "0.5.0",
                executionVersion: "0.5.0",
                diagnostics: [],
              })),
          run: options.run ?? (() => Effect.die("unused")),
          resume: options.resume ?? (() => Effect.die("unused")),
          verifyJournal: options.verifyJournal ?? (() => Effect.void),
          inspectRun: options.inspectRun ?? (() => Effect.succeed(null)),
          cancelRun: options.cancelRun ?? (() => Effect.succeed(null)),
          releaseRun: options.releaseRun ?? (() => Effect.void),
        }),
      ),
    ),
  );
}

function makeMemoryRunRepository() {
  const records = new Map<string, IntegrationRun>();
  const repository: IntegrationRunRepositoryShape = {
    insert: (run) => Effect.sync(() => void records.set(run.id, run)),
    insertIfAbsent: (run) =>
      Effect.sync(() => {
        if (records.has(run.id)) return false;
        records.set(run.id, run);
        return true;
      }),
    get: (id) => Effect.sync(() => Option.fromNullishOr(records.get(id))),
    list: (input) =>
      Effect.sync(() =>
        [...records.values()]
          .filter((run) => input.source === undefined || run.source === input.source)
          .filter((run) => input.state === undefined || run.state === input.state)
          .filter((run) => input.projectId === undefined || run.projectId === input.projectId)
          .filter(
            (run) =>
              input.cursor === undefined ||
              run.createdAt < input.cursor.createdAt ||
              (run.createdAt === input.cursor.createdAt && run.id < input.cursor.id),
          )
          .sort((left, right) => {
            const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
            return byCreatedAt === 0 ? right.id.localeCompare(left.id) : byCreatedAt;
          })
          .slice(0, input.limit + 1),
      ),
    transition: (run, from) =>
      Effect.sync(() => {
        const current = records.get(run.id);
        const legalPreviousStates = new Set<IntegrationRun["state"]>(
          legalPreviousIntegrationRunStates(run.state),
        );
        if (!current || !from.includes(current.state) || !legalPreviousStates.has(current.state)) {
          return false;
        }
        records.set(run.id, run);
        return true;
      }),
    recoverMonkeyLoopy: (run, expected) =>
      Effect.sync(() => {
        const current = records.get(run.id);
        if (
          !current ||
          current.source !== "monkey-d-loopy" ||
          run.state !== "running" ||
          current.state !== expected.state ||
          current.failure !== expected.failure
        ) {
          return false;
        }
        records.set(run.id, run);
        return true;
      }),
    pruneCompletedBefore: (before) =>
      Effect.sync(() => {
        const pruned: IntegrationRunId[] = [];
        const referencedParentIds = new Set(
          [...records.values()].flatMap((run) =>
            run.parentRunId === null ? [] : [run.parentRunId],
          ),
        );
        for (const [id, run] of records) {
          if (
            run.completedAt !== null &&
            ["succeeded", "failed", "cancelled"].includes(run.state) &&
            run.completedAt < before &&
            !referencedParentIds.has(run.id)
          ) {
            records.delete(id);
            pruned.push(IntegrationRunId.make(id));
          }
        }
        return pruned;
      }),
  };
  return { records, repository };
}

function makeExpiredRun(id: string): IntegrationRun {
  return {
    id: IntegrationRunId.make(id),
    source: "monkey-d-loopy",
    state: "succeeded",
    projectId: runInput.projectId,
    parentRunId: null,
    attempt: 0,
    threadIds: [],
    journalRef: null,
    outputSummary: "expired summary",
    failure: null,
    verification: null,
    timeline: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    startedAt: "2020-01-01T00:00:00.000Z",
    completedAt: "2020-01-01T00:01:00.000Z",
    updatedAt: "2020-01-01T00:01:00.000Z",
  };
}

function makeOrphanedRun(id: string, state: "queued" | "running"): IntegrationRun {
  return {
    id: IntegrationRunId.make(id),
    source: "monkey-d-loopy",
    state,
    projectId: runInput.projectId,
    parentRunId: null,
    attempt: 0,
    threadIds: [],
    journalRef: null,
    outputSummary: null,
    failure: null,
    verification: null,
    timeline: [],
    createdAt: "2030-01-01T00:00:00.000Z",
    startedAt: state === "running" ? "2030-01-01T00:00:01.000Z" : null,
    completedAt: null,
    updatedAt: "2030-01-01T00:00:01.000Z",
  };
}

const runInput = {
  requestId: "request-12345678",
  projectId: ProjectId.make("project-1"),
  yaml: "loopspec: 0.5",
  inputs: {},
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "approval-required" as const,
  timeoutMinutes: 5,
};
const RETENTION_TEST_NOW_MS = 2_000_000_000_000;

const storedRun = (
  id: string,
  state: IntegrationRun["state"],
  overrides: Partial<IntegrationRun> = {},
): IntegrationRun => ({
  id,
  source: "monkey-d-loopy",
  state,
  projectId: ProjectId.make("project-1"),
  parentRunId: null,
  attempt: 0,
  threadIds: [],
  journalRef: null,
  outputSummary: null,
  failure: null,
  verification: null,
  timeline: [
    { sequence: 0, state: "queued", occurredAt: "2026-07-19T10:00:00.000Z", summary: "Run queued" },
  ],
  createdAt: "2026-07-19T10:00:00.000Z",
  startedAt: state === "queued" ? null : "2026-07-19T10:00:01.000Z",
  completedAt: ["succeeded", "failed", "cancelled"].includes(state)
    ? "2026-07-19T10:00:02.000Z"
    : null,
  updatedAt: "2026-07-19T10:00:01.000Z",
  ...overrides,
});

const liveSnapshot = {
  live: true,
  phase: "agent" as const,
  recoverable: false,
  progress: {
    agentCallsStarted: 1,
    agentCallsCompleted: 0,
    activeStep: "Not Codex agent turn",
    activeThreadId: ThreadId.make("thread-active"),
    linkedThreadIds: [ThreadId.make("thread-active")],
  },
  caps: {
    maxIterations: 4,
    noProgressMaxRepeats: 2,
    tokenBudget: 2_000,
    usdBudget: 1,
    wallclockBudget: "10m",
    onCapExceeded: "fail" as const,
  },
  diagnostics: ["Runtime prepared"],
};

describe("IntegrationService", () => {
  it.effect("stores the LoopAny token separately and only exposes configured state", () =>
    Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const configured = yield* integrations.configureLoopAny({
        settings: {
          enabled: true,
          serverUrl: "https://loop.example/",
          allowedRoots: ["/workspace"],
        },
        token: "device-secret",
      });
      const result = { configured, listed: yield* integrations.list };

      expect(result.configured.settings.serverUrl).toBe("https://loop.example");
      expect(result.configured.tokenConfigured).toBe(true);
      expect(result.configured).not.toHaveProperty("token");
      expect(result.configured.settings).not.toHaveProperty("token");
      const loopAny = result.listed.integrations.find((item) => item.id === "loopany");
      const monkey = result.listed.integrations.find((item) => item.id === "monkey-d-loopy");
      expect(loopAny?.tokenConfigured).toBe(true);
      expect(loopAny?.state).toBe("disconnected");
      expect(monkey?.version).toBe("0.5.0");
      expect(monkey?.capabilities).toEqual(
        expect.arrayContaining(["author", "recipes", "infer", "validate", "verify", "run"]),
      );
    }).pipe(Effect.provide(makeTestLayer())),
  );

  it.effect("rejects enabling LoopAny without an allowed root", () =>
    Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const error = yield* integrations
        .configureLoopAny({
          settings: { enabled: true, serverUrl: "https://loop.example" },
          token: "device-secret",
        })
        .pipe(Effect.flip);

      expect(error.code).toBe("invalid-config");
      expect(error.message).toContain("allowed project root");
    }).pipe(Effect.provide(makeTestLayer())),
  );

  it.effect("rejects LoopAny server URLs with embedded credentials", () =>
    Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const error = yield* integrations
        .configureLoopAny({
          settings: { serverUrl: "https://user:password@loop.example" },
        })
        .pipe(Effect.flip);

      expect(error.code).toBe("invalid-config");
      expect(error.message).toContain("embedded credentials");
    }).pipe(Effect.provide(makeTestLayer())),
  );

  it.effect(
    "does not remove the token when an invalid enabled configuration tries to clear it",
    () =>
      Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        yield* integrations.configureLoopAny({
          settings: {
            enabled: true,
            serverUrl: "https://loop.example",
            allowedRoots: ["/workspace"],
          },
          token: "device-secret",
        });
        const error = yield* integrations
          .configureLoopAny({ settings: {}, clearToken: true })
          .pipe(Effect.flip);
        const result = { error, listed: yield* integrations.list };

        expect(result.error.code).toBe("not-configured");
        const loopAny = result.listed.integrations.find((item) => item.id === "loopany");
        expect(loopAny?.tokenConfigured).toBe(true);
      }).pipe(Effect.provide(makeTestLayer())),
  );

  it.effect("disables LoopAny before removing its saved token", () =>
    Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      yield* integrations.configureLoopAny({
        settings: {
          enabled: true,
          serverUrl: "https://loop.example",
          allowedRoots: ["/workspace"],
        },
        token: "device-secret",
      });
      const cleared = yield* integrations.configureLoopAny({
        settings: { enabled: false },
        clearToken: true,
      });
      const listed = yield* integrations.list;
      const loopAny = listed.integrations.find((item) => item.id === "loopany");

      expect(cleared.settings.enabled).toBe(false);
      expect(cleared.tokenConfigured).toBe(false);
      expect(loopAny?.state).toBe("disabled");
      expect(loopAny?.tokenConfigured).toBe(false);
    }).pipe(Effect.provide(makeTestLayer())),
  );

  it.effect("returns a durable Loopy launch before background execution completes", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const result = yield* integrations.runMonkeyLoopy(runInput);
      expect(result.created).toBe(true);
      expect(result.run.state).toBe("queued");
      yield* Effect.yieldNow;
      const stored = memory.records.get(result.run.id);

      expect(stored?.state).toBe("succeeded");
      expect(stored?.projectId).toBe(runInput.projectId);
      expect(stored?.threadIds).toEqual([ThreadId.make("thread-1")]);
      expect(stored?.completedAt).not.toBeNull();
      expect(stored?.timeline.map((event) => event.state)).toEqual([
        "queued",
        "running",
        "succeeded",
      ]);
      expect(stored?.verification?.executionReady).toBe(true);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          run: (_input, runId) =>
            Effect.succeed({
              runId: runId!,
              state: "succeeded",
              output: "completed safely",
              threadIds: [ThreadId.make("thread-1")],
              journalPath: `/tmp/${runId!}`,
              error: null,
            }),
        }),
      ),
    );
  });

  it.effect("releases the live runtime after background execution settles", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const released = yield* Deferred.make<IntegrationRunId>();
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository: memory.repository,
          run: (_input, runId) =>
            Effect.succeed({
              runId: runId!,
              state: "succeeded",
              output: "completed safely",
              threadIds: [],
              journalPath: `/tmp/${runId!}`,
              error: null,
            }),
          releaseRun: (runId) => Deferred.succeed(released, runId),
        }),
        scope,
      );
      const launch = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(runInput);
      }).pipe(Effect.provide(context));

      expect(yield* Deferred.await(released)).toBe(launch.run.id);
      expect(memory.records.get(launch.run.id)?.state).toBe("succeeded");
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("does not create a durable run until the LoopSpec is execution ready", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const error = yield* integrations.runMonkeyLoopy(runInput).pipe(Effect.flip);

      expect(error.code).toBe("validation-failed");
      expect(memory.records.size).toBe(0);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          validate: () =>
            Effect.succeed({
              valid: true,
              verified: false,
              executionReady: false,
              score: 60,
              name: "Unsafe loop",
              factoryVersion: "0.5.0",
              executionVersion: "0.5.0",
              diagnostics: [{ level: "error", message: "not verified", path: null }],
            }),
        }),
      ),
    );
  });

  it.effect("keeps waiting Loopy runs resumable without a completion timestamp", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const result = yield* integrations.runMonkeyLoopy(runInput);
      yield* Effect.yieldNow;
      const stored = memory.records.get(result.run.id);

      expect(stored?.state).toBe("waiting");
      expect(stored?.completedAt).toBeNull();
      expect(stored?.journalRef).toContain(result.run.id);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          run: (_input, runId) =>
            Effect.succeed({
              runId: runId!,
              state: "waiting",
              output: "approval required",
              threadIds: [ThreadId.make("thread-waiting")],
              journalPath: `/tmp/${runId!}`,
              error: "waiting for approval",
            }),
        }),
      ),
    );
  });

  it.effect("persists an agent thread while its Loopy step is still running", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const threadPersisted = yield* Deferred.make<void>();
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository: memory.repository,
          run: (_input, _runId, observer) =>
            observer!.onThreadCreated(ThreadId.make("thread-active")).pipe(
              Effect.tap(() => Deferred.succeed(threadPersisted, undefined)),
              Effect.andThen(Effect.never),
            ),
        }),
        scope,
      );
      const launch = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(runInput);
      }).pipe(Effect.provide(context));

      yield* Deferred.await(threadPersisted);
      const active = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.getRun({ id: launch.run.id });
      }).pipe(Effect.provide(context));
      expect(active?.state).toBe("running");
      expect(active?.threadIds).toEqual([ThreadId.make("thread-active")]);
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("resumes a waiting run in place and preserves its thread lineage", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const launched = yield* integrations.runMonkeyLoopy(runInput);
      yield* Effect.yieldNow;

      const resumed = yield* integrations.resumeRun({ id: launched.run.id, approveCaps: false });
      expect(resumed.operation).toBe("resume");
      expect(resumed.created).toBe(false);
      expect(resumed.run.id).toBe(launched.run.id);
      expect(resumed.run.state).toBe("running");
      yield* Effect.yieldNow;

      const stored = memory.records.get(launched.run.id);
      expect(stored?.state).toBe("succeeded");
      expect(stored?.threadIds).toEqual([
        ThreadId.make("thread-waiting"),
        ThreadId.make("thread-resumed"),
      ]);
      expect(stored?.timeline.map((event) => event.summary)).toEqual(
        expect.arrayContaining(["Resume requested", "Run resumed"]),
      );
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          run: (_input, runId) =>
            Effect.succeed({
              runId: runId!,
              state: "waiting",
              output: "waiting",
              threadIds: [ThreadId.make("thread-waiting")],
              journalPath: `/tmp/${runId!}`,
              error: null,
            }),
          resume: (_input, runId, _approveCaps, observer) =>
            observer
              ? observer.onThreadCreated(ThreadId.make("thread-resumed")).pipe(
                  Effect.as({
                    runId,
                    state: "succeeded" as const,
                    output: "resumed safely",
                    threadIds: [ThreadId.make("thread-resumed")],
                    journalPath: `/tmp/${runId}`,
                    error: null,
                  }),
                )
              : Effect.die("missing observer"),
        }),
      ),
    );
  });

  it.effect("does not resume a waiting run after cancellation wins the recovery race", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const verificationStarted = yield* Deferred.make<void>();
      const allowVerification = yield* Deferred.make<void>();
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository: memory.repository,
          run: (_input, runId) =>
            Effect.succeed({
              runId: runId!,
              state: "waiting",
              output: "waiting",
              threadIds: [],
              journalPath: `/tmp/${runId!}`,
              error: null,
            }),
          verifyJournal: () =>
            Deferred.succeed(verificationStarted, undefined).pipe(
              Effect.andThen(Deferred.await(allowVerification)),
            ),
          resume: () => Effect.die("resume must not start after cancellation"),
        }),
        scope,
      );
      const launched = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(runInput);
      }).pipe(Effect.provide(context));
      yield* Effect.yieldNow;

      const resumeFiber = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.resumeRun({ id: launched.run.id, approveCaps: false });
      }).pipe(Effect.provide(context), Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(verificationStarted);
      const cancelled = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.cancelRun({ id: launched.run.id });
      }).pipe(Effect.provide(context));
      expect(cancelled.run.state).toBe("cancelled");

      yield* Deferred.succeed(allowVerification, undefined);
      const recoveryError = yield* Fiber.join(resumeFiber).pipe(Effect.flip);
      expect(recoveryError.code).toBe("recovery-in-progress");
      expect(memory.records.get(launched.run.id)?.state).toBe("cancelled");
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("keeps a resumed run live while publishing its running transition", () => {
    const memory = makeMemoryRunRepository();
    const storedSecrets = new Map<string, Uint8Array>();
    const resumeInput = { ...runInput, requestId: "resume-publish-race-1234" };
    const waiting = storedRun(`monkey-${resumeInput.requestId}`, "waiting");
    memory.records.set(waiting.id, waiting);
    return Effect.gen(function* () {
      storedSecrets.set(
        monkeyLoopyRecoverySecretName(waiting.id),
        yield* encodeMonkeyLoopyRecoveryCapsule(makeMonkeyLoopyRecoveryCapsule(resumeInput)),
      );
      const runningPersisted = yield* Deferred.make<void>();
      const allowRecoveryReturn = yield* Deferred.make<void>();
      const repository: IntegrationRunRepositoryShape = {
        ...memory.repository,
        recoverMonkeyLoopy: (run, expected) =>
          memory.repository.recoverMonkeyLoopy(run, expected).pipe(
            Effect.tap((recovered) =>
              recovered ? Deferred.succeed(runningPersisted, undefined) : Effect.void,
            ),
            Effect.tap(() => Deferred.await(allowRecoveryReturn)),
          ),
      };
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository,
          storedSecrets,
          resume: (_input, runId) =>
            Effect.succeed({
              runId,
              state: "succeeded",
              output: "resumed without reconciliation race",
              threadIds: [],
              journalPath: `/tmp/${runId}`,
              error: null,
            }),
        }),
        scope,
      );
      const resumeFiber = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.resumeRun({ id: waiting.id, approveCaps: false });
      }).pipe(Effect.provide(context), Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(runningPersisted);

      const concurrentRead = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.getRun({ id: waiting.id });
      }).pipe(Effect.provide(context));
      expect(concurrentRead?.state).toBe("running");
      expect(memory.records.get(waiting.id)?.failure).toBeNull();

      yield* Deferred.succeed(allowRecoveryReturn, undefined);
      const resumed = yield* Fiber.join(resumeFiber);
      expect(resumed.run.state).toBe("running");
      yield* Effect.yieldNow;
      expect(memory.records.get(waiting.id)?.state).toBe("succeeded");
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("reports and resumes a restart-interrupted run", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const launched = yield* integrations.runMonkeyLoopy(runInput);
      yield* Effect.yieldNow;
      const waiting = memory.records.get(launched.run.id)!;
      memory.records.set(launched.run.id, {
        ...waiting,
        state: "cancelled",
        failure: INTERRUPTED_INTEGRATION_RUN_FAILURE,
        completedAt: waiting.updatedAt,
      });

      const inspected = yield* integrations.inspectRun({ id: launched.run.id });
      expect(inspected.runtime.recoverable).toBe(true);

      const resumed = yield* integrations.resumeRun({ id: launched.run.id, approveCaps: false });
      expect(resumed.run.state).toBe("running");
      yield* Effect.yieldNow;
      expect(memory.records.get(launched.run.id)?.state).toBe("succeeded");
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          run: (_input, runId) =>
            Effect.succeed({
              runId: runId!,
              state: "waiting",
              output: "waiting",
              threadIds: [],
              journalPath: `/tmp/${runId!}`,
              error: null,
            }),
          resume: (_input, runId) =>
            Effect.succeed({
              runId,
              state: "succeeded",
              output: "resumed after restart",
              threadIds: [],
              journalPath: `/tmp/${runId}`,
              error: null,
            }),
        }),
      ),
    );
  });

  it.effect("reconciles a restart-orphaned running row before direct resume", () => {
    const memory = makeMemoryRunRepository();
    const storedSecrets = new Map<string, Uint8Array>();
    const orphanInput = { ...runInput, requestId: "resume-orphan-1234" };
    const orphaned = storedRun(`monkey-${orphanInput.requestId}`, "running", {
      completedAt: null,
    });
    memory.records.set(orphaned.id, orphaned);
    return Effect.gen(function* () {
      storedSecrets.set(
        monkeyLoopyRecoverySecretName(orphaned.id),
        yield* encodeMonkeyLoopyRecoveryCapsule(makeMonkeyLoopyRecoveryCapsule(orphanInput)),
      );
      const integrations = yield* IntegrationService;
      const resumed = yield* integrations.resumeRun({ id: orphaned.id, approveCaps: false });

      expect(resumed.run.state).toBe("running");
      expect(resumed.run.timeline.map((event) => event.summary)).toContain("Run resumed");
      yield* Effect.yieldNow;
      expect(memory.records.get(orphaned.id)?.state).toBe("succeeded");
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          storedSecrets,
          resume: (_input, runId) =>
            Effect.succeed({
              runId,
              state: "succeeded",
              output: "resumed orphan safely",
              threadIds: [],
              journalPath: `/tmp/${runId}`,
              error: null,
            }),
        }),
      ),
    );
  });

  it.effect("prunes an expired restart-interrupted run before direct resume", () => {
    const memory = makeMemoryRunRepository();
    const storedSecrets = new Map<string, Uint8Array>();
    const expired = {
      ...makeExpiredRun("monkey-expired-resume"),
      state: "cancelled" as const,
      failure: INTERRUPTED_INTEGRATION_RUN_FAILURE,
    };
    memory.records.set(expired.id, expired);
    return Effect.gen(function* () {
      storedSecrets.set(
        monkeyLoopyRecoverySecretName(expired.id),
        yield* encodeMonkeyLoopyRecoveryCapsule(makeMonkeyLoopyRecoveryCapsule(runInput)),
      );
      yield* TestClock.setTime(RETENTION_TEST_NOW_MS);
      const integrations = yield* IntegrationService;
      const error = yield* integrations
        .resumeRun({ id: expired.id, approveCaps: false })
        .pipe(Effect.flip);

      expect(error.code).toBe("run-not-found");
      expect(memory.records.has(expired.id)).toBe(false);
      expect(storedSecrets.has(monkeyLoopyRecoverySecretName(expired.id))).toBe(false);
    }).pipe(Effect.provide(makeTestLayer({ repository: memory.repository, storedSecrets })));
  });

  it.effect("creates a new linked attempt when retrying a failed run", () => {
    const memory = makeMemoryRunRepository();
    let executions = 0;
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const launched = yield* integrations.runMonkeyLoopy(runInput);
      yield* Effect.yieldNow;
      expect(memory.records.get(launched.run.id)?.state).toBe("failed");

      const retried = yield* integrations.retryRun({
        id: launched.run.id,
        requestId: "retry-12345678",
      });
      expect(retried.operation).toBe("retry");
      expect(retried.created).toBe(true);
      expect(retried.run.id).not.toBe(launched.run.id);
      expect(retried.run.parentRunId).toBe(launched.run.id);
      expect(retried.run.attempt).toBe(1);
      yield* Effect.yieldNow;

      expect(memory.records.get(retried.run.id)?.state).toBe("succeeded");
      expect(memory.records.get(launched.run.id)?.state).toBe("failed");
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          run: (_input, runId) =>
            Effect.sync(() => {
              executions += 1;
              return {
                runId: runId!,
                state: executions === 1 ? ("failed" as const) : ("succeeded" as const),
                output: executions === 1 ? "failed" : "retried safely",
                threadIds: [],
                journalPath: `/tmp/${runId!}`,
                error: executions === 1 ? "failed" : null,
              };
            }),
        }),
      ),
    );
  });

  it.effect("reconciles a restart-orphaned source before direct retry", () => {
    const memory = makeMemoryRunRepository();
    const storedSecrets = new Map<string, Uint8Array>();
    const sourceInput = { ...runInput, requestId: "retry-source-orphan-1234" };
    const source = storedRun(`monkey-${sourceInput.requestId}`, "running");
    memory.records.set(source.id, source);
    const verified: Array<{ readonly runId: string; readonly allowTerminal: boolean }> = [];
    return Effect.gen(function* () {
      storedSecrets.set(
        monkeyLoopyRecoverySecretName(source.id),
        yield* encodeMonkeyLoopyRecoveryCapsule(makeMonkeyLoopyRecoveryCapsule(sourceInput)),
      );
      const integrations = yield* IntegrationService;
      const retried = yield* integrations.retryRun({
        id: source.id,
        requestId: "retry-after-source-restart-1234",
      });

      expect(retried.created).toBe(true);
      expect(retried.run.parentRunId).toBe(source.id);
      expect(memory.records.get(source.id)?.state).toBe("cancelled");
      expect(memory.records.get(source.id)?.failure).toBe(INTERRUPTED_INTEGRATION_RUN_FAILURE);
      expect(verified).toEqual([{ runId: source.id, allowTerminal: true }]);
      yield* Effect.yieldNow;
      expect(memory.records.get(retried.run.id)?.state).toBe("succeeded");
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          storedSecrets,
          verifyJournal: (_input, runId, allowTerminal) =>
            Effect.sync(() => void verified.push({ runId, allowTerminal })),
          run: (_input, runId) =>
            Effect.succeed({
              runId: runId!,
              state: "succeeded",
              output: "retried after source restart",
              threadIds: [],
              journalPath: `/tmp/${runId!}`,
              error: null,
            }),
        }),
      ),
    );
  });

  it.effect("persists linked retry recovery metadata before publishing the run", () => {
    const memory = makeMemoryRunRepository();
    const storedSecrets = new Map<string, Uint8Array>();
    const requestId = "retry-publication-1234";
    let executions = 0;
    const repository: IntegrationRunRepositoryShape = {
      ...memory.repository,
      insertIfAbsent: (run) =>
        Effect.sync(() => {
          if (run.parentRunId !== null) {
            expect(storedSecrets.has(monkeyLoopyRecoverySecretName(run.id))).toBe(true);
          }
        }).pipe(Effect.andThen(memory.repository.insertIfAbsent(run))),
    };
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const launched = yield* integrations.runMonkeyLoopy(runInput);
      yield* Effect.yieldNow;

      const retried = yield* integrations.retryRun({ id: launched.run.id, requestId });
      expect(retried.created).toBe(true);
      expect(memory.records.has(retried.run.id)).toBe(true);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository,
          storedSecrets,
          run: (_input, runId) =>
            Effect.sync(() => {
              executions += 1;
              return {
                runId: runId!,
                state: executions === 1 ? ("failed" as const) : ("succeeded" as const),
                output: executions === 1 ? "failed" : "retried safely",
                threadIds: [],
                journalPath: `/tmp/${runId!}`,
                error: executions === 1 ? "failed" : null,
              };
            }),
        }),
      ),
    );
  });

  it.effect("serializes a linked retry against a normal launch with the same run id", () => {
    const memory = makeMemoryRunRepository();
    const storedSecrets = new Map<string, Uint8Array>();
    const requestId = "retry-launch-collision-1234";
    return Effect.gen(function* () {
      const childInserted = yield* Deferred.make<void>();
      const allowChildInsert = yield* Deferred.make<void>();
      const repository: IntegrationRunRepositoryShape = {
        ...memory.repository,
        insertIfAbsent: (run) =>
          memory.repository
            .insertIfAbsent(run)
            .pipe(
              Effect.tap((created) =>
                created && run.parentRunId !== null
                  ? Deferred.succeed(childInserted, undefined).pipe(
                      Effect.andThen(Deferred.await(allowChildInsert)),
                    )
                  : Effect.void,
              ),
            ),
      };
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository,
          storedSecrets,
          run: (_input, runId) =>
            runId === `monkey-${runInput.requestId}`
              ? Effect.succeed({
                  runId,
                  state: "failed" as const,
                  output: "source failed",
                  threadIds: [],
                  journalPath: `/tmp/${runId}`,
                  error: "failed",
                })
              : Effect.never,
        }),
        scope,
      );
      const source = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        const launched = yield* integrations.runMonkeyLoopy(runInput);
        yield* Effect.yieldNow;
        return launched.run;
      }).pipe(Effect.provide(context));
      const retryFiber = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.retryRun({ id: source.id, requestId });
      }).pipe(Effect.provide(context), Effect.forkChild);
      yield* Deferred.await(childInserted);

      const conflictingInput = {
        ...runInput,
        requestId,
        yaml: "loopspec: 0.5\nname: conflicting launch",
      };
      const launchFiber = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(conflictingInput);
      }).pipe(Effect.provide(context), Effect.forkChild);
      yield* Effect.yieldNow;
      expect(launchFiber.pollUnsafe()).toBeUndefined();

      yield* Deferred.succeed(allowChildInsert, undefined);
      const retry = yield* Fiber.join(retryFiber);
      const launch = yield* Fiber.join(launchFiber);
      const child = memory.records.get(retry.run.id);
      const capsuleBytes = storedSecrets.get(monkeyLoopyRecoverySecretName(retry.run.id));
      expect(launch.created).toBe(false);
      expect(child?.parentRunId).toBe(source.id);
      expect(child?.attempt).toBe(source.attempt + 1);
      expect(capsuleBytes).toBeDefined();
      const capsule = yield* decodeMonkeyLoopyRecoveryCapsule(capsuleBytes!);
      expect(capsule.input.yaml).toBe(runInput.yaml);
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("serializes linked retries from different sources on the child run id", () => {
    const memory = makeMemoryRunRepository();
    const storedSecrets = new Map<string, Uint8Array>();
    const requestId = "retry-source-collision-1234";
    const secondInput = {
      ...runInput,
      requestId: "second-source-1234",
      yaml: "loopspec: 0.5\nname: second source",
    };
    return Effect.gen(function* () {
      const childInserted = yield* Deferred.make<void>();
      const allowChildInsert = yield* Deferred.make<void>();
      const repository: IntegrationRunRepositoryShape = {
        ...memory.repository,
        insertIfAbsent: (run) =>
          memory.repository
            .insertIfAbsent(run)
            .pipe(
              Effect.tap((created) =>
                created && run.parentRunId !== null
                  ? Deferred.succeed(childInserted, undefined).pipe(
                      Effect.andThen(Deferred.await(allowChildInsert)),
                    )
                  : Effect.void,
              ),
            ),
      };
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository,
          storedSecrets,
          run: (_input, runId) =>
            Effect.succeed({
              runId: runId!,
              state: "failed",
              output: "failed",
              threadIds: [],
              journalPath: `/tmp/${runId!}`,
              error: "failed",
            }),
        }),
        scope,
      );
      const [firstSource, secondSource] = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        const first = yield* integrations.runMonkeyLoopy(runInput);
        const second = yield* integrations.runMonkeyLoopy(secondInput);
        yield* Effect.yieldNow;
        return [first.run, second.run] as const;
      }).pipe(Effect.provide(context));
      const firstFiber = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.retryRun({ id: firstSource.id, requestId });
      }).pipe(Effect.provide(context), Effect.forkChild);
      yield* Deferred.await(childInserted);
      const secondFiber = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.retryRun({ id: secondSource.id, requestId });
      }).pipe(Effect.provide(context), Effect.forkChild);
      yield* Effect.yieldNow;
      expect(secondFiber.pollUnsafe()).toBeUndefined();

      yield* Deferred.succeed(allowChildInsert, undefined);
      const firstRetry = yield* Fiber.join(firstFiber);
      const collision = yield* Fiber.join(secondFiber).pipe(Effect.flip);
      const child = memory.records.get(firstRetry.run.id);
      const capsuleBytes = storedSecrets.get(monkeyLoopyRecoverySecretName(firstRetry.run.id));
      expect(collision.code).toBe("invalid-config");
      expect(child?.parentRunId).toBe(firstSource.id);
      expect(child?.attempt).toBe(firstSource.attempt + 1);
      expect(capsuleBytes).toBeDefined();
      const capsule = yield* decodeMonkeyLoopyRecoveryCapsule(capsuleBytes!);
      expect(capsule.input.yaml).toBe(runInput.yaml);
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("reclaims an orphaned queued linked retry instead of returning it", () => {
    const memory = makeMemoryRunRepository();
    let executions = 0;
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const launched = yield* integrations.runMonkeyLoopy(runInput);
      yield* Effect.yieldNow;
      const source = memory.records.get(launched.run.id)!;
      expect(source.state).toBe("failed");

      const requestId = "retry-orphan-1234";
      const child = storedRun(`monkey-${requestId}`, "queued", {
        parentRunId: source.id,
        attempt: source.attempt + 1,
        startedAt: null,
        completedAt: null,
      });
      memory.records.set(child.id, child);

      const reclaimed = yield* integrations.retryRun({ id: source.id, requestId });
      expect(reclaimed.created).toBe(false);
      expect(reclaimed.run.state).toBe("running");
      expect(reclaimed.run.attempt).toBe(source.attempt + 1);
      yield* Effect.yieldNow;
      expect(memory.records.get(child.id)?.state).toBe("succeeded");
      expect(executions).toBe(2);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          run: (_input, runId) =>
            Effect.sync(() => {
              executions += 1;
              return {
                runId: runId!,
                state: executions === 1 ? ("failed" as const) : ("succeeded" as const),
                output: executions === 1 ? "failed" : "reclaimed safely",
                threadIds: [],
                journalPath: `/tmp/${runId!}`,
                error: executions === 1 ? "failed" : null,
              };
            }),
        }),
      ),
    );
  });

  it.effect("resumes an orphaned running linked retry instead of rerunning its journal", () => {
    const memory = makeMemoryRunRepository();
    const storedSecrets = new Map<string, Uint8Array>();
    const source = storedRun("monkey-retry-running-source", "failed", {
      failure: "failed",
    });
    const requestId = "retry-running-orphan-1234";
    const child = storedRun(`monkey-${requestId}`, "running", {
      parentRunId: source.id,
      attempt: source.attempt + 1,
    });
    memory.records.set(source.id, source);
    memory.records.set(child.id, child);
    let runCalls = 0;
    let resumeCalls = 0;
    const verifications: Array<{ readonly runId: string; readonly allowTerminal: boolean }> = [];
    return Effect.gen(function* () {
      yield* encodeMonkeyLoopyRecoveryCapsule(makeMonkeyLoopyRecoveryCapsule(runInput)).pipe(
        Effect.tap((bytes) =>
          Effect.sync(() => storedSecrets.set(monkeyLoopyRecoverySecretName(source.id), bytes)),
        ),
      );
      const retryInput = { ...runInput, requestId };
      yield* encodeMonkeyLoopyRecoveryCapsule(makeMonkeyLoopyRecoveryCapsule(retryInput)).pipe(
        Effect.tap((bytes) =>
          Effect.sync(() => storedSecrets.set(monkeyLoopyRecoverySecretName(child.id), bytes)),
        ),
      );

      const integrations = yield* IntegrationService;
      const recovered = yield* integrations.retryRun({ id: source.id, requestId });
      expect(recovered.created).toBe(false);
      expect(recovered.run.state).toBe("running");
      yield* Effect.yieldNow;

      expect(runCalls).toBe(0);
      expect(resumeCalls).toBe(1);
      expect(verifications).toEqual([
        { runId: source.id, allowTerminal: true },
        { runId: child.id, allowTerminal: false },
      ]);
      expect(memory.records.get(child.id)?.state).toBe("succeeded");
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          storedSecrets,
          verifyJournal: (_input, runId, allowTerminal) =>
            Effect.sync(() => void verifications.push({ runId, allowTerminal })),
          run: () =>
            Effect.sync(() => {
              runCalls += 1;
              throw new Error("An orphaned running retry must not start a new journal.");
            }),
          resume: (_input, runId) =>
            Effect.sync(() => {
              resumeCalls += 1;
              return {
                runId,
                state: "succeeded" as const,
                output: "resumed retry journal safely",
                threadIds: [],
                journalPath: `/tmp/${runId}`,
                error: null,
              };
            }),
        }),
      ),
    );
  });

  it.effect("resumes a restart-interrupted linked retry on the same request id", () => {
    const memory = makeMemoryRunRepository();
    const storedSecrets = new Map<string, Uint8Array>();
    const requestId = "retry-restart-1234";
    return Effect.gen(function* () {
      const childStarted = yield* Deferred.make<void>();
      let executions = 0;
      const firstScope = yield* Scope.make();
      const firstContext = yield* Layer.buildWithScope(
        makeTestLayer({
          repository: memory.repository,
          storedSecrets,
          run: (_input, runId) => {
            executions += 1;
            return executions === 1
              ? Effect.succeed({
                  runId: runId!,
                  state: "failed" as const,
                  output: "failed",
                  threadIds: [],
                  journalPath: `/tmp/${runId!}`,
                  error: "failed",
                })
              : Deferred.succeed(childStarted, undefined).pipe(Effect.andThen(Effect.never));
          },
        }),
        firstScope,
      );
      const source = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        const launched = yield* integrations.runMonkeyLoopy(runInput);
        yield* Effect.yieldNow;
        yield* integrations.retryRun({ id: launched.run.id, requestId });
        return launched.run;
      }).pipe(Effect.provide(firstContext));
      yield* Deferred.await(childStarted);
      yield* Scope.close(firstScope, Exit.void);

      const childId = IntegrationRunId.make(`monkey-${requestId}`);
      expect(memory.records.get(childId)?.state).toBe("cancelled");
      expect(memory.records.get(childId)?.failure).toBe(INTERRUPTED_INTEGRATION_RUN_FAILURE);

      const resumeStarted = yield* Deferred.make<void>();
      const allowResume = yield* Deferred.make<void>();
      const secondScope = yield* Scope.make();
      const secondContext = yield* Layer.buildWithScope(
        makeTestLayer({
          repository: memory.repository,
          storedSecrets,
          resume: (_input, runId) =>
            Deferred.succeed(resumeStarted, undefined).pipe(
              Effect.andThen(Deferred.await(allowResume)),
              Effect.as({
                runId,
                state: "succeeded" as const,
                output: "resumed retry safely",
                threadIds: [],
                journalPath: `/tmp/${runId}`,
                error: null,
              }),
            ),
        }),
        secondScope,
      );
      const { recovered, concurrent } = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        const recovered = yield* integrations.retryRun({ id: source.id, requestId });
        yield* Deferred.await(resumeStarted);
        const concurrent = yield* integrations
          .retryRun({ id: source.id, requestId: "retry-while-resumed-1234" })
          .pipe(Effect.flip);
        return { recovered, concurrent };
      }).pipe(Effect.provide(secondContext));
      expect(recovered.created).toBe(false);
      expect(recovered.run.state).toBe("running");
      expect(concurrent.code).toBe("recovery-in-progress");
      yield* Deferred.succeed(allowResume, undefined);
      yield* Effect.yieldNow;
      expect(memory.records.get(childId)?.state).toBe("succeeded");
      yield* Scope.close(secondScope, Exit.void);
    });
  });

  it.effect("prunes an expired retry source before creating a linked child", () => {
    const memory = makeMemoryRunRepository();
    const storedSecrets = new Map<string, Uint8Array>();
    const expired = {
      ...makeExpiredRun("monkey-expired-retry-source"),
      state: "failed" as const,
      failure: "expired failure",
    };
    memory.records.set(expired.id, expired);
    const requestId = "retry-expired-1234";
    return Effect.gen(function* () {
      storedSecrets.set(
        monkeyLoopyRecoverySecretName(expired.id),
        yield* encodeMonkeyLoopyRecoveryCapsule(makeMonkeyLoopyRecoveryCapsule(runInput)),
      );
      yield* TestClock.setTime(RETENTION_TEST_NOW_MS);
      const integrations = yield* IntegrationService;
      const error = yield* integrations.retryRun({ id: expired.id, requestId }).pipe(Effect.flip);

      expect(error.code).toBe("run-not-found");
      expect(memory.records.has(expired.id)).toBe(false);
      expect(memory.records.has(`monkey-${requestId}`)).toBe(false);
      expect(storedSecrets.has(monkeyLoopyRecoverySecretName(expired.id))).toBe(false);
    }).pipe(Effect.provide(makeTestLayer({ repository: memory.repository, storedSecrets })));
  });

  it.effect("rejects concurrent resume and recovery without private metadata", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const launched = yield* integrations.runMonkeyLoopy(runInput);
      yield* Effect.yieldNow;
      yield* integrations.resumeRun({ id: launched.run.id, approveCaps: false });

      const concurrent = yield* integrations
        .resumeRun({ id: launched.run.id, approveCaps: false })
        .pipe(Effect.flip);
      expect(concurrent.code).toBe("recovery-in-progress");

      const missing = storedRun("monkey-missing-recovery", "waiting");
      memory.records.set(missing.id, missing);
      const metadataError = yield* integrations
        .resumeRun({ id: missing.id, approveCaps: false })
        .pipe(Effect.flip);
      expect(metadataError.code).toBe("recovery-metadata-missing");
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          run: (_input, runId) =>
            Effect.succeed({
              runId: runId!,
              state: "waiting",
              output: "waiting",
              threadIds: [],
              journalPath: `/tmp/${runId!}`,
              error: null,
            }),
          resume: () => Effect.never,
        }),
      ),
    );
  });

  it.effect("rejects recovery metadata from an incompatible execution version", () => {
    const memory = makeMemoryRunRepository();
    const waiting = storedRun("monkey-version-mismatch", "waiting");
    memory.records.set(waiting.id, waiting);
    const storedSecrets = new Map<string, Uint8Array>();
    storedSecrets.set(
      monkeyLoopyRecoverySecretName(waiting.id),
      new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          factoryVersion: "0.4.0",
          executionVersion: "0.4.0",
          input: runInput,
        }),
      ),
    );
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const error = yield* integrations
        .resumeRun({ id: waiting.id, approveCaps: false })
        .pipe(Effect.flip);

      expect(error.code).toBe("version-mismatch");
      expect(memory.records.get(waiting.id)?.state).toBe("waiting");
    }).pipe(Effect.provide(makeTestLayer({ repository: memory.repository, storedSecrets })));
  });

  it.effect("persists a sanitized background failure after launch", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const launch = yield* integrations.runMonkeyLoopy(runInput);
      yield* Effect.yieldNow;
      const stored = [...memory.records.values()][0];

      expect(launch.created).toBe(true);
      expect(stored?.state).toBe("failed");
      expect(stored?.failure).toContain("[REDACTED]");
      expect(stored?.failure).not.toContain("super-secret");
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          run: () =>
            Effect.fail(
              new IntegrationRequestError({
                code: "execution-failed",
                message: "token=super-secret",
              }),
            ),
        }),
      ),
    );
  });

  it.effect("keeps a failed Loopy run active until failure recovery is persisted", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const recoveryStarted = yield* Deferred.make<void>();
      const allowRecovery = yield* Deferred.make<void>();
      const repository = IntegrationRunRepository.of({
        ...memory.repository,
        transition: (run, from) =>
          run.state === "failed"
            ? Deferred.succeed(recoveryStarted, undefined).pipe(
                Effect.andThen(Deferred.await(allowRecovery)),
                Effect.andThen(memory.repository.transition(run, from)),
              )
            : memory.repository.transition(run, from),
      });
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository,
          run: () =>
            Effect.fail(
              new IntegrationRequestError({
                code: "execution-failed",
                message: "expected failure",
              }),
            ),
        }),
        scope,
      );
      const launch = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(runInput);
      }).pipe(Effect.provide(context));

      yield* Deferred.await(recoveryStarted);
      const duringRecovery = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.getRun({ id: launch.run.id });
      }).pipe(Effect.provide(context));
      expect(duringRecovery?.state).toBe("running");

      yield* Deferred.succeed(allowRecovery, undefined);
      yield* Effect.yieldNow;
      expect(memory.records.get(launch.run.id)?.state).toBe("failed");
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("marks a background Loopy run cancelled when the service scope shuts down", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const runEntered = yield* Deferred.make<void>();
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository: memory.repository,
          run: () => Deferred.succeed(runEntered, undefined).pipe(Effect.andThen(Effect.never)),
        }),
        scope,
      );
      const launch = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(runInput);
      }).pipe(Effect.provide(context));

      yield* Deferred.await(runEntered);
      expect(memory.records.get(launch.run.id)?.state).toBe("running");

      yield* Scope.close(scope, Exit.void);

      const stored = memory.records.get(launch.run.id);
      expect(stored?.state).toBe("cancelled");
      expect(stored?.failure).toBe("Run interrupted before completion.");
      expect(stored?.completedAt).not.toBeNull();
    });
  });

  it.effect("reconciles orphaned Loopy runs before applying history filters", () => {
    const memory = makeMemoryRunRepository();
    const orphaned = makeOrphanedRun("orphaned-list-run", "running");
    memory.records.set(orphaned.id, orphaned);
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const result = yield* integrations.listRuns({ limit: 50, state: "running" });

      expect(result.runs).toEqual([]);
      expect(memory.records.get(orphaned.id)?.state).toBe("cancelled");
      expect(memory.records.get(orphaned.id)?.completedAt).not.toBeNull();
    }).pipe(Effect.provide(makeTestLayer({ repository: memory.repository })));
  });

  it.effect("reconciles an orphaned Loopy run before reading its details", () => {
    const memory = makeMemoryRunRepository();
    const orphaned = makeOrphanedRun("orphaned-detail-run", "queued");
    memory.records.set(orphaned.id, orphaned);
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const result = yield* integrations.getRun({ id: orphaned.id });

      expect(result?.state).toBe("cancelled");
      expect(result?.failure).toBe("Run interrupted before completion.");
    }).pipe(Effect.provide(makeTestLayer({ repository: memory.repository })));
  });

  it.effect("does not reconcile a Loopy run that is active in this server process", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository: memory.repository,
          run: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        }),
        scope,
      );
      const launch = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(runInput);
      }).pipe(Effect.provide(context));

      yield* Deferred.await(started);
      const active = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.listRuns({ limit: 50, state: "running" });
      }).pipe(Effect.provide(context));
      expect(active.runs).toHaveLength(1);
      expect(active.runs[0]?.id).toBe(launch.run.id);

      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("prunes expired completed runs before listing history", () => {
    const memory = makeMemoryRunRepository();
    const expired = makeExpiredRun("expired-list-run");
    memory.records.set(expired.id, expired);
    return Effect.gen(function* () {
      yield* TestClock.setTime(RETENTION_TEST_NOW_MS);
      const integrations = yield* IntegrationService;
      const result = yield* integrations.listRuns({ limit: 50 });

      expect(result.runs).toEqual([]);
      expect(memory.records.has(expired.id)).toBe(false);
    }).pipe(Effect.provide(makeTestLayer({ repository: memory.repository })));
  });

  it.effect("retains an expired retry parent and its capsule while a child is retained", () => {
    const memory = makeMemoryRunRepository();
    const storedSecrets = new Map<string, Uint8Array>();
    const parent = {
      ...makeExpiredRun("monkey-retained-parent"),
      state: "failed" as const,
      failure: "old failure",
    };
    const recentAt = "2033-05-17T03:33:20.000Z";
    const child = storedRun("monkey-retained-child", "succeeded", {
      parentRunId: parent.id,
      attempt: 1,
      createdAt: recentAt,
      startedAt: recentAt,
      completedAt: recentAt,
      updatedAt: recentAt,
    });
    memory.records.set(parent.id, parent);
    memory.records.set(child.id, child);
    return Effect.gen(function* () {
      storedSecrets.set(
        monkeyLoopyRecoverySecretName(parent.id),
        yield* encodeMonkeyLoopyRecoveryCapsule(makeMonkeyLoopyRecoveryCapsule(runInput)),
      );
      yield* TestClock.setTime(RETENTION_TEST_NOW_MS);
      const integrations = yield* IntegrationService;
      yield* integrations.listRuns({ limit: 10 });

      expect(memory.records.has(parent.id)).toBe(true);
      expect(memory.records.has(child.id)).toBe(true);
      expect(storedSecrets.has(monkeyLoopyRecoverySecretName(parent.id))).toBe(true);
    }).pipe(Effect.provide(makeTestLayer({ repository: memory.repository, storedSecrets })));
  });

  it.effect("prunes expired completed runs before reading run details", () => {
    const memory = makeMemoryRunRepository();
    const expired = makeExpiredRun("expired-detail-run");
    memory.records.set(expired.id, expired);
    return Effect.gen(function* () {
      yield* TestClock.setTime(RETENTION_TEST_NOW_MS);
      const integrations = yield* IntegrationService;
      const result = yield* integrations.getRun({ id: expired.id });

      expect(result).toBeNull();
      expect(memory.records.has(expired.id)).toBe(false);
    }).pipe(Effect.provide(makeTestLayer({ repository: memory.repository })));
  });
  it.effect("deduplicates launch retries with one durable run record", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const first = yield* integrations.runMonkeyLoopy(runInput);
      const retry = yield* integrations.runMonkeyLoopy(runInput);

      expect(first.created).toBe(true);
      expect(retry.created).toBe(false);
      expect(retry.run.id).toBe(first.run.id);
      expect(memory.records.size).toBe(1);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          run: () => Effect.never,
        }),
      ),
    );
  });

  it.effect("persists recovery metadata before publishing a new run", () => {
    const memory = makeMemoryRunRepository();
    const storedSecrets = new Map<string, Uint8Array>();
    const repository: IntegrationRunRepositoryShape = {
      ...memory.repository,
      insertIfAbsent: (run) =>
        Effect.sync(() => {
          expect(storedSecrets.has(monkeyLoopyRecoverySecretName(run.id))).toBe(true);
        }).pipe(Effect.andThen(memory.repository.insertIfAbsent(run))),
    };
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const launched = yield* integrations.runMonkeyLoopy(runInput);

      expect(launched.created).toBe(true);
      expect(memory.records.has(launched.run.id)).toBe(true);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository,
          storedSecrets,
          run: () => Effect.never,
        }),
      ),
    );
  });

  it.effect("serializes concurrent launches before publishing their durable run", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const inserted = yield* Deferred.make<void>();
      const releaseInsert = yield* Deferred.make<void>();
      let executions = 0;
      const repository: IntegrationRunRepositoryShape = {
        ...memory.repository,
        insertIfAbsent: (run) =>
          Effect.gen(function* () {
            const created = yield* memory.repository.insertIfAbsent(run);
            if (created) {
              yield* Deferred.succeed(inserted, undefined);
              yield* Deferred.await(releaseInsert);
            }
            return created;
          }),
      };
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository,
          run: () =>
            Effect.sync(() => {
              executions += 1;
            }).pipe(Effect.andThen(Effect.never)),
        }),
        scope,
      );
      const launch = Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(runInput);
      }).pipe(Effect.provide(context));

      const firstFiber = yield* launch.pipe(Effect.forkChild);
      yield* Deferred.await(inserted);
      const secondFiber = yield* launch.pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Deferred.succeed(releaseInsert, undefined);
      const [first, second] = yield* Effect.all([Fiber.join(firstFiber), Fiber.join(secondFiber)]);
      yield* Effect.yieldNow;

      expect([first.created, second.created].sort()).toEqual([false, true]);
      expect(first.run.id).toBe(second.run.id);
      expect(memory.records.size).toBe(1);
      expect(executions).toBe(1);
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("reclaims a stale duplicate launch after a server restart", () => {
    const memory = makeMemoryRunRepository();
    const stale: IntegrationRun = {
      ...makeOrphanedRun(`monkey-${runInput.requestId}`, "queued"),
      timeline: [
        {
          sequence: 0,
          state: "queued",
          occurredAt: "2030-01-01T00:00:00.000Z",
          summary: "Run queued",
        },
      ],
    };
    memory.records.set(stale.id, stale);
    return Effect.gen(function* () {
      const runEntered = yield* Deferred.make<void>();
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository: memory.repository,
          run: () => Deferred.succeed(runEntered, undefined).pipe(Effect.andThen(Effect.never)),
        }),
        scope,
      );
      const retry = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(runInput);
      }).pipe(Effect.provide(context));

      expect(retry.created).toBe(false);
      expect(retry.run.state).toBe("running");
      expect(retry.run.attempt).toBe(1);
      expect(retry.run.timeline.map((event) => event.state)).toEqual(["queued", "running"]);
      yield* Deferred.await(runEntered);
      const active = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.getRun({ id: retry.run.id });
      }).pipe(Effect.provide(context));
      expect(active?.state).toBe("running");
      expect(active?.attempt).toBe(1);
      expect(active?.timeline.map((event) => event.state)).toEqual(["queued", "running"]);
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("rejects a stale reclaim when the submitted LoopSpec is not execution ready", () => {
    const memory = makeMemoryRunRepository();
    const stale = makeOrphanedRun(`monkey-${runInput.requestId}`, "running");
    memory.records.set(stale.id, stale);
    let executions = 0;

    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const error = yield* integrations.runMonkeyLoopy(runInput).pipe(Effect.flip);

      expect(error.code).toBe("validation-failed");
      expect(executions).toBe(0);
      expect(memory.records.get(stale.id)).toMatchObject({ state: "running", attempt: 0 });
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          validate: () =>
            Effect.succeed({
              valid: true,
              verified: false,
              executionReady: false,
              score: 60,
              name: "Changed unsafe loop",
              factoryVersion: "0.5.0",
              executionVersion: "0.5.0",
              diagnostics: [{ level: "error", message: "not verified", path: null }],
            }),
          run: () =>
            Effect.sync(() => {
              executions += 1;
            }).pipe(Effect.andThen(Effect.never)),
        }),
      ),
    );
  });

  it.effect("inspects bounded live progress without exposing runtime inputs", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const run = storedRun("monkey-inspect-live", "running");
      memory.records.set(run.id, run);

      const inspected = yield* integrations.inspectRun({ id: run.id });

      expect(inspected.runtime).toEqual(liveSnapshot);
      expect(inspected.runtime).not.toHaveProperty("inputs");
      expect(inspected.runtime).not.toHaveProperty("journal");
      expect(inspected.runtime.progress.activeThreadId).toBe("thread-active");
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          inspectRun: () => Effect.succeed(liveSnapshot),
        }),
      ),
    );
  });

  it.effect("persists restart-orphan recovery when inspection is the first read", () => {
    const memory = makeMemoryRunRepository();
    const orphaned = makeOrphanedRun("orphaned-inspect-run", "running");
    memory.records.set(orphaned.id, orphaned);

    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const inspected = yield* integrations.inspectRun({ id: orphaned.id });

      expect(inspected.run.state).toBe("cancelled");
      expect(inspected.run.failure).toBe("Run interrupted before completion.");
      expect(inspected.runtime).toMatchObject({ live: false, phase: "terminal" });
      expect(memory.records.get(orphaned.id)?.state).toBe("cancelled");
      expect(memory.records.get(orphaned.id)?.completedAt).not.toBeNull();
    }).pipe(Effect.provide(makeTestLayer({ repository: memory.repository })));
  });

  it.effect("reports an in-process run as starting before its runtime snapshot registers", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const runEntered = yield* Deferred.make<void>();
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository: memory.repository,
          run: () => Deferred.succeed(runEntered, undefined).pipe(Effect.andThen(Effect.never)),
        }),
        scope,
      );
      const launch = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(runInput);
      }).pipe(Effect.provide(context));
      yield* Deferred.await(runEntered);

      const inspected = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.inspectRun({ id: launch.run.id });
      }).pipe(Effect.provide(context));

      expect(inspected.run.state).toBe("running");
      expect(inspected.runtime).toMatchObject({ live: true, phase: "starting" });
      expect(inspected.runtime.diagnostics).toEqual([
        "Run is active in this server process; the Loopy runtime is starting.",
      ]);
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("protects a stale run from reconciliation while its reclaim is validating", () => {
    const memory = makeMemoryRunRepository();
    const stale = makeOrphanedRun(`monkey-${runInput.requestId}`, "queued");
    memory.records.set(stale.id, stale);

    return Effect.gen(function* () {
      const validationStarted = yield* Deferred.make<void>();
      const releaseValidation = yield* Deferred.make<void>();
      const runEntered = yield* Deferred.make<void>();
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository: memory.repository,
          validate: () =>
            Deferred.succeed(validationStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseValidation)),
              Effect.as({
                valid: true,
                verified: true,
                executionReady: true,
                score: 100,
                name: "Validated reclaim",
                factoryVersion: "0.5.0",
                executionVersion: "0.5.0",
                diagnostics: [],
              }),
            ),
          run: () => Deferred.succeed(runEntered, undefined).pipe(Effect.andThen(Effect.never)),
        }),
        scope,
      );
      const launch = Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(runInput);
      }).pipe(Effect.provide(context));

      const launchFiber = yield* launch.pipe(Effect.forkChild);
      yield* Deferred.await(validationStarted);
      const duringValidation = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.getRun({ id: stale.id });
      }).pipe(Effect.provide(context));
      expect(duringValidation).toMatchObject({ state: "queued", attempt: 0 });

      yield* Deferred.succeed(releaseValidation, undefined);
      const retry = yield* Fiber.join(launchFiber);
      expect(retry.run).toMatchObject({ state: "running", attempt: 1 });
      yield* Deferred.await(runEntered).pipe(Effect.timeout("1 second"));
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("starts a reclaimed run even when its launch RPC is interrupted", () => {
    const memory = makeMemoryRunRepository();
    const stale = makeOrphanedRun(`monkey-${runInput.requestId}`, "running");
    memory.records.set(stale.id, stale);
    return Effect.gen(function* () {
      const transitionPersisted = yield* Deferred.make<void>();
      const releaseTransition = yield* Deferred.make<void>();
      const runEntered = yield* Deferred.make<void>();
      const repository: IntegrationRunRepositoryShape = {
        ...memory.repository,
        transition: (run, from) =>
          memory.repository
            .transition(run, from)
            .pipe(
              Effect.tap((transitioned) =>
                transitioned && run.state === "running"
                  ? Deferred.succeed(transitionPersisted, undefined).pipe(
                      Effect.andThen(Deferred.await(releaseTransition)),
                    )
                  : Effect.void,
              ),
            ),
      };
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository,
          run: () => Deferred.succeed(runEntered, undefined).pipe(Effect.andThen(Effect.never)),
        }),
        scope,
      );
      const launch = Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(runInput);
      }).pipe(Effect.provide(context));

      const launchFiber = yield* launch.pipe(Effect.forkChild);
      yield* Deferred.await(transitionPersisted);
      const interruptFiber = yield* Fiber.interrupt(launchFiber).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Deferred.succeed(releaseTransition, undefined);
      yield* Deferred.await(runEntered).pipe(Effect.timeout("1 second"));
      yield* Fiber.join(interruptFiber);

      const active = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.getRun({ id: stale.id });
      }).pipe(Effect.provide(context));
      expect(active?.state).toBe("running");
      expect(active?.attempt).toBe(1);
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("prunes an expired terminal run before checking its request id", () => {
    const memory = makeMemoryRunRepository();
    const id = `monkey-${runInput.requestId}`;
    memory.records.set(id, {
      id,
      source: "monkey-d-loopy",
      state: "succeeded",
      projectId: runInput.projectId,
      parentRunId: null,
      attempt: 0,
      threadIds: [],
      journalRef: null,
      outputSummary: "expired",
      failure: null,
      verification: null,
      timeline: [],
      createdAt: "1900-01-01T00:00:00.000Z",
      startedAt: "1900-01-01T00:01:00.000Z",
      completedAt: "1900-01-01T00:02:00.000Z",
      updatedAt: "1900-01-01T00:02:00.000Z",
    });

    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const launch = yield* integrations.runMonkeyLoopy(runInput);

      expect(launch.created).toBe(true);
      expect(launch.run.id).toBe(id);
      expect(launch.run.state).toBe("queued");
      expect(memory.records.get(id)?.outputSummary).toBeNull();
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          run: () => Effect.never,
        }),
      ),
    );
  });

  it.effect("cancels a live agent turn and makes reconnect retries idempotent", () => {
    const memory = makeMemoryRunRepository();
    let cancellationCalls = 0;
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const run = storedRun("monkey-cancel-live", "running");
      memory.records.set(run.id, run);

      const cancelled = yield* integrations.cancelRun({ id: run.id });
      const repeated = yield* integrations.cancelRun({ id: run.id });

      expect(cancelled.outcome).toBe("cancelled");
      expect(cancelled.run.state).toBe("cancelled");
      expect(cancelled.run.timeline.map((event) => event.summary)).toEqual(
        expect.arrayContaining(["Cancellation requested", "Run cancelled"]),
      );
      expect(repeated.outcome).toBe("already-terminal");
      expect(repeated.run).toEqual(cancelled.run);
      expect(cancellationCalls).toBe(1);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          cancelRun: () =>
            Effect.sync(() => {
              cancellationCalls += 1;
              return liveSnapshot;
            }),
        }),
      ),
    );
  });

  it.effect("waits for an in-process runtime to register before cancelling it", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const runEntered = yield* Deferred.make<void>();
      const firstCancelAttempted = yield* Deferred.make<void>();
      let cancellationCalls = 0;
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository: memory.repository,
          run: () => Deferred.succeed(runEntered, undefined).pipe(Effect.andThen(Effect.never)),
          cancelRun: () =>
            Effect.gen(function* () {
              cancellationCalls += 1;
              if (cancellationCalls === 1) {
                yield* Deferred.succeed(firstCancelAttempted, undefined);
                return null;
              }
              return liveSnapshot;
            }),
        }),
        scope,
      );
      const launch = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(runInput);
      }).pipe(Effect.provide(context));
      yield* Deferred.await(runEntered);

      const cancellationFiber = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.cancelRun({ id: launch.run.id });
      }).pipe(Effect.provide(context), Effect.forkChild);
      yield* Deferred.await(firstCancelAttempted);
      expect(cancellationCalls).toBe(1);

      yield* TestClock.adjust("10 millis");
      const cancelled = yield* Fiber.join(cancellationFiber);
      expect(cancellationCalls).toBe(2);
      expect(cancelled.outcome).toBe("cancelled");
      expect(cancelled.run.state).toBe("cancelled");
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("bounds cancellation before runtime registration and hands it to the runner", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const runEntered = yield* Deferred.make<void>();
      const releaseRegistration = yield* Deferred.make<void>();
      const cancellationObserved = yield* Deferred.make<void>();
      let observedPreRuntimeCancellation = false;
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository: memory.repository,
          run: (_input, runId, observer) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(runEntered, undefined);
              yield* Deferred.await(releaseRegistration);
              observedPreRuntimeCancellation = yield* observer!.isCancellationRequested!();
              yield* Deferred.succeed(cancellationObserved, undefined);
              return {
                runId: runId!,
                state: "cancelled" as const,
                output: "cancelled before runtime registration",
                threadIds: [],
                journalPath: `/tmp/${runId!}`,
                error: null,
              };
            }),
          cancelRun: () => Effect.succeed(null),
        }),
        scope,
      );
      const launch = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(runInput);
      }).pipe(Effect.provide(context));
      yield* Deferred.await(runEntered);

      const cancellationFiber = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.cancelRun({ id: launch.run.id });
      }).pipe(Effect.provide(context), Effect.forkChild);
      yield* TestClock.adjust("250 millis");
      const cancelled = yield* Fiber.join(cancellationFiber);

      expect(cancelled.outcome).toBe("cancelled");
      expect(cancelled.run.state).toBe("cancelled");
      yield* Deferred.succeed(releaseRegistration, undefined);
      yield* Deferred.await(cancellationObserved);
      expect(observedPreRuntimeCancellation).toBe(true);
      expect(memory.records.get(launch.run.id)?.state).toBe("cancelled");
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("preserves a thread linked while runtime cancellation is pending", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const runEntered = yield* Deferred.make<void>();
      const cancellationRequested = yield* Deferred.make<void>();
      const threadPersisted = yield* Deferred.make<void>();
      const threadId = ThreadId.make("thread-active");
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository: memory.repository,
          run: (_input, _runId, observer) =>
            Deferred.succeed(runEntered, undefined).pipe(
              Effect.andThen(Deferred.await(cancellationRequested)),
              Effect.andThen(observer!.onThreadCreated(threadId)),
              Effect.tap(() => Deferred.succeed(threadPersisted, undefined)),
              Effect.andThen(Effect.never),
            ),
          cancelRun: () =>
            Deferred.succeed(cancellationRequested, undefined).pipe(
              Effect.andThen(Deferred.await(threadPersisted)),
              Effect.as(liveSnapshot),
            ),
        }),
        scope,
      );
      const launch = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(runInput);
      }).pipe(Effect.provide(context));
      yield* Deferred.await(runEntered);

      const cancelled = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.cancelRun({ id: launch.run.id });
      }).pipe(Effect.provide(context));

      expect(cancelled.outcome).toBe("cancelled");
      expect(cancelled.run.threadIds).toEqual([threadId]);
      expect(memory.records.get(launch.run.id)?.threadIds).toEqual([threadId]);
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("links a thread that finishes setup after cancellation is persisted", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const runEntered = yield* Deferred.make<void>();
      const cancellationRequested = yield* Deferred.make<void>();
      const releaseThreadSetup = yield* Deferred.make<void>();
      const threadPersisted = yield* Deferred.make<void>();
      const threadId = ThreadId.make("thread-after-cancel");
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        makeTestLayer({
          repository: memory.repository,
          run: (_input, _runId, observer) =>
            Deferred.succeed(runEntered, undefined).pipe(
              Effect.andThen(Deferred.await(cancellationRequested)),
              Effect.andThen(Deferred.await(releaseThreadSetup)),
              Effect.andThen(observer!.onThreadCreated(threadId)),
              Effect.tap(() => Deferred.succeed(threadPersisted, undefined)),
              Effect.andThen(Effect.never),
            ),
          cancelRun: () =>
            Deferred.succeed(cancellationRequested, undefined).pipe(Effect.as(liveSnapshot)),
        }),
        scope,
      );
      const launch = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.runMonkeyLoopy(runInput);
      }).pipe(Effect.provide(context));
      yield* Deferred.await(runEntered);

      const cancelled = yield* Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations.cancelRun({ id: launch.run.id });
      }).pipe(Effect.provide(context));

      expect(cancelled.run.state).toBe("cancelled");
      expect(cancelled.run.threadIds).toEqual([]);
      yield* Deferred.succeed(releaseThreadSetup, undefined);
      yield* Deferred.await(threadPersisted);
      expect(memory.records.get(launch.run.id)).toMatchObject({
        state: "cancelled",
        threadIds: [threadId],
      });
      yield* Scope.close(scope, Exit.void);
    });
  });

  it.effect("retries cancellation when a queued run starts concurrently", () => {
    const memory = makeMemoryRunRepository();
    let raced = false;
    const repository: IntegrationRunRepositoryShape = {
      ...memory.repository,
      transition: (run, from) => {
        if (!raced && run.state === "cancelled" && from.includes("queued")) {
          raced = true;
          return Effect.sync(() => {
            const current = memory.records.get(run.id);
            if (!current) return false;
            memory.records.set(run.id, {
              ...current,
              state: "running",
              startedAt: "2026-07-19T10:00:01.000Z",
            });
            return false;
          });
        }
        return memory.repository.transition(run, from);
      },
    };
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const queued = storedRun("monkey-cancel-race", "queued");
      memory.records.set(queued.id, queued);

      const result = yield* integrations.cancelRun({ id: queued.id });

      expect(raced).toBe(true);
      expect(result.outcome).toBe("cancelled");
      expect(result.run.state).toBe("cancelled");
      expect(memory.records.get(queued.id)?.state).toBe("cancelled");
    }).pipe(
      Effect.provide(makeTestLayer({ repository, cancelRun: () => Effect.succeed(liveSnapshot) })),
    );
  });

  it.effect("cancels queued work before an agent call and durably waiting work", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const queued = storedRun("monkey-cancel-queued", "queued");
      const waiting = storedRun("monkey-cancel-waiting", "waiting");
      memory.records.set(queued.id, queued);
      memory.records.set(waiting.id, waiting);

      const queuedResult = yield* integrations.cancelRun({ id: queued.id });
      const waitingResult = yield* integrations.cancelRun({ id: waiting.id });

      expect(queuedResult.run.state).toBe("cancelled");
      expect(waitingResult.run.state).toBe("cancelled");
      expect(queuedResult.outcome).toBe("cancelled");
      expect(waitingResult.outcome).toBe("cancelled");
    }).pipe(Effect.provide(makeTestLayer({ repository: memory.repository })));
  });

  it.effect("reconciles a restart-orphaned run when cancellation is the first read", () => {
    const memory = makeMemoryRunRepository();
    const orphaned = makeOrphanedRun("orphaned-cancel-run", "running");
    memory.records.set(orphaned.id, orphaned);

    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const result = yield* integrations.cancelRun({ id: orphaned.id });

      expect(result.outcome).toBe("cancelled");
      expect(result.run.state).toBe("cancelled");
      expect(result.run.failure).toBe("Run interrupted before completion.");
      expect(result.run.completedAt).not.toBeNull();
      expect(memory.records.get(orphaned.id)).toEqual(result.run);
    }).pipe(Effect.provide(makeTestLayer({ repository: memory.repository })));
  });

  it.effect("keeps completed runs terminal when cancellation arrives late", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const completed = storedRun("monkey-cancel-complete", "succeeded");
      memory.records.set(completed.id, completed);

      const result = yield* integrations.cancelRun({ id: completed.id });

      expect(result.outcome).toBe("already-terminal");
      expect(result.run.state).toBe("succeeded");
    }).pipe(Effect.provide(makeTestLayer({ repository: memory.repository })));
  });

  it.effect(
    "waits for a terminal runtime result instead of overwriting it with cancellation",
    () => {
      const memory = makeMemoryRunRepository();
      return Effect.gen(function* () {
        const runEntered = yield* Deferred.make<void>();
        const releaseResult = yield* Deferred.make<void>();
        const cancelObserved = yield* Deferred.make<void>();
        const scope = yield* Scope.make();
        const context = yield* Layer.buildWithScope(
          makeTestLayer({
            repository: memory.repository,
            run: (_input, runId) =>
              Deferred.succeed(runEntered, undefined).pipe(
                Effect.andThen(Deferred.await(releaseResult)),
                Effect.as({
                  runId: runId!,
                  state: "succeeded" as const,
                  output: "completed safely",
                  threadIds: [],
                  journalPath: `/tmp/${runId!}`,
                  error: null,
                }),
              ),
            cancelRun: () =>
              Deferred.succeed(cancelObserved, undefined).pipe(
                Effect.as({ ...liveSnapshot, phase: "terminal" as const }),
              ),
          }),
          scope,
        );
        const launch = yield* Effect.gen(function* () {
          const integrations = yield* IntegrationService;
          return yield* integrations.runMonkeyLoopy(runInput);
        }).pipe(Effect.provide(context));
        yield* Deferred.await(runEntered);

        const cancellationFiber = yield* Effect.gen(function* () {
          const integrations = yield* IntegrationService;
          return yield* integrations.cancelRun({ id: launch.run.id });
        }).pipe(Effect.provide(context), Effect.forkChild);
        yield* Deferred.await(cancelObserved);
        expect(memory.records.get(launch.run.id)?.state).toBe("running");

        yield* Deferred.succeed(releaseResult, undefined);
        yield* Effect.yieldNow;
        yield* TestClock.adjust("10 millis");
        const result = yield* Fiber.join(cancellationFiber);

        expect(result.outcome).toBe("already-terminal");
        expect(result.run.state).toBe("succeeded");
        expect(memory.records.get(launch.run.id)?.state).toBe("succeeded");
        yield* Scope.close(scope, Exit.void);
      });
    },
  );

  it.effect("records a sanitized cancellation failure without changing terminal state", () => {
    const memory = makeMemoryRunRepository();
    return Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const running = storedRun("monkey-cancel-failure", "running");
      memory.records.set(running.id, running);

      const error = yield* integrations.cancelRun({ id: running.id }).pipe(Effect.flip);
      const persisted = memory.records.get(running.id);

      expect(error.message).toBe("interrupt failed");
      expect(persisted?.state).toBe("running");
      expect(persisted?.timeline.at(-1)?.summary).toBe("Cancellation request failed");
    }).pipe(
      Effect.provide(
        makeTestLayer({
          repository: memory.repository,
          cancelRun: () =>
            Effect.fail(
              new IntegrationRequestError({
                code: "execution-failed",
                message: "interrupt failed",
              }),
            ),
        }),
      ),
    );
  });
});
