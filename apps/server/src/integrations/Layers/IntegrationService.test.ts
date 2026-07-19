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
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import {
  IntegrationRunRepository,
  type IntegrationRunRepositoryShape,
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
          validate: () => Effect.die("unused"),
          run: options.run ?? (() => Effect.die("unused")),
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
        if (!current || !from.includes(current.state)) return false;
        records.set(run.id, run);
        return true;
      }),
    pruneCompletedBefore: (before) =>
      Effect.sync(() => {
        let deleted = 0;
        for (const [id, run] of records) {
          if (run.completedAt !== null && run.completedAt < before) {
            records.delete(id);
            deleted += 1;
          }
        }
        return deleted;
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
});
