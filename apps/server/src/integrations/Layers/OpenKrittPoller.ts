import type { IntegrationRun } from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { IntegrationRunRepository } from "../../persistence/Services/IntegrationRunRepository.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { appendIntegrationRunTimeline, sanitizeIntegrationRunText } from "../integrationRun.ts";
import { OpenKrittConnector } from "../Services/OpenKrittConnector.ts";
import { OpenKrittPoller } from "../Services/OpenKrittPoller.ts";
import { OpenKrittScanRepository } from "../Services/OpenKrittScanRepository.ts";
import { OpenKrittSnapshotService } from "./OpenKrittSnapshotService.ts";
import {
  mapOpenKrittStatus,
  nextOpenKrittPollDelayMs,
  nextOpenKrittPollFailureCount,
  openKrittPollKey,
} from "../openKrittStatus.ts";

const EXTERNAL_SCAN_PREFIX = "external-scan:";
const MAX_SCAN_ROWS_PER_TICK = 100;
/** The non-terminal run states an Open Kritt scan can occupy while it still needs polling. */
const ACTIVE_SCAN_STATES = ["queued", "running", "waiting"] as const satisfies ReadonlyArray<
  IntegrationRun["state"]
>;
const UNATTACHED_SNAPSHOT_RETENTION_MS = 60 * 60 * 1_000;

function nowIso(): string {
  // @effect-diagnostics-next-line globalDate:off
  return new Date().toISOString();
}

/**
 * Legacy fallback only. The authoritative external-scan id lives in
 * `open_kritt_scan_correlations`; this reads rows persisted before that table
 * became the source of truth.
 */
function legacyExternalScanIdFromRun(run: IntegrationRun): string | null {
  if (run.source !== "open-kritt" || run.outputSummary === null) return null;
  if (!run.outputSummary.startsWith(EXTERNAL_SCAN_PREFIX)) return null;
  const value =
    run.outputSummary.slice(EXTERNAL_SCAN_PREFIX.length).split("\n", 1)[0]?.trim() ?? "";
  return /^[A-Za-z0-9_.:-]{1,256}$/.test(value) ? value : null;
}

function scanSummary(input: {
  readonly status: string;
  readonly phase: string | null;
  readonly progress: number | null;
  readonly findingCount: number | null;
  readonly duplicateCount: number | null;
}): string {
  const phase = input.phase === null ? "" : `, phase ${input.phase}`;
  const progress = input.progress === null ? "" : `, ${input.progress}%`;
  const findings = input.findingCount === null ? "" : `, ${input.findingCount} findings`;
  const duplicates = input.duplicateCount === null ? "" : `, ${input.duplicateCount} duplicates`;
  return sanitizeIntegrationRunText(
    `Open Kritt status: ${input.status}${phase}${progress}${findings}${duplicates}.`,
    16_384,
  );
}

function durableScanSummary(
  externalScanId: string,
  input: Parameters<typeof scanSummary>[0],
): string {
  return `${EXTERNAL_SCAN_PREFIX}${externalScanId}\n${scanSummary(input)}`;
}

function isTerminal(state: IntegrationRun["state"]): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

