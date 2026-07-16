import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automation_definitions (
      automation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name_key TEXT NOT NULL,
      definition_json TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      next_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_definitions_project_name
    ON automation_definitions(project_id, name_key)
    WHERE deleted_at IS NULL
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_definitions_due
    ON automation_definitions(enabled, next_run_at)
    WHERE deleted_at IS NULL
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automation_runs (
      run_id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      run_json TEXT NOT NULL,
      trigger_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      thread_id TEXT,
      lease_owner TEXT,
      lease_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (automation_id) REFERENCES automation_definitions(automation_id)
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runs_scheduled_idempotency
    ON automation_runs(automation_id, scheduled_for)
    WHERE trigger_kind = 'scheduled'
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runs_one_active
    ON automation_runs(automation_id)
    WHERE status IN (
      'queued',
      'preparing',
      'running',
      'waiting-for-approval',
      'waiting-for-input',
      'retry-wait'
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_runs_claim
    ON automation_runs(status, lease_expires_at, scheduled_for)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_runs_thread
    ON automation_runs(thread_id)
    WHERE thread_id IS NOT NULL
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automation_run_events (
      event_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      event_json TEXT NOT NULL,
      event_kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES automation_runs(run_id) ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_run_events_run
    ON automation_run_events(run_id, created_at, event_id)
  `;
});
