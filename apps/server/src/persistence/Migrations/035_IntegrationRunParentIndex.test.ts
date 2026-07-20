import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("035_IntegrationRunParentIndex", (it) => {
  it.effect("indexes retry-parent lookups used by retention pruning", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 34 });
      const indexesBefore = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(integration_runs)
      `;
      assert.isFalse(indexesBefore.some((index) => index.name === "idx_integration_runs_parent"));

      yield* runMigrations({ toMigrationInclusive: 35 });
      const indexesAfter = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(integration_runs)
      `;
      assert.isTrue(indexesAfter.some((index) => index.name === "idx_integration_runs_parent"));

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA index_info('idx_integration_runs_parent')
      `;
      assert.deepStrictEqual(
        columns.map((column) => column.name),
        ["parent_run_id"],
      );
    }),
  );
});
