import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import { SqlitePersistenceMemory } from "../Layers/Sqlite.ts";

const layer = it.layer(Layer.mergeAll(SqlitePersistenceMemory));

layer("037_IntegrationRunsOpenKritt", (it) => {
  it.effect(
    "rebuilds the historical source constraint transactionally and preserves existing rows/indexes",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 36 });
        yield* sql`
        INSERT INTO integration_runs (
          run_id, source, state, project_id, parent_run_id, attempt, run_json, created_at, updated_at, completed_at
        ) VALUES
          ('legacy-monkey', 'monkey-d-loopy', 'succeeded', NULL, NULL, 0, '{}', '2026-08-04T09:00:00.000Z', '2026-08-04T09:00:00.000Z', '2026-08-04T09:00:00.000Z'),
          ('legacy-loopany', 'loopany', 'failed', NULL, NULL, 1, '{}', '2026-08-04T09:01:00.000Z', '2026-08-04T09:01:00.000Z', '2026-08-04T09:01:00.000Z')
      `;

        yield* runMigrations({ toMigrationInclusive: 37 });
        yield* sql`
        INSERT INTO integration_runs (
          run_id, source, state, project_id, parent_run_id, attempt, run_json, created_at, updated_at, completed_at
        ) VALUES
          ('new-open-kritt', 'open-kritt', 'queued', NULL, NULL, 0, '{}', '2026-08-04T09:02:00.000Z', '2026-08-04T09:02:00.000Z', NULL)
      `;

        const rows = yield* sql<{
          readonly runId: string;
          readonly source: string;
          readonly state: string;
        }>`
        SELECT run_id AS "runId", source, state FROM integration_runs ORDER BY run_id
      `;
        assert.deepEqual(rows, [
          { runId: "legacy-loopany", source: "loopany", state: "failed" },
          { runId: "legacy-monkey", source: "monkey-d-loopy", state: "succeeded" },
          { runId: "new-open-kritt", source: "open-kritt", state: "queued" },
        ]);

        const indexes = yield* sql<{ readonly name: string }>`PRAGMA index_list(integration_runs)`;
        assert.isTrue(indexes.some((index) => index.name === "idx_integration_runs_list"));
        assert.isTrue(indexes.some((index) => index.name === "idx_integration_runs_project_list"));
      }),
  );

  it.effect("keeps invalid source/state combinations rejected after migration", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 37 });
      const error = yield* sql`
        INSERT INTO integration_runs (
          run_id, source, state, project_id, parent_run_id, attempt, run_json, created_at, updated_at, completed_at
        ) VALUES ('invalid-source', 'not-an-integration', 'queued', NULL, NULL, 0, '{}', '2026-08-04T09:00:00.000Z', '2026-08-04T09:00:00.000Z', NULL)
      `.pipe(Effect.flip);
      assert.isTrue(error !== undefined && error !== null);
    }),
  );
});
