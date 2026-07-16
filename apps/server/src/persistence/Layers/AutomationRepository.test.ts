import {
  AutomationDefinition,
  AutomationRun,
  AutomationRunEvent,
  AutomationRunId,
} from "@notcodex/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import { AutomationRepository } from "../Services/AutomationRepository.ts";
import { AutomationRepositoryLive } from "./AutomationRepository.ts";

const sqlite = NodeSqliteClient.layerMemory();
const layer = it.layer(AutomationRepositoryLive.pipe(Layer.provideMerge(sqlite)));

const decodeDefinition = Schema.decodeUnknownSync(AutomationDefinition);
const decodeRun = Schema.decodeUnknownSync(AutomationRun);
const decodeEvent = Schema.decodeUnknownSync(AutomationRunEvent);

function definition() {
  return decodeDefinition({
    id: "automation-health",
    projectId: "project-1",
    name: "Repository health",
    description: null,
    enabled: true,
    prompt: "Review the repository and run checks.",
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    runtimeMode: "approval-required",
    schedule: {
      type: "interval",
      everyMinutes: 60,
      anchorAt: "2026-07-16T00:00:00.000Z",
    },
    execution: {
      worktreeMode: "isolated",
      approvalHandling: "pause",
      maxDurationMinutes: 60,
      baseBranch: null,
      cleanupOnSuccess: false,
    },
    completion: { type: "turn-completed" },
    retry: { maxAttempts: 2, initialDelaySeconds: 30, maxDelaySeconds: 300 },
    publish: { type: "never" },
    notifications: {
      onStarted: false,
      onWaiting: true,
      onSucceeded: true,
      onFailed: true,
    },
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    nextRunAt: "2026-07-16T01:00:00.000Z",
    deletedAt: null,
  });
}

function run(definitionValue = definition()) {
  return decodeRun({
    id: "run-1",
    automationId: definitionValue.id,
    definitionSnapshot: {
      id: definitionValue.id,
      projectId: definitionValue.projectId,
      name: definitionValue.name,
      description: definitionValue.description,
      enabled: definitionValue.enabled,
      prompt: definitionValue.prompt,
      modelSelection: definitionValue.modelSelection,
      runtimeMode: definitionValue.runtimeMode,
      schedule: definitionValue.schedule,
      execution: definitionValue.execution,
      completion: definitionValue.completion,
      retry: definitionValue.retry,
      publish: definitionValue.publish,
      notifications: definitionValue.notifications,
      capturedAt: "2026-07-16T01:00:00.000Z",
    },
    trigger: "scheduled",
    status: "queued",
    scheduledFor: "2026-07-16T01:00:00.000Z",
    attempt: 1,
    threadId: null,
    turnId: null,
    worktreePath: null,
    branch: null,
    baseRevision: null,
    headRevision: null,
    pullRequestUrl: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    startedAt: null,
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-16T01:00:00.000Z",
    updatedAt: "2026-07-16T01:00:00.000Z",
  });
}

