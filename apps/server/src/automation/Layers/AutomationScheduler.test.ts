import * as NodeServices from "@effect/platform-node/NodeServices";
import { AutomationDefinition } from "@notcodex/contracts";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { AutomationRepositoryLive } from "../../persistence/Layers/AutomationRepository.ts";
import { AutomationRepository } from "../../persistence/Services/AutomationRepository.ts";
import { AutomationScheduler } from "../Services/AutomationScheduler.ts";
import { AutomationEventBusLive } from "./AutomationEventBus.ts";
import { AutomationServiceLive } from "./AutomationService.ts";
import { AutomationSchedulerLive } from "./AutomationScheduler.ts";

const sqlite = NodeSqliteClient.layerMemory();
const serviceLayer = AutomationServiceLive.pipe(
  Layer.provideMerge(AutomationRepositoryLive),
  Layer.provideMerge(AutomationEventBusLive),
  Layer.provideMerge(sqlite),
);
const schedulerLayer = AutomationSchedulerLive.pipe(
  Layer.provideMerge(AutomationRepositoryLive),
  Layer.provideMerge(serviceLayer),
  Layer.provideMerge(sqlite),
);
const decodeDefinition = Schema.decodeUnknownSync(AutomationDefinition);

const definition = decodeDefinition({
  id: "automation-scheduled",
  projectId: "project-1",
  name: "Scheduled health",
  description: null,
  enabled: true,
  prompt: "Review the repository.",
  modelSelection: { instanceId: "codex", model: "gpt-5" },
  runtimeMode: "approval-required",
  schedule: { type: "interval", everyMinutes: 60, anchorAt: "2026-07-16T00:00:00.000Z" },
  execution: {
    worktreeMode: "isolated",
    approvalHandling: "pause",
    maxDurationMinutes: 60,
    baseBranch: null,
    cleanupOnSuccess: false,
  },
  completion: { type: "turn-completed" },
  retry: { maxAttempts: 1, initialDelaySeconds: 0, maxDelaySeconds: 0 },
  publish: { type: "never" },
  notifications: { onStarted: false, onWaiting: true, onSucceeded: true, onFailed: true },
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
  nextRunAt: "2026-07-16T01:00:00.000Z",
  deletedAt: null,
});

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

it.layer(NodeServices.layer)("AutomationScheduler", (it) => {
  it.effect("queues a due slot once and advances from the current clock", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(
        DateTime.toEpochMillis(DateTime.makeUnsafe("2026-07-16T01:05:00.000Z")),
      );
      yield* prepare;
      const repository = yield* AutomationRepository;
      const scheduler = yield* AutomationScheduler;
      yield* repository.upsertDefinition(definition);

      assert.equal(yield* scheduler.tick, 1);
      assert.equal(yield* scheduler.tick, 0);
      const runs = yield* repository.listRuns({ automationId: definition.id, limit: 20 });
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.scheduledFor, definition.nextRunAt);
      const advanced = Option.getOrThrow(yield* repository.getDefinition(definition.id));
      assert.equal(advanced.nextRunAt, "2026-07-16T02:00:00.000Z");
    }).pipe(Effect.provide(schedulerLayer)),
  );
});
