import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS integration_connector_state (
      integration_id TEXT PRIMARY KEY CHECK (integration_id IN ('loopany')),
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
