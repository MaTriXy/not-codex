import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import { SqlitePersistenceMemory } from "../Layers/Sqlite.ts";

const layer = it.layer(Layer.mergeAll(SqlitePersistenceMemory));

layer("038_OpenKrittData", (it) => {
  it.effect("creates bounded scan correlation, snapshot, finding, and diagnostic storage", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 38 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'open_kritt_scan_correlations',
          'open_kritt_scan_snapshots',
          'open_kritt_findings',
          'open_kritt_diagnostics'
        )
        ORDER BY name
      `;
      assert.deepEqual(
        tables.map((table) => table.name),
        [
          "open_kritt_diagnostics",
          "open_kritt_findings",
          "open_kritt_scan_correlations",
          "open_kritt_scan_snapshots",
        ],
      );

      yield* sql`
        INSERT INTO open_kritt_scan_correlations (
          request_id, run_id, environment_id, project_id, external_scan_id, launch_resolution,
          repo_kind, repo_full, commit_sha, configuration_json, created_at, updated_at
        ) VALUES (
          'request-1', 'run-1', 'environment-1', 'project-1', 'scan-1', 'unknown',
          'remote', 'Kritt-ai/open-kritt', 'dabd3d5f82e759bf783955ecc245fea3a984cd38', '{}',
          '2026-08-04T10:00:00.000Z', '2026-08-04T10:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO open_kritt_findings (
          finding_id, scan_id, canonical, duplicate_of, severity, rank, type, summary, explanation,
          path, line, column_number, trigger_flow_json, malicious_input, exploitability,
          malicious_actor, root_bug, triage, source_commit_sha, normalized_fingerprint, created_at, updated_at
        ) VALUES (
          'finding-1', 'scan-1', 1, NULL, 'high', 9, 'xss', 'summary', 'explanation',
          'src/a.ts', 1, NULL, '[]', NULL, 'likely', 'user', NULL, 'untriaged',
          'dabd3d5f82e759bf783955ecc245fea3a984cd38', 'fingerprint-1',
          '2026-08-04T10:00:00.000Z', '2026-08-04T10:00:00.000Z'
        )
      `;

      const correlation = yield* sql<{ readonly launchResolution: string }>`
        SELECT launch_resolution AS "launchResolution"
        FROM open_kritt_scan_correlations
        WHERE request_id = 'request-1'
      `;
      const finding = yield* sql<{ readonly id: string; readonly sourceSha: string }>`
        SELECT finding_id AS "id", source_commit_sha AS "sourceSha"
        FROM open_kritt_findings
        WHERE finding_id = 'finding-1'
      `;
      assert.deepEqual(correlation, [{ launchResolution: "unknown" }]);
      assert.deepEqual(finding, [
        { id: "finding-1", sourceSha: "dabd3d5f82e759bf783955ecc245fea3a984cd38" },
      ]);
    }),
  );

  it.effect(
    "rejects raw prompts, logs, arbitrary blobs, and unbounded external IDs from dedicated storage",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 38 });
        const columns = yield* sql<{
          readonly name: string;
        }>`PRAGMA table_info(open_kritt_findings)`;
        const names = new Set(columns.map((column) => column.name));
        assert.isFalse(names.has("json_answer"));
        assert.isFalse(names.has("raw_logs"));
        assert.isFalse(names.has("prompt"));
        assert.isTrue(names.has("finding_id"));
        assert.isTrue(names.has("normalized_fingerprint"));
      }),
  );
});
