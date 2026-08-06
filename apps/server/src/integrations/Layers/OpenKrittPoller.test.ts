import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  IntegrationRunId,
  ProjectId,
  type IntegrationRun,
} from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import {
  IntegrationRunRepository,
  type IntegrationRunRepositoryShape,
} from "../../persistence/Services/IntegrationRunRepository.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { OpenKrittConnector } from "../Services/OpenKrittConnector.ts";
import { OpenKrittPoller } from "../Services/OpenKrittPoller.ts";
import { OpenKrittPollerLive } from "./OpenKrittPoller.ts";

function makeRun(input: {
  readonly id: string;
  readonly state: IntegrationRun["state"];
  readonly createdAt: string;
  readonly externalScanId: string;
}): IntegrationRun {
  return {
    id: IntegrationRunId.make(input.id),
    source: "open-kritt",
    state: input.state,
    projectId: ProjectId.make("project-1"),
    parentRunId: null,
    attempt: 0,
    threadIds: [],
    journalRef: null,
    outputSummary: `external-scan:${input.externalScanId}`,
    failure: null,
    verification: null,
    timeline: [],
    createdAt: input.createdAt,
    startedAt: null,
    completedAt: input.state === "running" || input.state === "queued" ? null : input.createdAt,
    updatedAt: input.createdAt,
  };
}

/**
 * Mirrors the real SQL contract exactly, because the bug under test lives in the
 * interaction between ordering and limit: `list` is newest-first and returns one
 * row over the limit, while `listOldestActive` is oldest-first and bounded by it.
 * A stub that ordered in memory after taking every row could not reproduce it.
 */
function makeRunRepository(
  rows: ReadonlyArray<IntegrationRun>,
  transitions: Array<IntegrationRun>,
): IntegrationRunRepositoryShape {
  const records = new Map(rows.map((run) => [run.id, run] as const));
  return {
    insert: () => Effect.void,
    insertIfAbsent: () => Effect.succeed(true),
    get: (id) => Effect.sync(() => Option.fromNullishOr(records.get(id))),
    list: (input) =>
      Effect.sync(() =>
        [...records.values()]
          .filter((run) => input.source === undefined || run.source === input.source)
          .filter((run) => input.state === undefined || run.state === input.state)
          .sort((left, right) => {
            const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
            return byCreatedAt === 0 ? right.id.localeCompare(left.id) : byCreatedAt;
          })
          .slice(0, (input.limit ?? 50) + 1),
      ),
    listOldestActive: ({ source, states, limit }) =>
      Effect.sync(() =>
        [...records.values()]
          .filter((run) => run.source === source && states.includes(run.state))
          .sort((left, right) => {
            const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
            return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt;
          })
          .slice(0, limit),
      ),
    transition: (run, from) =>
      Effect.sync(() => {
        const current = records.get(run.id);
        if (current === undefined || !from.includes(current.state)) return false;
        records.set(run.id, run);
        transitions.push(run);
        return true;
      }),
    recoverMonkeyLoopy: () => Effect.succeed(false),
    pruneCompletedBefore: () => Effect.succeed([]),
    getLoopAnyConnectorDiagnostics: () => Effect.succeed(Option.none()),
    putLoopAnyConnectorDiagnostics: () => Effect.void,
  };
}

const DIAGNOSTICS = {
  health: "healthy",
  lastSuccessfulContact: null,
  nextRetryAt: null,
  compatibilityVersion: "1.2.0",
  serverVersion: null,
  lastError: null,
  recentEvents: [],
} as const;

/** Newer filler runs, all created well after the scan the tests care about. */
function makeFiller(input: {
  readonly count: number;
  readonly state: IntegrationRun["state"];
  readonly prefix: string;
}): ReadonlyArray<IntegrationRun> {
  return Array.from({ length: input.count }, (_, index) =>
    makeRun({
      id: `open-kritt-${input.prefix}-${String(index).padStart(3, "0")}`,
      state: input.state,
      createdAt: `2030-02-01T00:00:00.${String(index).padStart(3, "0")}Z`,
      externalScanId: `scan-${input.prefix}-${index}`,
    }),
  );
}

