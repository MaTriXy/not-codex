import { assert, it } from "@effect/vitest";
import { IntegrationRun, ProjectId, ThreadId } from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { runMigrations } from "../Migrations.ts";
import { makeLoopAnyDiagnostics } from "../../integrations/loopAnyDiagnostics.ts";
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

/**
 * Explicit `createdAt` and `source`, unlike `run` above, which derives its
 * timestamp from the id. `listOldestActive` is defined by the interaction of
 * ordering, tie-breaking, filtering, and the limit, so each of those has to be
 * set independently of the id to be asserted on.
 */
const activeRun = (input: {
  readonly id: string;
  readonly source: IntegrationRun["source"];
  readonly state: IntegrationRun["state"];
  readonly createdAt: string;
}) =>
  decode({
    id: input.id,
    source: input.source,
    state: input.state,
    projectId: "project-1",
    parentRunId: null,
    attempt: 0,
    threadIds: [],
    journalRef: null,
    outputSummary: null,
    failure: null,
    createdAt: input.createdAt,
    startedAt: null,
    completedAt:
      input.state === "succeeded" || input.state === "failed" || input.state === "cancelled"
        ? input.createdAt
        : null,
    updatedAt: input.createdAt,
  });

const prepare = Effect.gen(function* () {
  yield* runMigrations();
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM integration_runs`;
  yield* sql`DELETE FROM integration_connector_state`;
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

  it.effect("reads the oldest active runs for one source, bounded and oldest-first", () =>
    Effect.gen(function* () {
      const repository = yield* IntegrationRunRepository;
      yield* prepare;
      // Every row here exists to pin one property of the query. The two rows that
      // must be excluded are deliberately the OLDEST in the table, so any failure
      // of the source or state filter surfaces at the head of an oldest-first
      // result rather than hiding at the tail.
      const otherSourceOldest = activeRun({
        id: "run-other-source",
        source: "monkey-d-loopy",
        state: "queued",
        createdAt: "2026-07-18T00:00:00.000Z",
      });
      const terminalOldest = activeRun({
        id: "run-terminal",
        source: "open-kritt",
        state: "succeeded",
        createdAt: "2026-07-18T00:00:01.000Z",
      });
      // Same instant, different ids: only a run-id tie-break gives a stable order.
      const tieB = activeRun({
        id: "run-active-b",
        source: "open-kritt",
        state: "running",
        createdAt: "2026-07-18T00:00:02.000Z",
      });
      const tieA = activeRun({
        id: "run-active-a",
        source: "open-kritt",
        state: "waiting",
        createdAt: "2026-07-18T00:00:02.000Z",
      });
      const third = activeRun({
        id: "run-active-c",
        source: "open-kritt",
        state: "queued",
        createdAt: "2026-07-18T00:00:03.000Z",
      });
      // Newer than the limit reaches: present only to prove the cap is exact and
      // that the newest rows are the ones dropped, not the oldest.
      const newest = activeRun({
        id: "run-active-d",
        source: "open-kritt",
        state: "running",
        createdAt: "2026-07-18T00:00:04.000Z",
      });
      // Inserted newest-first so insertion order cannot stand in for the ORDER BY.
      for (const record of [newest, third, tieA, tieB, terminalOldest, otherSourceOldest]) {
        yield* repository.insert(record);
      }

      const active = ["queued", "running", "waiting"] as const;
      // Oldest-first with run-id tie-breaking, filtered to the source and the
      // non-terminal states, and capped at exactly `limit` rows — not `limit + 1`,
      // because this is a bounded read rather than a keyset page.
      assert.deepStrictEqual(
        (yield* repository.listOldestActive({
          source: "open-kritt",
          states: active,
          limit: 3,
        })).map((item) => item.id),
        ["run-active-a", "run-active-b", "run-active-c"],
      );

      // A limit above the match count returns every match and still excludes the
      // terminal and other-source rows.
      assert.deepStrictEqual(
        (yield* repository.listOldestActive({
          source: "open-kritt",
          states: active,
          projectId: ProjectId.make("project-1"),
          limit: 50,
        })).map((item) => item.id),
        ["run-active-a", "run-active-b", "run-active-c", "run-active-d"],
      );
      assert.deepStrictEqual(
        yield* repository.listOldestActive({
          source: "open-kritt",
          states: active,
          projectId: ProjectId.make("project-missing"),
          limit: 50,
        }),
        [],
      );

      // A single state proves the IN list filters per state rather than merely
      // excluding terminal rows.
      assert.deepStrictEqual(
        (yield* repository.listOldestActive({
          source: "open-kritt",
          states: ["waiting"],
          limit: 50,
        })).map((item) => item.id),
        ["run-active-a"],
      );

      // The other source sees only its own row, never the open-kritt ones.
      assert.deepStrictEqual(
        (yield* repository.listOldestActive({
          source: "monkey-d-loopy",
          states: active,
          limit: 50,
        })).map((item) => item.id),
        ["run-other-source"],
      );

      // No states means no matches, and asking for none must not be an error.
      // The implementation short-circuits before touching SQL; this pins the
      // observable contract either way, since SQLite would also accept the
      // degenerate `IN ()` and return nothing.
      assert.deepStrictEqual(
        yield* repository.listOldestActive({ source: "open-kritt", states: [], limit: 50 }),
        [],
      );
    }),
  );

  it.effect("guards a transition against every legal previous state at once", () =>
    Effect.gen(function* () {
      const repository = yield* IntegrationRunRepository;
      yield* prepare;
      const queued = run("run-1");
      yield* repository.insert(queued);

      // The elected launch-policy retry guards on two legal previous states at
      // once. Every other test passes a single state, which hides the fact that
      // a multi-value guard is compiled differently: `IN` over more than one
      // value used to be emitted as a row value and failed at prepare time, so
      // this path could never commit.
      assert.isTrue(
        yield* repository.transition({ ...queued, state: "waiting" }, ["queued", "waiting"]),
      );
      assert.deepStrictEqual(Option.getOrThrow(yield* repository.get(queued.id)).state, "waiting");
      // The guard still discriminates: a state outside the legal set is refused.
      assert.isFalse(
        yield* repository.transition({ ...queued, state: "running" }, ["queued", "cancelled"]),
      );
    }),
  );

  it.effect("lets a queued launch wait while its outcome is unresolved", () =>
    Effect.gen(function* () {
      const repository = yield* IntegrationRunRepository;
      yield* prepare;
      const queued = run("run-unresolved-launch");
      yield* repository.insert(queued);
      const waiting = { ...queued, state: "waiting" as const };

      // A launch can become non-terminal but unresolved before it ever runs: an
      // uncertain create request, or an upstream launch-policy question the user
      // has not answered. Both must be representable as waiting, or the
      // uncertainty is invisible and the run reads as merely still queued.
      assert.isTrue(yield* repository.transition(waiting, ["queued"]));
      // Re-answering an unresolved launch stays idempotent.
      assert.isTrue(yield* repository.transition(waiting, ["waiting"]));
      // The remote scan may complete before this poller observes its running
      // phase, so an authoritative terminal observation can finish a waiting
      // run without inventing a local intermediate transition.
      assert.isTrue(yield* repository.transition({ ...queued, state: "succeeded" }, ["waiting"]));
    }),
  );

  it.effect("enforces legal waiting, resume, cancellation, and failure transitions", () =>
    Effect.gen(function* () {
      const repository = yield* IntegrationRunRepository;
      yield* prepare;
      const queued = run("run-4");
      yield* repository.insert(queued);

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
        yield* repository.recoverMonkeyLoopy(
          {
            ...restartFailed,
            state: "running",
            completedAt: null,
          },
          { state: restartFailed.state, failure: restartFailed.failure },
        ),
      );
      const recovered = Option.getOrThrow(yield* repository.get(restartFailed.id));
      const userCancelled = {
        ...recovered,
        state: "cancelled" as const,
        failure: "Cancelled by user",
      };
      assert.isTrue(yield* repository.transition(userCancelled, ["running"]));
      assert.isFalse(
        yield* repository.recoverMonkeyLoopy(
          { ...userCancelled, state: "running", failure: null },
          { state: "cancelled", failure: restartFailed.failure },
        ),
      );
      assert.deepStrictEqual(
        Option.getOrThrow(yield* repository.get(restartFailed.id)),
        userCancelled,
      );

      const external = { ...run("run-6", "failed"), source: "loopany" as const };
      yield* repository.insert(external);
      assert.isFalse(
        yield* repository.recoverMonkeyLoopy(
          { ...external, state: "running" },
          { state: external.state, failure: external.failure },
        ),
      );
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

  it.effect("retains an expired parent while a retained child references it", () =>
    Effect.gen(function* () {
      const repository = yield* IntegrationRunRepository;
      yield* prepare;
      const parent = {
        ...run("run-6", "failed"),
        completedAt: "2026-04-01T00:00:00.000Z",
      };
      const child = {
        ...run("run-7", "succeeded"),
        parentRunId: parent.id,
        attempt: 1,
        completedAt: "2026-07-18T00:01:00.000Z",
      };
      yield* repository.insert(parent);
      yield* repository.insert(child);

      assert.deepStrictEqual(
        yield* repository.pruneCompletedBefore("2026-04-20T00:00:00.000Z"),
        [],
      );
      assert.isTrue(Option.isSome(yield* repository.get(parent.id)));
      assert.isTrue(Option.isSome(yield* repository.get(child.id)));
    }),
  );

  it.effect("prunes an expired child and its expired parent in one retention call", () =>
    Effect.gen(function* () {
      const repository = yield* IntegrationRunRepository;
      yield* prepare;
      const parent = {
        ...run("run-6", "failed"),
        completedAt: "2026-04-01T00:00:00.000Z",
      };
      const child = {
        ...run("run-7", "succeeded"),
        parentRunId: parent.id,
        attempt: 1,
        completedAt: "2026-04-02T00:00:00.000Z",
      };
      yield* repository.insert(parent);
      yield* repository.insert(child);

      assert.deepStrictEqual(
        new Set(yield* repository.pruneCompletedBefore("2026-04-20T00:00:00.000Z")),
        new Set([parent.id, child.id]),
      );
      assert.isTrue(Option.isNone(yield* repository.get(parent.id)));
      assert.isTrue(Option.isNone(yield* repository.get(child.id)));
    }),
  );

  it.effect("persists sanitized connector diagnostics across repository reconstruction", () =>
    Effect.gen(function* () {
      const repository = yield* IntegrationRunRepository;
      yield* prepare;
      const diagnostics = {
        ...makeLoopAnyDiagnostics({ now: "2026-07-19T10:00:00.000Z" }),
        health: "healthy" as const,
        lastPollAt: "2026-07-19T10:00:00.000Z",
        lastSuccessAt: "2026-07-19T10:00:00.000Z",
      };

      assert.isTrue(Option.isNone(yield* repository.getLoopAnyConnectorDiagnostics()));
      yield* repository.putLoopAnyConnectorDiagnostics(diagnostics);
      assert.deepStrictEqual(
        Option.getOrThrow(yield* repository.getLoopAnyConnectorDiagnostics()),
        diagnostics,
      );
    }),
  );
});
