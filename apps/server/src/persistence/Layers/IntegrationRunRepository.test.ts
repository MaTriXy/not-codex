import { assert, it } from "@effect/vitest";
import { IntegrationRun, ProjectId, ThreadId } from "@notcodex/contracts";
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
const run = (id: string, state: IntegrationRun["state"] = "queued") =>
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

  it.effect("inserts stable external run ids only once", () =>
    Effect.gen(function* () {
      const repository = yield* IntegrationRunRepository;
      yield* prepare;
      const external = { ...run("run-1"), source: "loopany" as const, projectId: null };
      const projectId = run("run-2").projectId!;

      assert.isTrue(yield* repository.insertIfAbsent(external));
      assert.isFalse(yield* repository.insertIfAbsent(external));
      assert.deepStrictEqual(Option.getOrThrow(yield* repository.get(external.id)), external);

      const running = { ...external, state: "running" as const, projectId };
      assert.isTrue(yield* repository.transition(running, ["queued"]));
      assert.deepStrictEqual(
        (yield* repository.list({ projectId, limit: 10 })).map((item) => item.id),
        [external.id],
      );
    }),
  );

  it.effect("filters durable history by integration, state, project, and time window", () =>
    Effect.gen(function* () {
      const repository = yield* IntegrationRunRepository;
      yield* prepare;
      yield* repository.insert(run("run-2", "failed"));
      yield* repository.insert(run("run-3", "succeeded"));
      yield* repository.insert({
        ...run("run-4", "succeeded"),
        source: "loopany",
        projectId: null,
      });
      yield* repository.insert(run("run-5", "succeeded"));

      assert.deepStrictEqual(
        (yield* repository.list({
          source: "monkey-d-loopy",
          state: "succeeded",
          projectId: ProjectId.make("project-1"),
          createdAfter: "2026-07-18T00:00:03.000Z",
          createdBefore: "2026-07-18T00:00:06.000Z",
          limit: 10,
        })).map((item) => item.id),
        ["run-5", "run-3"],
      );
    }),
  );

  it.effect("enforces legal waiting, resume, cancellation, and failure transitions", () =>
    Effect.gen(function* () {
      const repository = yield* IntegrationRunRepository;
      yield* prepare;
      const queued = run("run-4");
      yield* repository.insert(queued);

      assert.isFalse(yield* repository.transition({ ...queued, state: "waiting" }, ["queued"]));
      const running = { ...queued, state: "running" as const };
      assert.isTrue(yield* repository.transition(running, ["queued"]));
      const waiting = { ...running, state: "waiting" as const };
      assert.isTrue(yield* repository.transition(waiting, ["running"]));
      assert.isTrue(yield* repository.transition(running, ["waiting"]));
      const cancelled = { ...running, state: "cancelled" as const };
      assert.isTrue(yield* repository.transition(cancelled, ["running"]));
      assert.isTrue(
        yield* repository.transition(
          { ...cancelled, threadIds: [ThreadId.make("thread-after-cancel")] },
          ["cancelled"],
        ),
      );
      assert.isFalse(
        yield* repository.transition({ ...cancelled, state: "succeeded" }, ["cancelled"]),
      );

      const failed = run("run-5");
      yield* repository.insert(failed);
      const restartFailed = { ...failed, state: "failed" as const };
      assert.isTrue(yield* repository.transition(restartFailed, ["queued"]));
      assert.isFalse(
        yield* repository.transition({ ...restartFailed, state: "running" }, ["failed"]),
      );
      assert.isTrue(
        yield* repository.recoverMonkeyLoopy({
          ...restartFailed,
          state: "running",
          completedAt: null,
        }),
      );

      const external = { ...run("run-6", "failed"), source: "loopany" as const };
      yield* repository.insert(external);
      assert.isFalse(yield* repository.recoverMonkeyLoopy({ ...external, state: "running" }));
    }),
  );

  it.effect("prunes only completed runs older than the retention cutoff", () =>
    Effect.gen(function* () {
      const repository = yield* IntegrationRunRepository;
      yield* prepare;
      const old = {
        ...run("run-6", "succeeded"),
        completedAt: "2026-04-01T00:00:00.000Z",
      };
      const active = run("run-7", "running");
      yield* repository.insert(old);
      yield* repository.insert(active);

      assert.deepStrictEqual(yield* repository.pruneCompletedBefore("2026-04-20T00:00:00.000Z"), [
        old.id,
      ]);
      assert.isTrue(Option.isNone(yield* repository.get(old.id)));
      assert.isTrue(Option.isSome(yield* repository.get(active.id)));
    }),
  );
});