const prepare = Effect.gen(function* () {
  yield* runMigrations();
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM automation_run_events`;
  yield* sql`DELETE FROM automation_runs`;
  yield* sql`DELETE FROM automation_definitions`;
  yield* sql`DELETE FROM projection_projects`;
  yield* sql`
    INSERT INTO projection_projects (
      project_id, title, workspace_root, default_model_selection_json,
      scripts_json, created_at, updated_at, deleted_at
    ) VALUES (
      'project-1', 'Project', '/tmp/project', NULL, '[]',
      '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z', NULL
    )
  `;
});

layer("AutomationRepository", (it) => {
  it.effect("persists definitions and lists only due enabled rows", () =>
    Effect.gen(function* () {
      yield* prepare;
      const repository = yield* AutomationRepository;
      const value = definition();
      yield* repository.upsertDefinition(value);

      assert.deepStrictEqual(Option.getOrThrow(yield* repository.getDefinition(value.id)), value);
      assert.deepStrictEqual(
        yield* repository.listDueDefinitions({
          now: "2026-07-16T01:00:00.000Z",
          limit: 20,
        }),
        [value],
      );

      yield* repository.softDeleteDefinition({
        automationId: value.id,
        deletedAt: "2026-07-16T01:01:00.000Z",
      });
      assert.isTrue(Option.isNone(yield* repository.getDefinition(value.id)));
    }),
  );

  it.effect("inserts idempotently and claims a due run with a lease", () =>
    Effect.gen(function* () {
      yield* prepare;
      const repository = yield* AutomationRepository;
      const definitionValue = definition();
      const runValue = run(definitionValue);
      yield* repository.upsertDefinition(definitionValue);

      assert.isTrue(Option.isSome(yield* repository.insertRun(runValue)));
      assert.isTrue(
        Option.isNone(
          yield* repository.insertRun({
            ...runValue,
            id: AutomationRunId.make("run-duplicate"),
            trigger: "manual",
            scheduledFor: "2026-07-16T01:05:00.000Z",
          }),
        ),
      );

      const claimed = Option.getOrThrow(
        yield* repository.claimNextRun({
          owner: "server-1",
          now: "2026-07-16T01:00:00.000Z",
          leaseExpiresAt: "2026-07-16T01:01:00.000Z",
        }),
      );
      assert.equal(claimed.status, "preparing");
      assert.equal(claimed.leaseOwner, "server-1");
      assert.isTrue(
        Option.isNone(
          yield* repository.claimNextRun({
            owner: "server-2",
            now: "2026-07-16T01:00:30.000Z",
            leaseExpiresAt: "2026-07-16T01:01:30.000Z",
          }),
        ),
      );
    }),
  );

  it.effect("renews owned leases and reclaims expired in-flight work", () =>
    Effect.gen(function* () {
      yield* prepare;
      const repository = yield* AutomationRepository;
      const definitionValue = definition();
      yield* repository.upsertDefinition(definitionValue);
      yield* repository.insertRun(run(definitionValue));

      const claimed = Option.getOrThrow(
        yield* repository.claimNextRun({
          owner: "server-1",
          now: "2026-07-16T01:00:00.000Z",
          leaseExpiresAt: "2026-07-16T01:01:00.000Z",
        }),
      );
      const renewed = Option.getOrThrow(
        yield* repository.renewRunLease({
          runId: claimed.id,
          owner: "server-1",
          now: "2026-07-16T01:00:30.000Z",
          leaseExpiresAt: "2026-07-16T01:02:00.000Z",
        }),
      );
      assert.equal(renewed.leaseExpiresAt, "2026-07-16T01:02:00.000Z");
      assert.isTrue(
        Option.isNone(
          yield* repository.renewRunLease({
            runId: claimed.id,
            owner: "server-2",
            now: "2026-07-16T01:00:45.000Z",
            leaseExpiresAt: "2026-07-16T01:03:00.000Z",
          }),
        ),
      );

      const recovered = Option.getOrThrow(
        yield* repository.claimNextRun({
          owner: "server-2",
          now: "2026-07-16T01:02:01.000Z",
          leaseExpiresAt: "2026-07-16T01:04:00.000Z",
        }),
      );
      assert.equal(recovered.leaseOwner, "server-2");
      assert.equal(recovered.status, "preparing");
    }),
  );

  it.effect("appends an idempotent ordered run timeline", () =>
    Effect.gen(function* () {
      yield* prepare;
      const repository = yield* AutomationRepository;
      const definitionValue = definition();
      const runValue = run(definitionValue);
      yield* repository.upsertDefinition(definitionValue);
      yield* repository.insertRun(runValue);
      const event = decodeEvent({
        id: "event-1",
        runId: runValue.id,
        kind: "queued",
        message: "Scheduled run queued.",
        payload: {},
        createdAt: "2026-07-16T01:00:00.000Z",
      });
      yield* repository.appendRunEvent(event);
      yield* repository.appendRunEvent(event);
      assert.deepStrictEqual(yield* repository.listRunEvents(runValue.id), [event]);
    }),
  );
});
