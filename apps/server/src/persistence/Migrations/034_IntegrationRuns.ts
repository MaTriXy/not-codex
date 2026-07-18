import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS integration_runs (
      run_id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('monkey-d-loopy', 'loopany')),
      state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled')),
      project_id TEXT,
      parent_run_id TEXT,
      attempt INTEGER NOT NULL CHECK (attempt >= 0),
      run_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (parent_run_id) REFERENCES integration_runs(run_id),
      FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_integration_runs_list
    ON integration_runs(created_at DESC, run_id DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_integration_runs_project_list
    ON integration_runs(project_id, created_at DESC, run_id DESC)
    WHERE project_id IS NOT NULL
  `;
});
