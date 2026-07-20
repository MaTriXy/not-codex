import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_integration_runs_parent
    ON integration_runs(parent_run_id)
    WHERE parent_run_id IS NOT NULL
  `;
});
