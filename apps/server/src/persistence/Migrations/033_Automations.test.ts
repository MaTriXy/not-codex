import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("033_Automations", (it) => {
  it.effect("creates durable definition, run, event, lease, and idempotency storage", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'automation_%'
        ORDER BY name
      `;
      assert.deepStrictEqual(
        tables.map((row) => row.name),
        ["automation_definitions", "automation_run_events", "automation_runs"],
      );

      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_automation_%'
        ORDER BY name
      `;
      assert.isTrue(indexes.some((row) => row.name === "idx_automation_runs_one_active"));
      assert.isTrue(
        indexes.some((row) => row.name === "idx_automation_runs_scheduled_idempotency"),
      );
      assert.isTrue(indexes.some((row) => row.name === "idx_automation_definitions_due"));
    }),
  );
});
