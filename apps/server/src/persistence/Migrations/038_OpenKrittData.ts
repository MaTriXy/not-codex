import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS open_kritt_scan_correlations (
      request_id TEXT PRIMARY KEY CHECK (length(request_id) BETWEEN 1 AND 120),
      run_id TEXT NOT NULL,
      environment_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      external_scan_id TEXT,
      launch_resolution TEXT NOT NULL CHECK (launch_resolution IN ('unknown', 'accepted', 'reconciled', 'policy-required', 'rejected')),
      repo_kind TEXT NOT NULL CHECK (repo_kind IN ('remote', 'local')),
      repo_full TEXT NOT NULL CHECK (length(repo_full) <= 4096),
      commit_sha TEXT,
      configuration_json TEXT NOT NULL CHECK (length(configuration_json) <= 262144),
      -- Bounded JSON array of the launch-policy options Open Kritt offered for a
      -- 'policy-required' outcome, so the pending question survives a reload and
      -- the user can still answer it against the original request id.
      launch_policy_choices TEXT NOT NULL DEFAULT '[]' CHECK (length(launch_policy_choices) <= 1024),
      upstream_status TEXT,
      upstream_phase TEXT,
      progress INTEGER,
      finding_count INTEGER,
      duplicate_count INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (environment_id, external_scan_id)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_open_kritt_scan_correlations_run
    ON open_kritt_scan_correlations(run_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_open_kritt_scan_correlations_external
    ON open_kritt_scan_correlations(environment_id, external_scan_id)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS open_kritt_scan_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      run_id TEXT,
      project_id TEXT NOT NULL,
      folder_name TEXT NOT NULL CHECK (folder_name NOT LIKE '%/%' AND folder_name NOT LIKE '%\\%'),
      manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 64),
      file_count INTEGER NOT NULL CHECK (file_count >= 0),
      byte_count INTEGER NOT NULL CHECK (byte_count >= 0),
      exclusions_json TEXT NOT NULL CHECK (length(exclusions_json) <= 262144),
      source_commit_sha TEXT,
      dirty INTEGER NOT NULL CHECK (dirty IN (0, 1)),
      retain_snapshot INTEGER NOT NULL CHECK (retain_snapshot IN (0, 1)),
      created_at TEXT NOT NULL,
      terminal_at TEXT
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS open_kritt_findings (
      finding_id TEXT PRIMARY KEY CHECK (length(finding_id) BETWEEN 1 AND 256),
      scan_id TEXT NOT NULL,
      canonical INTEGER NOT NULL CHECK (canonical IN (0, 1)),
      duplicate_of TEXT,
      severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info', 'unknown')),
      rank INTEGER CHECK (rank IS NULL OR rank >= 0),
      type TEXT NOT NULL CHECK (length(type) <= 500),
      summary TEXT NOT NULL CHECK (length(summary) <= 16000),
      explanation TEXT NOT NULL CHECK (length(explanation) <= 16000),
      path TEXT NOT NULL CHECK (length(path) <= 4096),
      line INTEGER,
      column_number INTEGER,
      trigger_flow_json TEXT NOT NULL CHECK (length(trigger_flow_json) <= 262144),
      malicious_input TEXT,
      exploitability TEXT NOT NULL CHECK (exploitability IN ('likely', 'possible', 'unlikely', 'unknown')),
      malicious_actor TEXT,
      root_bug TEXT,
      triage TEXT NOT NULL CHECK (triage IN ('interesting', 'uninteresting', 'untriaged')),
      source_commit_sha TEXT,
      snapshot_id TEXT,
      cwe TEXT,
      cvss REAL,
      normalized_fingerprint TEXT NOT NULL CHECK (length(normalized_fingerprint) <= 128),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_open_kritt_findings_scan
    ON open_kritt_findings(scan_id, canonical, rank)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS open_kritt_diagnostics (
      diagnostic_id INTEGER PRIMARY KEY AUTOINCREMENT,
      health TEXT NOT NULL,
      last_successful_contact TEXT,
      next_retry_at TEXT,
      compatibility_version TEXT NOT NULL,
      server_version TEXT,
      recent_events_json TEXT NOT NULL CHECK (length(recent_events_json) <= 262144),
      updated_at TEXT NOT NULL
    )
  `;
});
