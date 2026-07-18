import { assert, it } from "@effect/vitest";
import { IntegrationRun } from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import { IntegrationRunRepository } from "../Services/IntegrationRunRepository.ts";
import { IntegrationRunRepositoryLive } from "./IntegrationRunRepository.ts";

const layer = it.layer(
  IntegrationRunRepositoryLive.pipe(Layer.provideMerge(NodeSqliteClient.layerMemory())),
);
const decode = Schema.decodeUnknownSync(IntegrationRun);
const run = (id: string, state: "queued" | "running" | "succeeded" = "queued") =>
  decode({
    id,
    source: "monkey-d-loopy",
    state,
    projectId: "project-1",
    parentRunId: null,
    attempt: 0,
    threadIds: [],
    journalRef: null,
    outputSummary: null,
    failure: null,
    createdAt: `2026-07-18T00:00:0${id.at(-1)}.000Z`,
    startedAt: null,
    completedAt: null,
    updatedAt: `2026-07-18T00:00:0${id.at(-1)}.000Z`,
  });

const prepare = Effect.gen(function* () {
  yield* runMigrations();
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM integration_runs`;
  yield* sql`
    INSERT INTO projection_projects (project_id, title, workspace_root, default_model_selection_json, scripts_json, created_at, updated_at, deleted_at)
    VALUES ('project-1', 'Project', '/tmp/project', NULL, '[]', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z', NULL)
    ON CONFLICT (project_id) DO NOTHING
  `;
});

layer("IntegrationRunRepository", (it) => {
  it.effect("persists guarded lifecycle transitions and leaves terminal records immutable", () =>
    Effect.gen(function* () {
      const repository = yield* IntegrationRunRepository;
      yield* prepare;
      const queued = run("run-1");
      yield* repository.insert(queued);
      const running = { ...queued, state: "running" as const, startedAt: queued.createdAt };
      assert.isTrue(yield* repository.transition(running, ["queued"]));
      const succeeded = {
        ...running,
        state: "succeeded" as const,
        outputSummary: "safe summary",
        completedAt: running.createdAt,
      };
      assert.isTrue(yield* repository.transition(succeeded, ["running"]));
      assert.isFalse(yield* repository.transition({ ...succeeded, state: "failed" }, ["running"]));
      const stored = yield* repository.get(succeeded.id);
      assert.deepStrictEqual(Option.getOrThrow(stored).state, "succeeded");
    }),
  );

  it.effect("uses bounded keyset pagination", () =>
    Effect.gen(function* () {
      const repository = yield* IntegrationRunRepository;
      yield* prepare;
      yield* repository.insert(run("run-1"));
      yield* repository.insert(run("run-2"));
      yield* repository.insert(run("run-3"));
      const first = yield* repository.list({ limit: 2 });
      assert.deepStrictEqual(
        first.map((item) => item.id),
        ["run-3", "run-2", "run-1"],
      );
      const second = yield* repository.list({
        limit: 2,
        cursor: { createdAt: first[1]!.createdAt, id: first[1]!.id },
      });
      assert.deepStrictEqual(
        second.map((item) => item.id),
        ["run-1"],
      );
    }),
  );
});
