import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { AutomationRepositoryLive } from "../../persistence/Layers/AutomationRepository.ts";
import { AutomationService } from "../Services/AutomationService.ts";
import { AutomationEventBusLive } from "./AutomationEventBus.ts";
import { AutomationServiceLive } from "./AutomationService.ts";

const sqlite = NodeSqliteClient.layerMemory();
const serviceLayer = AutomationServiceLive.pipe(
  Layer.provideMerge(AutomationRepositoryLive),
  Layer.provideMerge(AutomationEventBusLive),
  Layer.provideMerge(sqlite),
);

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

const draft = {
  projectId: "project-1" as never,
  name: "Repository health",
  description: null,
  enabled: true,
  prompt: "Review the repository and run checks.",
  modelSelection: { instanceId: "codex" as never, model: "gpt-5" },
  runtimeMode: "approval-required" as const,
  schedule: { type: "manual" as const },
  execution: {
    worktreeMode: "isolated" as const,
    approvalHandling: "pause" as const,
    maxDurationMinutes: 60,
    baseBranch: null,
    cleanupOnSuccess: false,
  },
  completion: { type: "turn-completed" as const },
  retry: { maxAttempts: 2, initialDelaySeconds: 30, maxDelaySeconds: 300 },
  publish: { type: "never" as const },
  notifications: {
    onStarted: false,
    onWaiting: true,
    onSucceeded: true,
    onFailed: true,
  },
};

it.layer(NodeServices.layer)("AutomationService", (it) => {
  it.effect("creates server-owned ids and records a manual run timeline", () =>
    Effect.gen(function* () {
      yield* prepare;
      const service = yield* AutomationService;
      const definition = yield* service.createDefinition(draft);
      assert.isTrue(definition.id.length > 10);
      assert.equal(definition.nextRunAt, null);

      const run = yield* service.runNow({ id: definition.id });
      assert.equal(run.status, "queued");
      assert.equal(run.trigger, "manual");
      const detail = yield* service.getRun({ runId: run.id });
      assert.isNotNull(detail);
      assert.deepStrictEqual(
        detail?.events.map((event) => event.kind),
        ["queued"],
      );
    }).pipe(Effect.provide(serviceLayer)),
  );

  it.effect("updates schedules and preserves terminal cancellation", () =>
    Effect.gen(function* () {
      yield* prepare;
      const service = yield* AutomationService;
      const definition = yield* service.createDefinition(draft);
      const updated = yield* service.updateDefinition({
        id: definition.id,
        patch: {
          schedule: {
            type: "interval",
            everyMinutes: 60,
            anchorAt: "2026-07-16T00:00:00.000Z",
          },
        },
      });
      assert.isNotNull(updated.nextRunAt);

      const run = yield* service.runNow({ id: definition.id });
      const cancelled = yield* service.cancelRun({ runId: run.id });
      assert.equal(cancelled.status, "cancelled");
      assert.isNotNull(cancelled.finishedAt);
      assert.equal((yield* service.cancelRun({ runId: run.id })).status, "cancelled");
    }).pipe(Effect.provide(serviceLayer)),
  );

  it.effect("retries terminal work as a new auditable run", () =>
    Effect.gen(function* () {
      yield* prepare;
      const service = yield* AutomationService;
      const definition = yield* service.createDefinition(draft);
      const run = yield* service.runNow({ id: definition.id });
      const cancelled = yield* service.cancelRun({ runId: run.id });
      const retry = yield* service.retryRun({ runId: cancelled.id });

      assert.notEqual(retry.id, cancelled.id);
      assert.equal(retry.trigger, "retry");
      assert.equal(retry.attempt, cancelled.attempt + 1);
      assert.isNull(retry.threadId);
      assert.deepStrictEqual(
        (yield* service.getRun({ runId: retry.id }))?.events.map((event) => event.kind),
        ["queued"],
      );
    }).pipe(Effect.provide(serviceLayer)),
  );
});
