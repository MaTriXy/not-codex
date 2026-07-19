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
import { IntegrationServiceLive } from "./IntegrationService.ts";

function makeTestLayer(
  options: {
    repository?: IntegrationRunRepositoryShape;
    run?: MonkeyLoopyService["Service"]["run"];
    validate?: MonkeyLoopyService["Service"]["validate"];
    inspectRun?: MonkeyLoopyService["Service"]["inspectRun"];
    cancelRun?: MonkeyLoopyService["Service"]["cancelRun"];
    releaseRun?: MonkeyLoopyService["Service"]["releaseRun"];
  } = {},
) {
  const stored = new Map<string, Uint8Array>();
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
            pruneCompletedBefore: () => Effect.succeed(0),
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
    pruneCompletedBefore: (before) =>
      Effect.sync(() => {
        let pruned = 0;
        for (const [id, run] of records) {
          if (
            run.completedAt !== null &&
            ["succeeded", "failed", "cancelled"].includes(run.state) &&
            run.completedAt < before
          ) {
            records.delete(id);
            pruned += 1;
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