function pollerLayer(input: {
  readonly rows: ReadonlyArray<IntegrationRun>;
  readonly inspected: Array<string>;
  readonly transitions?: Array<IntegrationRun>;
  readonly observation?: {
    readonly kind: "found" | "missing";
    readonly scan: {
      readonly status: string;
      readonly phase: string | null;
      readonly progress: number | null;
      readonly findingCount: number | null;
      readonly duplicateCount: number | null;
    } | null;
  };
}) {
  return OpenKrittPollerLive.pipe(
    Layer.provide(
      Layer.succeed(
        IntegrationRunRepository,
        IntegrationRunRepository.of(makeRunRepository(input.rows, input.transitions ?? [])),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        OpenKrittConnector,
        OpenKrittConnector.of({
          diagnostics: Effect.succeed(DIAGNOSTICS),
          inspectScan: ({ scanId }: { readonly scanId: string }) =>
            Effect.sync(() => {
              input.inspected.push(scanId);
              return (
                input.observation ?? {
                  kind: "found" as const,
                  scan: {
                    status: "running",
                    phase: "scanning",
                    progress: 10,
                    findingCount: 0,
                    duplicateCount: 0,
                  },
                }
              );
            }),
        } as never),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        ServerEnvironment,
        ServerEnvironment.of({
          getEnvironmentId: Effect.succeed(EnvironmentId.make("server")),
          getDescriptor: Effect.die("unused"),
        }),
      ),
    ),
    Layer.provide(ServerSettingsService.layerTest({ openKritt: { enabled: true } })),
    Layer.provide(SqlitePersistenceMemory),
  );
}

const OLDEST_ACTIVE = makeRun({
  id: "open-kritt-active",
  state: "running",
  createdAt: "2030-01-01T00:00:00.000Z",
  externalScanId: "scan-active",
});

describe("OpenKrittPoller", () => {
  it.effect("inspects an older active scan buried under newer terminal history", () => {
    // 150 completed scans have accumulated since the long-running scan started,
    // so a newest-first page of 100 rows contains nothing but terminal history.
    const rows = [...makeFiller({ count: 150, state: "succeeded", prefix: "done" }), OLDEST_ACTIVE];
    const inspected: Array<string> = [];
    return Effect.gen(function* () {
      const poller = yield* OpenKrittPoller;
      const tick = yield* poller.pollOnce;

      expect(inspected).toEqual(["scan-active"]);
      expect(tick.failed).toBe(false);
      expect(tick.polled).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(pollerLayer({ rows, inspected })));
  });

  it.effect("inspects the oldest active scan when one state alone exceeds the page bound", () => {
    // The state filter is not enough on its own. With 150 newer runs in the SAME
    // non-terminal state, a per-state newest-first query of 100 rows still never
    // returns the oldest one, and no amount of re-sorting the page recovers a row
    // the query did not select. Only an oldest-first read at the repository
    // boundary keeps this scan progressing.
    const rows = [...makeFiller({ count: 150, state: "running", prefix: "busy" }), OLDEST_ACTIVE];
    const inspected: Array<string> = [];
    return Effect.gen(function* () {
      const poller = yield* OpenKrittPoller;
      const tick = yield* poller.pollOnce;

      expect(inspected).toContain("scan-active");
      // Still bounded: one tick never inspects more than the per-tick page.
      expect(inspected).toHaveLength(100);
      expect(tick.polled).toBe(100);
      expect(tick.failed).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(pollerLayer({ rows, inspected })));
  });

  it.effect("accepts an authoritative completed scan from a locally queued run", () => {
    const transitions: Array<IntegrationRun> = [];
    const inspected: Array<string> = [];
    const queued = makeRun({
      id: "open-kritt-completed-before-running",
      state: "queued",
      createdAt: "2030-01-01T00:00:00.000Z",
      externalScanId: "scan-completed-before-running",
    });
    return Effect.gen(function* () {
      const poller = yield* OpenKrittPoller;
      yield* poller.pollOnce;

      expect(transitions.at(-1)?.state).toBe("succeeded");
      expect(transitions.at(-1)?.completedAt).not.toBeNull();
    }).pipe(
      Effect.scoped,
      Effect.provide(
        pollerLayer({
          rows: [queued],
          inspected,
          transitions,
          observation: {
            kind: "found",
            scan: {
              status: "completed",
              phase: null,
              progress: 100,
              findingCount: 0,
              duplicateCount: 0,
            },
          },
        }),
      ),
    );
  });

  it.effect("retires a scan after three consecutive authoritative missing observations", () => {
    const transitions: Array<IntegrationRun> = [];
    const inspected: Array<string> = [];
    return Effect.gen(function* () {
      const poller = yield* OpenKrittPoller;
      expect((yield* poller.pollOnce).polled).toBe(0);
      expect((yield* poller.pollOnce).polled).toBe(0);
      expect((yield* poller.pollOnce).polled).toBe(1);

      expect(transitions).toHaveLength(1);
      expect(transitions[0]?.state).toBe("failed");
      expect(transitions[0]?.failure).toContain("no longer reports");
      expect(inspected).toHaveLength(3);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        pollerLayer({
          rows: [OLDEST_ACTIVE],
          inspected,
          transitions,
          observation: { kind: "missing", scan: null },
        }),
      ),
    );
  });
});