export const OpenKrittPollerLive = Layer.effect(
  OpenKrittPoller,
  Effect.gen(function* () {
    const connector = yield* OpenKrittConnector;
    const runs = yield* IntegrationRunRepository;
    const scanRepository = yield* OpenKrittScanRepository;
    const settings = yield* ServerSettingsService;
    const environment = yield* ServerEnvironment;
    const sql = yield* SqlClient.SqlClient;
    const snapshotService = yield* Effect.serviceOption(OpenKrittSnapshotService);
    const withSql = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
      effect.pipe(Effect.provideService(SqlClient.SqlClient, sql));
    // Reading diagnostics cannot fail, and the persistence failure is already
    // absorbed below it, so no outer recovery is reachable here.
    const persistDiagnostics = connector.diagnostics.pipe(
      Effect.flatMap((diagnostics) =>
        withSql(scanRepository.saveDiagnostics(diagnostics)).pipe(Effect.catch(() => Effect.void)),
      ),
    );
    const cleanPendingSnapshots = Effect.gen(function* () {
      if (Option.isNone(snapshotService)) return 0;
      const nowMillis = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
      // @effect-diagnostics-next-line globalDateInEffect:off
      const createdBefore = new Date(nowMillis - UNATTACHED_SNAPSHOT_RETENTION_MS).toISOString();
      const snapshots = yield* withSql(
        scanRepository.listSnapshotsPendingCleanup(createdBefore),
      ).pipe(Effect.orElseSucceed(() => []));
      let cleaned = 0;
      for (const snapshot of snapshots) {
        let scanState: Parameters<
          OpenKrittSnapshotService["Service"]["cleanupSnapshot"]
        >[0]["scanState"] = "cancelled";
        if (snapshot.runId !== null) {
          const run = yield* runs.get(snapshot.runId).pipe(
            Effect.map(Option.getOrNull),
            Effect.orElseSucceed(() => null),
          );
          if (run !== null) {
            if (!isTerminal(run.state)) continue;
            scanState = run.state;
          }
        }
        const cleanup = yield* snapshotService.value
          .cleanupSnapshot({
            snapshotFolderName: snapshot.folderName,
            scanState,
            retainSnapshot: snapshot.retainSnapshot,
          })
          .pipe(Effect.option);
        if (Option.isNone(cleanup)) continue;
        yield* withSql(scanRepository.markSnapshotTerminal(snapshot.snapshotId, nowIso())).pipe(
          Effect.catch(() => Effect.void),
        );
        cleaned += 1;
      }
      return cleaned;
    });

    const reconcileImplementation = Effect.gen(function* () {
      const currentSettings = yield* settings.getSettings;
      if (!currentSettings.integrations.openKritt.enabled) return 0;
      const environmentId = yield* environment.getEnvironmentId;
      const unresolved = yield* withSql(scanRepository.listUnresolvedLaunches(environmentId)).pipe(
        Effect.orElseSucceed(() => []),
      );
      let reconciled = 0;
      for (const intent of unresolved.slice(0, MAX_SCAN_ROWS_PER_TICK)) {
        const result = yield* connector
          .reconcileLaunch({ requestId: intent.requestId })
          .pipe(Effect.orElseSucceed(() => ({ externalScanId: null, exhausted: false })));
        if (result.externalScanId === null) {
          if (result.exhausted) {
            yield* Effect.logWarning(
              "Open Kritt launch reconciliation exhausted its bounded page window without finding the request marker; the run stays unresolved and requires operator inspection.",
            ).pipe(Effect.annotateLogs({ runId: intent.runId }));
          }
          continue;
        }
        yield* withSql(
          scanRepository
            .saveCorrelation({
              requestId: intent.requestId,
              externalScanId: result.externalScanId,
              launchResolution: "reconciled",
            })
            .pipe(Effect.catch(() => Effect.void)),
        );
        const run = yield* runs.get(intent.runId).pipe(
          Effect.map(Option.getOrNull),
          Effect.orElseSucceed(() => null),
        );
        if (run !== null && !isTerminal(run.state)) {
          const updatedAt = nowIso();
          const updated: IntegrationRun = {
            ...run,
            outputSummary: `${EXTERNAL_SCAN_PREFIX}${result.externalScanId}`,
            updatedAt,
            timeline: appendIntegrationRunTimeline(
              run,
              run.state,
              updatedAt,
              "Launch reconciled to an existing Open Kritt scan.",
            ),
          };
          yield* runs.transition(updated, [run.state]).pipe(Effect.orElseSucceed(() => false));
        }
        reconciled += 1;
      }
      return reconciled;
    }).pipe(
      Effect.orElseSucceed(() => 0),
      Effect.tap(() => persistDiagnostics),
    );
    const reconcile: OpenKrittPoller["Service"]["reconcile"] = reconcileImplementation;

    /**
     * Poll the *active* scans, not the newest rows.
     *
     * `runs.list` is newest-first because that is the RPC contract, and under it
     * an older queued/running/waiting scan drops off the page as soon as enough
     * newer rows exist — permanently, since the ordering and the limit are
     * applied together in SQL. Ordering the returned page afterwards cannot fix
     * that: the row was never selected. `listOldestActive` pushes both the
     * non-terminal filter and the ascending order down to the query, so one
     * bounded read always returns the runs closest to starving.
     */
    const listActiveScanRuns = runs.listOldestActive({
      source: "open-kritt",
      states: ACTIVE_SCAN_STATES,
      limit: MAX_SCAN_ROWS_PER_TICK,
    });

    const pollImplementation = Effect.gen(function* () {
      yield* cleanPendingSnapshots;
      const currentSettings = yield* settings.getSettings;
      if (!currentSettings.integrations.openKritt.enabled) return { polled: 0, failed: false };
      const environmentId = yield* environment.getEnvironmentId;
      const rows = yield* listActiveScanRuns;
      const groups = new Map<
        string,
        { readonly externalScanId: string; readonly runs: Array<IntegrationRun> }
      >();
      for (const run of rows) {
        if (isTerminal(run.state)) continue;
        const correlation = yield* withSql(scanRepository.findByRunId(run.id)).pipe(
          Effect.orElseSucceed(() => null),
        );
        const externalScanId = correlation?.externalScanId ?? legacyExternalScanIdFromRun(run);
        if (externalScanId === null) continue;
        const key = openKrittPollKey(environmentId, externalScanId);
        const group = groups.get(key);
        if (group === undefined) {
          groups.set(key, { externalScanId, runs: [run] });
        } else {
          group.runs.push(run);
        }
      }
      const observations = yield* Effect.forEach(
        [...groups.values()],
        (group) =>
          connector.inspectScan({ scanId: group.externalScanId }).pipe(
            Effect.map((observation) => ({ group, observation })),
            // A caught inspect error is a transport/protocol failure, not an
            // upstream 404. Tag it separately so the runtime loop can back off
            // instead of hammering a dead endpoint at the flat interval.
            Effect.orElseSucceed(() => ({
              group,
              observation: { kind: "unreachable" as const, scan: null },
            })),
          ),
        {
          concurrency: Math.max(
            1,
            Math.min(64, currentSettings.integrations.openKritt.pollConcurrency),
          ),
        },
      );
      let polled = 0;
      let failed = false;
      for (const { group, observation } of observations) {
        if (observation.kind === "unreachable") failed = true;
        if (observation.kind === "missing" || observation.scan === null) continue;
        const mapped = mapOpenKrittStatus({
          status: observation.scan.status,
          phase: observation.scan.phase,
        });
        const observedAt = nowIso();
        for (const run of group.runs) {
          const updatedAt = nowIso();
          const terminal = isTerminal(mapped.state);
          const updated: IntegrationRun = {
            ...run,
            state: mapped.state,
            // Keep the opaque upstream id in the bounded durable summary so a
            // restart can resume polling without another launch. The second
            // line is presentation-only and contains no upstream blob.
            outputSummary: durableScanSummary(group.externalScanId, {
              status: observation.scan.status,
              phase: observation.scan.phase,
              progress: observation.scan.progress,
              findingCount: observation.scan.findingCount,
              duplicateCount: observation.scan.duplicateCount,
            }),
            failure: mapped.state === "failed" ? "Open Kritt reported that the scan failed." : null,
            startedAt: run.startedAt ?? (mapped.state === "running" ? updatedAt : null),
            completedAt: terminal ? updatedAt : null,
            updatedAt,
            timeline:
              mapped.state === run.state
                ? run.timeline
                : appendIntegrationRunTimeline(run, mapped.state, updatedAt),
          };
          const transitioned = yield* runs
            .transition(updated, [run.state])
            .pipe(Effect.orElseSucceed(() => false));
          if (transitioned) polled += 1;
        }
        yield* withSql(
          scanRepository
            .saveUpstreamSnapshot(
              group.externalScanId,
              {
                status: mapped.upstreamStatus,
                phase: mapped.upstreamPhase,
                progress: observation.scan.progress,
                findingCount: observation.scan.findingCount,
                duplicateCount: observation.scan.duplicateCount,
                updatedAt: observedAt,
              },
              environmentId,
            )
            .pipe(Effect.catch(() => Effect.void)),
        );
      }
      return { polled, failed };
    }).pipe(
      // A whole-tick failure is also a backoff signal.
      Effect.orElseSucceed(() => ({ polled: 0, failed: true })),
      Effect.tap(() => persistDiagnostics),
    );
    const pollOnce: OpenKrittPoller["Service"]["pollOnce"] = pollImplementation;

    return OpenKrittPoller.of({ reconcile, pollOnce });
  }),
);

export const OpenKrittPollerRuntimeLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const poller = yield* OpenKrittPoller;
    const settings = yield* ServerSettingsService;
    // Consecutive failing ticks widen the delay; any successful observation
    // resets it, so a recovered upstream returns to the configured interval.
    const consecutiveFailures = yield* Ref.make(0);
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          yield* poller.reconcile;
          const tick = yield* poller.pollOnce;
          const failures = yield* Ref.updateAndGet(consecutiveFailures, (count) =>
            nextOpenKrittPollFailureCount(count, tick),
          );
          const current = yield* settings.getSettings;
          const intervalMs = nextOpenKrittPollDelayMs({
            consecutiveFailures: failures,
            baseIntervalMs: current.integrations.openKritt.pollIntervalSeconds * 1_000,
          });
          yield* Effect.sleep(intervalMs);
        }).pipe(
          Effect.catch(() =>
            Ref.update(consecutiveFailures, (count) =>
              nextOpenKrittPollFailureCount(count, { failed: true }),
            ).pipe(Effect.andThen(Effect.sleep(15_000))),
          ),
        ),
      ),
    );
  }),
);
