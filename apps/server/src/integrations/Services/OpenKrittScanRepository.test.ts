// @effect-diagnostics preferSchemaOverJson:off
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  OpenKrittScanRepository,
  type OpenKrittScanRepositoryShape,
} from "./OpenKrittScanRepository.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { runMigrations } from "../../persistence/Migrations.ts";
import {
  FULL_COMMIT_SHA,
  OPEN_KRITT_FINDING_ID,
  OPEN_KRITT_REQUEST_ID,
  OPEN_KRITT_SCAN_ID,
} from "../test/openKrittTestFixtures.ts";

const layer = it.layer(Layer.mergeAll(SqlitePersistenceMemory));

layer("OpenKrittScanRepository", (it) => {
  it.effect(
    "stores bounded launch intent and returns the existing row for repeated request ids",
    () =>
      Effect.gen(function* () {
        const sqlRepository = yield* OpenKrittScanRepository;
        yield* runMigrations();

        const first = yield* sqlRepository.insertLaunchIntent({
          runId: "run-open-kritt-1",
          requestId: OPEN_KRITT_REQUEST_ID,
          environmentId: "environment-1",
          projectId: "project-126",
          source: {
            repoKind: "remote",
            repoFull: "Kritt-ai/open-kritt",
            commitSha: FULL_COMMIT_SHA,
          },
          configurationSummary: { workflowId: "workflow-synthetic-1", jobLimit: 2 },
          launchResolution: "unknown",
        });
        const second = yield* sqlRepository.insertLaunchIntent({
          runId: "run-open-kritt-duplicate",
          requestId: OPEN_KRITT_REQUEST_ID,
          environmentId: "environment-1",
          projectId: "project-126",
          source: {
            repoKind: "remote",
            repoFull: "Kritt-ai/open-kritt",
            commitSha: FULL_COMMIT_SHA,
          },
          configurationSummary: { workflowId: "workflow-synthetic-1", jobLimit: 2 },
          launchResolution: "unknown",
        });

        assert.isTrue(first.created);
        assert.isFalse(second.created);
        assert.equal(second.runId, "run-open-kritt-1");
        const stored = yield* sqlRepository.findByRequestId(OPEN_KRITT_REQUEST_ID);
        assert.deepEqual(stored?.source.commitSha, FULL_COMMIT_SHA);
        assert.notInclude(JSON.stringify(stored), "Bearer");
      }),
  );

  it.effect(
    "persists an unresolved launch-policy question with the options Open Kritt offered",
    () =>
      Effect.gen(function* () {
        const repository = yield* OpenKrittScanRepository;
        yield* runMigrations();
        yield* repository.insertLaunchIntent({
          runId: "run-open-kritt-policy",
          requestId: "nc126-policy-request",
          environmentId: "environment-1",
          projectId: "project-126",
          source: {
            repoKind: "remote",
            repoFull: "Kritt-ai/open-kritt",
            commitSha: FULL_COMMIT_SHA,
          },
          configurationSummary: { workflowId: "workflow-synthetic-1" },
          launchResolution: "unknown",
        });
        yield* repository.saveCorrelation({
          requestId: "nc126-policy-request",
          externalScanId: null,
          launchResolution: "policy-required",
          launchPolicyChoices: ["wait", "launch-concurrently"],
        });

        const stored = yield* repository.findByRequestId("nc126-policy-request");

        // The pending question has to survive a reload: without the persisted
        // options the user can never answer it against the original request id.
        assert.equal(stored?.launchResolution, "policy-required");
        assert.equal(stored?.externalScanId, null);
        assert.deepEqual([...(stored?.launchPolicyChoices ?? [])], ["wait", "launch-concurrently"]);
      }),
  );

  it.effect("reports origin/root locks and prunes metadata after its owning run expires", () =>
    Effect.gen(function* () {
      const repository = yield* OpenKrittScanRepository;
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* repository.insertLaunchIntent({
        runId: "run-open-kritt-expired",
        requestId: "request-open-kritt-expired",
        environmentId: "environment-1",
        projectId: "project-126",
        source: {
          repoKind: "remote",
          repoFull: "Kritt-ai/open-kritt",
          commitSha: FULL_COMMIT_SHA,
        },
        configurationSummary: { workflowId: "workflow-synthetic-1" },
        launchResolution: "accepted",
      });
      yield* repository.saveCorrelation({
        requestId: "request-open-kritt-expired",
        externalScanId: "scan-open-kritt-expired",
        launchResolution: "accepted",
      });
      yield* repository.saveSnapshot({
        snapshotId: "snapshot-open-kritt-expired",
        projectId: "project-126",
        folderName: "snapshot-open-kritt-expired",
        manifestDigest: "a".repeat(64),
        fileCount: 1,
        byteCount: 10,
        exclusions: [],
        sourceCommitSha: FULL_COMMIT_SHA,
        dirty: false,
        retainSnapshot: false,
      });
      yield* repository.attachSnapshotToRun(
        "snapshot-open-kritt-expired",
        "run-open-kritt-expired",
      );
      yield* repository.upsertNormalizedFinding({
        id: "finding-open-kritt-expired",
        scanId: "scan-open-kritt-expired",
        canonical: true,
        duplicateOf: null,
        severity: "high",
        rank: 1,
        type: "command-injection",
        summary: "summary",
        explanation: "explanation",
        path: "src/example.ts",
        line: 1,
        triggerFlow: ["request -> shell"],
        maliciousInput: "$(id)",
        exploitability: "likely",
        maliciousActor: "user",
        triage: "untriaged",
        sourceCommitSha: FULL_COMMIT_SHA,
      });

      assert.isTrue(yield* repository.hasCorrelations());
      assert.isTrue(yield* repository.hasManagedSnapshots());
      yield* repository.pruneOrphanedMetadata();
      assert.isFalse(yield* repository.hasCorrelations());
      assert.isFalse(yield* repository.hasManagedSnapshots());
      const findingRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM open_kritt_findings
        WHERE finding_id = 'finding-open-kritt-expired'
      `;
      assert.equal(findingRows[0]?.count, 0);
    }),
  );

  it.effect(
    "persists external correlation, bounded upstream snapshots, normalized findings, and triage metadata",
    () =>
      Effect.gen(function* () {
        const repository = yield* OpenKrittScanRepository;
        yield* runMigrations();

        yield* repository.insertLaunchIntent({
          runId: "run-open-kritt-correlation",
          requestId: OPEN_KRITT_REQUEST_ID,
          environmentId: "environment-1",
          projectId: "project-126",
          source: {
            repoKind: "remote",
            repoFull: "Kritt-ai/open-kritt",
            commitSha: FULL_COMMIT_SHA,
          },
          configurationSummary: { workflowId: "workflow-synthetic-1" },
          launchResolution: "unknown",
        });
        yield* repository.saveCorrelation({
          requestId: OPEN_KRITT_REQUEST_ID,
          externalScanId: OPEN_KRITT_SCAN_ID,
          launchResolution: "accepted",
        });
        yield* repository.saveUpstreamSnapshot(OPEN_KRITT_SCAN_ID, {
          status: "running",
          phase: "analysis",
          progress: 42,
          findingCount: 2,
          duplicateCount: 1,
          updatedAt: "2026-08-04T10:00:00.000Z",
        });
        yield* repository.upsertNormalizedFinding({
          id: OPEN_KRITT_FINDING_ID,
          scanId: OPEN_KRITT_SCAN_ID,
          canonical: true,
          duplicateOf: null,
          severity: "high",
          rank: 9,
          type: "command-injection",
          summary: "safe summary",
          explanation: "safe explanation",
          path: "src/example.ts",
          line: 42,
          triggerFlow: ["request -> shell"],
          maliciousInput: "$(id)",
          exploitability: "likely",
          maliciousActor: "unauthenticated-user",
          triage: "untriaged",
          sourceCommitSha: FULL_COMMIT_SHA,
        });

        const scan = yield* repository.findByExternalScanId(OPEN_KRITT_SCAN_ID);
        const finding = yield* repository.getFinding(OPEN_KRITT_FINDING_ID);
        assert.equal(scan?.upstreamStatus, "running");
        assert.equal(finding?.id, OPEN_KRITT_FINDING_ID);
        assert.equal(finding?.sourceCommitSha, FULL_COMMIT_SHA);
        assert.notProperty(finding, "jsonAnswer");
        assert.notProperty(finding, "rawLogs");

        yield* repository.saveSnapshot({
          snapshotId: "snapshot-open-kritt-1",
          projectId: "project-126",
          folderName: "snapshot-open-kritt-1",
          manifestDigest: "a".repeat(64),
          fileCount: 1,
          byteCount: 12,
          exclusions: [".env"],
          sourceCommitSha: FULL_COMMIT_SHA,
          dirty: true,
          retainSnapshot: false,
        });
        const unattached = yield* repository.findSnapshot("snapshot-open-kritt-1");
        assert.equal(unattached?.runId, null);
        yield* repository.attachSnapshotToRun(
          "snapshot-open-kritt-1",
          "run-open-kritt-correlation",
        );
        // Retrying a paid local launch reattaches the same snapshot to the same
        // stable run id. That retry is idempotent, while a different run still
        // cannot steal the snapshot.
        yield* repository.attachSnapshotToRun(
          "snapshot-open-kritt-1",
          "run-open-kritt-correlation",
        );
        const conflictingAttach = yield* Effect.exit(
          repository.attachSnapshotToRun("snapshot-open-kritt-1", "run-open-kritt-other"),
        );
        assert.equal(conflictingAttach._tag, "Failure");
        const attached = yield* repository.findSnapshotForRun("run-open-kritt-correlation");
        assert.equal(attached?.snapshotId, "snapshot-open-kritt-1");
        yield* repository.releaseSnapshotFromRun("snapshot-open-kritt-1", "run-open-kritt-other");
        assert.equal(
          (yield* repository.findSnapshot("snapshot-open-kritt-1"))?.runId,
          attached?.runId,
        );
        yield* repository.releaseSnapshotFromRun(
          "snapshot-open-kritt-1",
          "run-open-kritt-correlation",
        );
        assert.isNull((yield* repository.findSnapshot("snapshot-open-kritt-1"))?.runId);
        yield* repository.attachSnapshotToRun(
          "snapshot-open-kritt-1",
          "run-open-kritt-correlation",
        );
        yield* repository.markSnapshotTerminal("snapshot-open-kritt-1", "2026-08-04T10:00:00.000Z");
        const terminal = yield* repository.findSnapshot("snapshot-open-kritt-1");
        assert.equal(terminal?.terminalAt, "2026-08-04T10:00:00.000Z");
      }),
  );

  it.effect("keeps an unknown launch available for bounded reconciliation after restart", () =>
    Effect.gen(function* () {
      const repository = yield* OpenKrittScanRepository;
      yield* runMigrations();
      const marker = yield* repository.listUnresolvedLaunches();
      assert.isArray(marker);
      assert.isAtMost(marker.length, 100);
    }),
  );

  it.effect("rotates attempted unknown launches behind untouched reconciliation work", () =>
    Effect.gen(function* () {
      const repository = yield* OpenKrittScanRepository;
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`DELETE FROM open_kritt_scan_correlations`;
      for (let index = 0; index < 101; index += 1) {
        const suffix = String(index).padStart(3, "0");
        yield* repository.insertLaunchIntent({
          runId: `run-reconcile-${suffix}`,
          requestId: `request-reconcile-${suffix}`,
          environmentId: "environment-1",
          projectId: "project-126",
          source: {
            repoKind: "remote",
            repoFull: "Kritt-ai/open-kritt",
            commitSha: FULL_COMMIT_SHA,
          },
          configurationSummary: { workflowId: "workflow-synthetic-1" },
          launchResolution: "unknown",
        });
      }
      yield* sql`
        UPDATE open_kritt_scan_correlations
        SET created_at = '2000-01-01T00:00:00.000Z', updated_at = '2000-01-01T00:00:00.000Z'
      `;
      const firstPage = yield* repository.listUnresolvedLaunches("environment-1");
      assert.lengthOf(firstPage, 100);
      assert.notInclude(
        firstPage.map((item) => item.requestId),
        "request-reconcile-100",
      );
      yield* Effect.forEach(
        firstPage,
        (item) => repository.touchLaunchReconciliation(item.requestId),
        { discard: true },
      );

      const nextPage = yield* repository.listUnresolvedLaunches("environment-1");
      assert.equal(nextPage[0]?.requestId, "request-reconcile-100");
    }),
  );

  it.effect("selects pollable scans without letting unresolved launches fill the page", () =>
    Effect.gen(function* () {
      const repository = yield* OpenKrittScanRepository;
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`DELETE FROM open_kritt_scan_correlations`;
      yield* sql`DELETE FROM integration_runs`;
      for (let index = 0; index < 100; index += 1) {
        const suffix = String(index).padStart(3, "0");
        const runId = `run-unresolved-${suffix}`;
        const requestId = `request-unresolved-${suffix}`;
        yield* sql`
          INSERT INTO integration_runs
            (run_id, source, state, project_id, parent_run_id, attempt, run_json, created_at, updated_at, completed_at)
          VALUES (${runId}, 'open-kritt', 'waiting', NULL, NULL, 0, ${JSON.stringify({ outputSummary: null })}, '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z', NULL)
        `;
        yield* repository.insertLaunchIntent({
          runId,
          requestId,
          environmentId: "environment-1",
          projectId: "project-126",
          source: {
            repoKind: "remote",
            repoFull: "Kritt-ai/open-kritt",
            commitSha: FULL_COMMIT_SHA,
          },
          configurationSummary: { workflowId: "workflow-synthetic-1" },
          launchResolution: "policy-required",
        });
      }
      yield* sql`
        INSERT INTO integration_runs
          (run_id, source, state, project_id, parent_run_id, attempt, run_json, created_at, updated_at, completed_at)
        VALUES ('run-pollable', 'open-kritt', 'running', NULL, NULL, 0, ${JSON.stringify({ outputSummary: `external-scan:${OPEN_KRITT_SCAN_ID}` })}, '2030-01-02T00:00:00.000Z', '2030-01-02T00:00:00.000Z', NULL)
      `;
      yield* repository.insertLaunchIntent({
        runId: "run-pollable",
        requestId: "request-pollable",
        environmentId: "environment-1",
        projectId: "project-126",
        source: { repoKind: "remote", repoFull: "Kritt-ai/open-kritt", commitSha: FULL_COMMIT_SHA },
        configurationSummary: { workflowId: "workflow-synthetic-1" },
        launchResolution: "accepted",
      });
      yield* repository.saveCorrelation({
        requestId: "request-pollable",
        externalScanId: OPEN_KRITT_SCAN_ID,
        launchResolution: "accepted",
      });

      const pollable = yield* repository.listPollableRuns({
        environmentId: "environment-1",
        limit: 100,
      });
      assert.deepEqual(pollable, [{ runId: "run-pollable", externalScanId: OPEN_KRITT_SCAN_ID }]);
    }),
  );

  it.effect("fails closed when persisted finding enum data is malformed", () =>
    Effect.gen(function* () {
      const repository = yield* OpenKrittScanRepository;
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();

      yield* repository.insertLaunchIntent({
        runId: "run-open-kritt-malformed",
        requestId: "nc126-malformed-persisted",
        environmentId: "environment-1",
        projectId: "project-126",
        source: { repoKind: "remote", repoFull: "Kritt-ai/open-kritt", commitSha: FULL_COMMIT_SHA },
        configurationSummary: { workflowId: "workflow-synthetic-1" },
        launchResolution: "accepted",
      });
      yield* repository.saveCorrelation({
        requestId: "nc126-malformed-persisted",
        externalScanId: "scan-open-kritt-malformed",
        launchResolution: "accepted",
      });
      yield* repository.upsertNormalizedFinding({
        id: "finding-open-kritt-malformed",
        scanId: "scan-open-kritt-malformed",
        canonical: true,
        duplicateOf: null,
        severity: "high",
        rank: 1,
        type: "command-injection",
        summary: "summary",
        explanation: "explanation",
        path: "src/example.ts",
        line: 1,
        triggerFlow: ["request -> shell"],
        maliciousInput: "$(id)",
        exploitability: "likely",
        maliciousActor: "user",
        triage: "untriaged",
        sourceCommitSha: FULL_COMMIT_SHA,
      });

      yield* sql`PRAGMA ignore_check_constraints = ON`;
      yield* sql`
        UPDATE open_kritt_findings
        SET severity = 'not-a-severity'
        WHERE finding_id = 'finding-open-kritt-malformed'
      `;
      const result = yield* Effect.result(repository.getFinding("finding-open-kritt-malformed"));
      assert.equal(result._tag, "Failure");

      yield* sql`
        UPDATE open_kritt_scan_correlations
        SET commit_sha = NULL
        WHERE request_id = 'nc126-malformed-persisted'
      `;
      const sourceResult = yield* Effect.result(
        repository.findByRequestId("nc126-malformed-persisted"),
      );
      assert.equal(sourceResult._tag, "Failure");
    }),
  );
});

const repositoryShapeContract: OpenKrittScanRepositoryShape | null = null;
void repositoryShapeContract;
