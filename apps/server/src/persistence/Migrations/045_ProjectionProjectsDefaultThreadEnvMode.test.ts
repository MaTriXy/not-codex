import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("045_ProjectionProjectsDefaultThreadEnvMode", (it) => {
  it.effect("adds a nullable project workspace default", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 44 });
      yield* runMigrations({ toMigrationInclusive: 45 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_projects)
      `;
      const column = columns.find((candidate) => candidate.name === "default_thread_env_mode");

      assert.equal(column?.name, "default_thread_env_mode");
      assert.equal(column?.notnull, 0);
    }),
  );
});
