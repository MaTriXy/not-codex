import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Migration 034 encoded the connector allowlist in a SQLite CHECK. Rebuild
  // the table so upgrades preserve rows and indexes without editing history.
  yield* sql`
    CREATE TABLE integration_runs_open_kritt (
      run_id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('monkey-d-loopy', 'loopany', 'open-kritt')),
      state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled')),
      project_id TEXT,
      parent_run_id TEXT,
      attempt INTEGER NOT NULL CHECK (attempt >= 0),
      run_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (parent_run_id) REFERENCES integration_runs_open_kritt(run_id),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
    )
  `;
  yield* sql`
    INSERT INTO integration_runs_open_kritt
      (run_id, source, state, project_id, parent_run_id, attempt, run_json, created_at, updated_at, completed_at)
    SELECT run_id, source, state, project_id, parent_run_id, attempt, run_json, created_at, updated_at, completed_at
    FROM integration_runs
  `;
  yield* sql`DROP TABLE integration_runs`;
  yield* sql`ALTER TABLE integration_runs_open_kritt RENAME TO integration_runs`;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_integration_runs_list
    ON integration_runs(created_at DESC, run_id DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_integration_runs_project_list
    ON integration_runs(project_id, created_at DESC, run_id DESC)
    WHERE project_id IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_integration_runs_parent
    ON integration_runs(parent_run_id)
    WHERE parent_run_id IS NOT NULL
  `;
});
