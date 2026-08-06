// @effect-diagnostics preferSchemaOverJson:off
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  OpenKrittDiagnostics as OpenKrittDiagnosticsSchema,
  type OpenKrittDiagnostics,
} from "@notcodex/contracts";

import { fingerprintFinding } from "../openKrittFingerprint.ts";
import {
  decodeOpenKrittExploitability,
  decodeOpenKrittFindingSeverity,
  decodeOpenKrittLaunchResolution,
  decodeOpenKrittRepoKind,
  decodeOpenKrittScanStatus,
  decodeOpenKrittTriage,
  isOpenKrittRecord,
  type OpenKrittExploitability,
  type OpenKrittFindingSeverity,
  type OpenKrittLaunchResolution,
  type OpenKrittRepoKind,
  type OpenKrittScanStatus,
  type OpenKrittTriage,
} from "../openKrittSchemas.ts";

export interface OpenKrittScanSource {
  readonly repoKind: OpenKrittRepoKind;
  readonly repoFull: string;
  readonly commitSha: string | null;
}

export interface OpenKrittLaunchIntent {
  readonly runId: string;
  readonly requestId: string;
  readonly environmentId: string;
  readonly projectId: string;
  readonly source: OpenKrittScanSource;
  readonly configurationSummary: Readonly<Record<string, unknown>>;
  readonly launchResolution: OpenKrittLaunchResolution;
}

export interface OpenKrittScanCorrelation {
  readonly requestId: string;
  readonly runId: string;
  readonly environmentId: string;
  readonly projectId: string;
  readonly externalScanId: string | null;
  readonly launchResolution: OpenKrittLaunchIntent["launchResolution"];
  /** Options offered by a `policy-required` outcome; empty for every other resolution. */
  readonly launchPolicyChoices: ReadonlyArray<string>;
  readonly source: OpenKrittScanSource;
  readonly configurationSummary: Readonly<Record<string, unknown>>;
  readonly upstreamStatus?: OpenKrittScanStatus | null;
  readonly upstreamPhase?: string | null;
  readonly progress?: number | null;
  readonly findingCount?: number | null;
  readonly duplicateCount?: number | null;
}

export interface OpenKrittSnapshotRecord {
  readonly snapshotId: string;
  readonly runId: string | null;
  readonly projectId: string;
  readonly folderName: string;
  readonly manifestDigest: string;
  readonly fileCount: number;
  readonly byteCount: number;
  readonly exclusions: ReadonlyArray<string>;
  readonly sourceCommitSha: string | null;
  readonly dirty: boolean;
  readonly retainSnapshot: boolean;
  readonly createdAt: string;
  readonly terminalAt: string | null;
}

export interface OpenKrittNormalizedFindingInput {
  readonly id: string;
  readonly scanId: string;
  readonly canonical: boolean;
  readonly duplicateOf: string | null;
  readonly severity: OpenKrittFindingSeverity;
  /** Null until the scan's ranking pass has ordered the finding. */
  readonly rank: number | null;
  readonly type: string;
  readonly summary: string;
  readonly explanation: string;
  readonly path: string;
  readonly line: number | null;
  readonly column?: number | null;
  readonly triggerFlow: ReadonlyArray<string>;
  readonly maliciousInput: string | null;
  readonly exploitability: OpenKrittExploitability;
  readonly maliciousActor: string | null;
  readonly rootBug?: string | null;
  readonly triage: OpenKrittTriage;
  readonly sourceCommitSha: string | null;
  readonly snapshotId?: string | null;
  readonly cwe?: string | null;
  readonly cvss?: number | null;
}

export interface OpenKrittPersistedFinding {
  readonly id: string;
  readonly scanId: string;
  readonly canonical: boolean;
  readonly duplicateOf: string | null;
  readonly severity: OpenKrittFindingSeverity;
  /** Null until the scan's ranking pass has ordered the finding. */
  readonly rank: number | null;
  readonly type: string;
  readonly summary: string;
  readonly explanation: string;
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
  readonly triggerFlow: ReadonlyArray<string>;
  readonly maliciousInput: string | null;
  readonly exploitability: OpenKrittExploitability;
  readonly maliciousActor: string | null;
  readonly rootBug: string | null;
  readonly triage: OpenKrittTriage;
  readonly sourceCommitSha: string | null;
  readonly snapshotId: string | null;
  readonly cwe: string | null;
  readonly cvss: number | null;
}

export interface OpenKrittScanRepositoryShape {
  readonly insertLaunchIntent: (
    input: OpenKrittLaunchIntent,
  ) => Effect.Effect<
    { readonly created: boolean; readonly runId: string },
    OpenKrittPersistenceError,
    SqlClient.SqlClient
  >;
  readonly findByRequestId: (
    requestId: string,
  ) => Effect.Effect<
    OpenKrittScanCorrelation | null,
    OpenKrittPersistenceError,
    SqlClient.SqlClient
  >;
  /** Authoritative external-scan lookup for a durable run. */
  readonly findByRunId: (
    runId: string,
  ) => Effect.Effect<
    OpenKrittScanCorrelation | null,
    OpenKrittPersistenceError,
    SqlClient.SqlClient
  >;
  /** Oldest active runs that have an authoritative or legacy external scan id. */
  readonly listPollableRuns: (input: {
    readonly environmentId: string;
    readonly limit: number;
  }) => Effect.Effect<
    ReadonlyArray<{ readonly runId: string; readonly externalScanId: string }>,
    OpenKrittPersistenceError,
    SqlClient.SqlClient
  >;
  readonly saveCorrelation: (input: {
    readonly requestId: string;
    /** Null while the launch has no accepted upstream scan (uncertain, policy-required, rejected). */
    readonly externalScanId: string | null;
    readonly launchResolution: OpenKrittLaunchIntent["launchResolution"];
    readonly launchPolicyChoices?: ReadonlyArray<string>;
    readonly configurationSummary?: Readonly<Record<string, unknown>>;
  }) => Effect.Effect<void, OpenKrittPersistenceError, SqlClient.SqlClient>;
  readonly saveUpstreamSnapshot: (
    scanId: string,
    input: {
      readonly status: OpenKrittScanStatus;
      readonly phase: string | null;
      readonly progress: number | null;
      readonly findingCount: number | null;
      readonly duplicateCount: number | null;
      readonly updatedAt: string;
    },
    environmentId?: string,
  ) => Effect.Effect<void, OpenKrittPersistenceError, SqlClient.SqlClient>;
  readonly saveSnapshot: (
    input: Omit<OpenKrittSnapshotRecord, "runId" | "createdAt" | "terminalAt">,
  ) => Effect.Effect<void, OpenKrittPersistenceError, SqlClient.SqlClient>;
  readonly findSnapshot: (
    snapshotId: string,
  ) => Effect.Effect<
    OpenKrittSnapshotRecord | null,
    OpenKrittPersistenceError,
    SqlClient.SqlClient
  >;
  readonly attachSnapshotToRun: (
    snapshotId: string,
    runId: string,
  ) => Effect.Effect<void, OpenKrittPersistenceError, SqlClient.SqlClient>;
  /** Releases a reservation only when this exact run still owns it. */
  readonly releaseSnapshotFromRun: (
    snapshotId: string,
    runId: string,
  ) => Effect.Effect<void, OpenKrittPersistenceError, SqlClient.SqlClient>;
  readonly findSnapshotForRun: (
    runId: string,
  ) => Effect.Effect<
    OpenKrittSnapshotRecord | null,
    OpenKrittPersistenceError,
    SqlClient.SqlClient
  >;
  readonly listSnapshotsPendingCleanup: (
    createdBefore: string,
  ) => Effect.Effect<
    ReadonlyArray<OpenKrittSnapshotRecord>,
    OpenKrittPersistenceError,
    SqlClient.SqlClient
  >;
  readonly listSnapshotFolderNames: () => Effect.Effect<
    ReadonlyArray<string>,
    OpenKrittPersistenceError,
    SqlClient.SqlClient
  >;
  readonly markSnapshotTerminal: (
    snapshotId: string,
    terminalAt: string,
  ) => Effect.Effect<void, OpenKrittPersistenceError, SqlClient.SqlClient>;
  readonly upsertNormalizedFinding: (
    input: OpenKrittNormalizedFindingInput,
  ) => Effect.Effect<void, OpenKrittPersistenceError, SqlClient.SqlClient>;
  readonly findByExternalScanId: (
    externalScanId: string,
    environmentId?: string,
  ) => Effect.Effect<
    OpenKrittScanCorrelation | null,
    OpenKrittPersistenceError,
    SqlClient.SqlClient
  >;
  readonly getFinding: (
    findingId: string,
    environmentId?: string,
  ) => Effect.Effect<
    OpenKrittPersistedFinding | null,
    OpenKrittPersistenceError,
    SqlClient.SqlClient
  >;
  readonly listFindings: (input: {
    readonly scanId: string;
    readonly includeDuplicates: boolean;
    readonly limit: number;
    readonly cursor?: string | null;
    readonly environmentId?: string;
  }) => Effect.Effect<
    {
      readonly items: ReadonlyArray<OpenKrittPersistedFinding>;
      readonly nextCursor: string | null;
    },
    OpenKrittPersistenceError,
    SqlClient.SqlClient
  >;
  readonly listUnresolvedLaunches: (
    environmentId?: string,
  ) => Effect.Effect<
    ReadonlyArray<OpenKrittScanCorrelation>,
    OpenKrittPersistenceError,
    SqlClient.SqlClient
  >;
  /** Moves one attempted unresolved launch behind untouched work for fair bounded reconciliation. */
  readonly touchLaunchReconciliation: (
    requestId: string,
  ) => Effect.Effect<void, OpenKrittPersistenceError, SqlClient.SqlClient>;
  readonly getDiagnostics: () => Effect.Effect<
    OpenKrittDiagnostics | null,
    OpenKrittPersistenceError,
    SqlClient.SqlClient
  >;
  readonly saveDiagnostics: (
    diagnostics: OpenKrittDiagnostics,
  ) => Effect.Effect<void, OpenKrittPersistenceError, SqlClient.SqlClient>;
}

function now(): string {
  // @effect-diagnostics-next-line globalDate:off
  return new Date().toISOString();
}

/**
 * The single failure type of this repository. Every SQL fault and every
 * malformed persisted row narrows to it, so callers never have to reason about
 * an `unknown` error channel to decide whether Open Kritt state is trustworthy.
 */
export class OpenKrittPersistenceError extends Schema.TaggedErrorClass<OpenKrittPersistenceError>()(
  "OpenKrittPersistenceError",
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.detail;
  }
}

const isOpenKrittPersistenceError = Schema.is(OpenKrittPersistenceError);

const decodeOpenKrittDiagnostics = Schema.decodeUnknownSync(OpenKrittDiagnosticsSchema);

function invalidPersistedValue(label: string): never {
  throw new OpenKrittPersistenceError({ detail: `Invalid persisted Open Kritt ${label}.` });
}

function rowValue(row: Record<string, unknown>, keys: ReadonlyArray<string>): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return undefined;
}

function persistedString(value: unknown, label: string, max = 16_000): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max)
    return invalidPersistedValue(label);
  return value;
}

function persistedNullableString(value: unknown, label: string, max = 16_000): string | null {
  if (value === null) return null;
  return persistedString(value, label, max);
}

function persistedId(value: unknown, label: string, max = 256): string {
  const id = persistedString(value, label, max);
  if (!/^[A-Za-z0-9_.:-]+$/.test(id)) return invalidPersistedValue(label);
  return id;
}

function persistedNullableId(value: unknown, label: string): string | null {
  if (value === null) return null;
  return persistedId(value, label);
}

function persistedCommitSha(value: unknown, label: string): string | null {
  if (value === null) return null;
  const sha = persistedString(value, label, 40);
  if (!/^[0-9a-f]{40}$/.test(sha)) return invalidPersistedValue(label);
  return sha;
}

function persistedInteger(value: unknown, label: string, min = 0, max = 10_000_000): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    return invalidPersistedValue(label);
  return value;
}

function persistedNullableInteger(
  value: unknown,
  label: string,
  min = 0,
  max = 10_000_000,
): number | null {
  if (value === null) return null;
  return persistedInteger(value, label, min, max);
}

function persistedNumber(value: unknown, label: string, min = 0, max = 10): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    return invalidPersistedValue(label);
  return value;
}

function persistedNullableNumber(value: unknown, label: string, min = 0, max = 10): number | null {
  if (value === null) return null;
  return persistedNumber(value, label, min, max);
}

function persistedBoolean(value: unknown, label: string): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return invalidPersistedValue(label);
}

function persistedJson(value: unknown, label: string): unknown {
  if (typeof value !== "string") return invalidPersistedValue(label);
  try {
    return JSON.parse(value);
  } catch {
    return invalidPersistedValue(label);
  }
}

function persistedJsonRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  const decoded = persistedJson(value, label);
  if (!isOpenKrittRecord(decoded)) return invalidPersistedValue(label);
  return decoded;
}

function persistedJsonStrings(
  value: unknown,
  label: string,
  maxItems: number,
): ReadonlyArray<string> {
  const decoded = persistedJson(value, label);
  if (!Array.isArray(decoded) || decoded.length > maxItems) return invalidPersistedValue(label);
  const result: Array<string> = [];
  for (const item of decoded) result.push(persistedString(item, `${label} item`, 4_096));
  return result;
}

function persistedSource(row: Record<string, unknown>): OpenKrittScanSource {
  const repoKind = decodeOpenKrittRepoKind(rowValue(row, ["repo_kind"]));
  const commitSha = persistedCommitSha(rowValue(row, ["commit_sha"]), "commit SHA");
  if (repoKind === "remote" && commitSha === null) {
    return invalidPersistedValue("remote source commit SHA");
  }
  return {
    repoKind,
    repoFull: persistedString(rowValue(row, ["repo_full"]), "repository", 4_096),
    commitSha,
  };
}

/**
 * Decode the persisted launch-policy options. They originate upstream, so they
 * stay bounded in both count and length on the way back out of storage.
 */
function persistedLaunchPolicyChoices(value: unknown): ReadonlyArray<string> {
  if (value === null || value === undefined) return [];
  if (typeof value !== "string") return invalidPersistedValue("launch policy choices");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return invalidPersistedValue("launch policy choices");
  }
  if (!Array.isArray(parsed) || parsed.length > 8)
    return invalidPersistedValue("launch policy choices");
  return parsed.map((choice) => persistedString(choice, "launch policy choice", 100));
}

function toCorrelation(row: Record<string, unknown>): OpenKrittScanCorrelation {
  return {
    requestId: persistedString(rowValue(row, ["request_id"]), "request id", 120),
    runId: persistedString(rowValue(row, ["run_id"]), "run id", 160),
    environmentId: persistedString(rowValue(row, ["environment_id"]), "environment id", 256),
    projectId: persistedString(rowValue(row, ["project_id"]), "project id", 256),
    externalScanId: persistedNullableId(rowValue(row, ["external_scan_id"]), "external scan id"),
    launchResolution: decodeOpenKrittLaunchResolution(rowValue(row, ["launch_resolution"])),
    launchPolicyChoices: persistedLaunchPolicyChoices(rowValue(row, ["launch_policy_choices"])),
    source: persistedSource(row),
    configurationSummary: persistedJsonRecord(
      rowValue(row, ["configuration_json"]),
      "configuration summary",
    ),
    upstreamStatus:
      rowValue(row, ["upstream_status"]) === null
        ? null
        : decodeOpenKrittScanStatus(rowValue(row, ["upstream_status"])),
    upstreamPhase: persistedNullableString(
      rowValue(row, ["upstream_phase"]),
      "upstream phase",
      500,
    ),
    progress: persistedNullableInteger(rowValue(row, ["progress"]), "progress", 0, 100),
    findingCount: persistedNullableInteger(rowValue(row, ["finding_count"]), "finding count"),
    duplicateCount: persistedNullableInteger(rowValue(row, ["duplicate_count"]), "duplicate count"),
  };
}

function persistedFinding(row: Record<string, unknown>): OpenKrittPersistedFinding {
  return {
    id: persistedId(rowValue(row, ["id", "finding_id"]), "finding id"),
    scanId: persistedId(rowValue(row, ["scanId", "scan_id"]), "finding scan id"),
    canonical: persistedBoolean(rowValue(row, ["canonical"]), "canonical flag"),
    duplicateOf: persistedNullableId(
      rowValue(row, ["duplicateOf", "duplicate_of"]),
      "duplicate finding id",
    ),
    severity: decodeOpenKrittFindingSeverity(rowValue(row, ["severity"])),
    rank: persistedNullableInteger(rowValue(row, ["rank"]), "finding rank", 0),
    type: persistedString(rowValue(row, ["type"]), "finding type", 500),
    summary: persistedString(rowValue(row, ["summary"]), "finding summary"),
    explanation: persistedString(rowValue(row, ["explanation"]), "finding explanation"),
    path: persistedString(rowValue(row, ["path"]), "finding path", 4_096),
    line: persistedNullableInteger(rowValue(row, ["line"]), "finding line", 1),
    column: persistedNullableInteger(
      rowValue(row, ["column", "columnNumber", "column_number"]),
      "finding column",
      1,
    ),
    triggerFlow: persistedJsonStrings(
      rowValue(row, ["triggerFlowJson", "trigger_flow_json"]),
      "trigger flow",
      200,
    ),
    maliciousInput: persistedNullableString(
      rowValue(row, ["maliciousInput", "malicious_input"]),
      "malicious input",
    ),
    exploitability: decodeOpenKrittExploitability(rowValue(row, ["exploitability"])),
    maliciousActor: persistedNullableString(
      rowValue(row, ["maliciousActor", "malicious_actor"]),
      "malicious actor",
      500,
    ),
    rootBug: persistedNullableString(rowValue(row, ["rootBug", "root_bug"]), "root bug", 500),
    triage: decodeOpenKrittTriage(rowValue(row, ["triage"])),
    sourceCommitSha: persistedCommitSha(
      rowValue(row, ["sourceCommitSha", "source_commit_sha"]),
      "source commit SHA",
    ),
    snapshotId: persistedNullableId(rowValue(row, ["snapshotId", "snapshot_id"]), "snapshot id"),
    cwe: persistedNullableString(rowValue(row, ["cwe"]), "CWE", 100),
    cvss: persistedNullableNumber(rowValue(row, ["cvss"]), "CVSS"),
  };
}

/**
 * Sort key for a finding the ranking pass has not ordered yet. Ranks are bounded
 * to 1,000,000, so this keeps unranked findings deterministically last without
 * fabricating a rank in the stored row.
 */
const UNRANKED_SORT_KEY = 1_000_001;

function parseFindingCursor(
  cursor: string | null | undefined,
): { readonly rank: number; readonly id: string } | null {
  if (cursor === null || cursor === undefined) return null;
  const match = /^rank:(\d{1,7}):([A-Za-z0-9_.:-]{1,256})$/.exec(cursor);
  if (match === null) return null;
  const rank = match[1];
  const id = match[2];
  if (rank === undefined || id === undefined) return null;
  return { rank: Number(rank), id };
}

function toSnapshot(row: Record<string, unknown>): OpenKrittSnapshotRecord {
  const manifestDigest = persistedString(rowValue(row, ["manifest_digest"]), "manifest digest", 64);
  if (!/^[0-9a-f]{64}$/.test(manifestDigest)) return invalidPersistedValue("manifest digest");
  const folderName = persistedString(rowValue(row, ["folder_name"]), "snapshot folder", 160);
  if (!/^[A-Za-z0-9_-]+$/.test(folderName)) return invalidPersistedValue("snapshot folder");
  return {
    snapshotId: persistedId(rowValue(row, ["snapshot_id"]), "snapshot id"),
    runId: persistedNullableString(rowValue(row, ["run_id"]), "snapshot run id", 160),
    projectId: persistedString(rowValue(row, ["project_id"]), "snapshot project id", 256),
    folderName,
    manifestDigest,
    fileCount: persistedInteger(rowValue(row, ["file_count"]), "snapshot file count", 0, 50_000),
    byteCount: persistedInteger(
      rowValue(row, ["byte_count"]),
      "snapshot byte count",
      0,
      536_870_912,
    ),
    exclusions: persistedJsonStrings(
      rowValue(row, ["exclusions_json"]),
      "snapshot exclusions",
      50_000,
    ),
    sourceCommitSha: persistedCommitSha(
      rowValue(row, ["source_commit_sha"]),
      "snapshot source commit SHA",
    ),
    dirty: persistedBoolean(rowValue(row, ["dirty"]), "snapshot dirty flag"),
    retainSnapshot: persistedBoolean(rowValue(row, ["retain_snapshot"]), "snapshot retention flag"),
    createdAt: persistedString(rowValue(row, ["created_at"]), "snapshot created timestamp", 100),
    terminalAt: persistedNullableString(
      rowValue(row, ["terminal_at"]),
      "snapshot terminal timestamp",
      100,
    ),
  };
}

function toDiagnostics(row: Record<string, unknown>): OpenKrittDiagnostics {
  return decodeOpenKrittDiagnostics({
    health: rowValue(row, ["health"]),
    lastSuccessfulContact: rowValue(row, ["lastSuccessfulContact"]),
    nextRetryAt: rowValue(row, ["nextRetryAt"]),
    compatibilityVersion: rowValue(row, ["compatibilityVersion"]),
    serverVersion: rowValue(row, ["serverVersion"]),
    lastError: null,
    recentEvents: persistedJson(rowValue(row, ["recentEventsJson"]), "diagnostic events"),
  });
}

function decodePersisted<A>(decode: () => A): Effect.Effect<A, OpenKrittPersistenceError> {
  return Effect.try({
    try: decode,
    catch: (cause) =>
      isOpenKrittPersistenceError(cause)
        ? cause
        : new OpenKrittPersistenceError({ detail: "Malformed persisted Open Kritt data.", cause }),
  });
}

const makeRepository = (): OpenKrittScanRepositoryShape => {
  const withSql = <A, E>(f: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
    Effect.flatMap(Effect.service(SqlClient.SqlClient), f).pipe(
      Effect.mapError((cause) =>
        isOpenKrittPersistenceError(cause)
          ? cause
          : new OpenKrittPersistenceError({ detail: "Open Kritt persistence failed.", cause }),
      ),
    );

  const insertLaunchIntent: OpenKrittScanRepositoryShape["insertLaunchIntent"] = (input) =>
    withSql((sql) =>
      Effect.gen(function* () {
        const existing = yield* sql<{
          readonly run_id: string;
        }>`SELECT run_id FROM open_kritt_scan_correlations WHERE request_id = ${input.requestId} LIMIT 1`;
        if (existing[0] !== undefined) return { created: false, runId: existing[0].run_id };
        const timestamp = now();
        yield* sql`
          INSERT INTO open_kritt_scan_correlations
            (request_id, run_id, environment_id, project_id, external_scan_id, launch_resolution, repo_kind, repo_full, commit_sha, configuration_json, created_at, updated_at)
          VALUES (${input.requestId}, ${input.runId}, ${input.environmentId}, ${input.projectId}, NULL, ${input.launchResolution}, ${input.source.repoKind}, ${input.source.repoFull}, ${input.source.commitSha}, ${JSON.stringify(input.configurationSummary)}, ${timestamp}, ${timestamp})
        `;
        return { created: true, runId: input.runId };
      }),
    );

  const findByRequestId: OpenKrittScanRepositoryShape["findByRequestId"] = (requestId) =>
    withSql((sql) =>
      Effect.gen(function* () {
        const rows = yield* sql<
          Record<string, unknown>
        >`SELECT * FROM open_kritt_scan_correlations WHERE request_id = ${requestId} LIMIT 1`;
        const row = rows[0];
        return row === undefined ? null : yield* decodePersisted(() => toCorrelation(row));
      }),
    );

  const findByRunId: OpenKrittScanRepositoryShape["findByRunId"] = (runId) =>
    withSql((sql) =>
      Effect.gen(function* () {
        const rows = yield* sql<
          Record<string, unknown>
        >`SELECT * FROM open_kritt_scan_correlations WHERE run_id = ${runId} LIMIT 1`;
        const row = rows[0];
        return row === undefined ? null : yield* decodePersisted(() => toCorrelation(row));
      }),
    );

  const listPollableRuns: OpenKrittScanRepositoryShape["listPollableRuns"] = (input) =>
    withSql((sql) =>
      Effect.gen(function* () {
        const rows = yield* sql<{
          readonly run_id: string;
          readonly external_scan_id: string | null;
          readonly output_summary: string | null;
        }>`
          SELECT runs.run_id, correlation.external_scan_id,
            json_extract(runs.run_json, '$.outputSummary') AS output_summary
          FROM integration_runs AS runs
          LEFT JOIN open_kritt_scan_correlations AS correlation
            ON correlation.run_id = runs.run_id
            AND correlation.environment_id = ${input.environmentId}
          WHERE runs.source = 'open-kritt'
            AND runs.state IN ('queued', 'running', 'waiting')
            AND (
              correlation.external_scan_id IS NOT NULL
              OR (
                correlation.run_id IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM open_kritt_scan_correlations AS any_correlation
                  WHERE any_correlation.run_id = runs.run_id
                )
                AND json_extract(runs.run_json, '$.outputSummary') LIKE 'external-scan:%'
              )
            )
          ORDER BY runs.created_at ASC, runs.run_id ASC
          LIMIT ${Math.max(1, Math.min(100, input.limit))}
        `;
        return rows.flatMap((row) => {
          const legacy =
            row.output_summary === null
              ? null
              : (/^external-scan:([A-Za-z0-9_.:-]{1,256})(?:\n|$)/.exec(row.output_summary)?.[1] ??
                null);
          const externalScanId = row.external_scan_id ?? legacy;
          return externalScanId === null ? [] : [{ runId: row.run_id, externalScanId }];
        });
      }),
    );

  const saveCorrelation: OpenKrittScanRepositoryShape["saveCorrelation"] = (input) =>
    withSql((sql) =>
      Effect.gen(function* () {
        const timestamp = now();
        const choices = JSON.stringify(
          (input.launchPolicyChoices ?? []).slice(0, 8).map((choice) => choice.slice(0, 100)),
        );
        yield* sql`UPDATE open_kritt_scan_correlations SET external_scan_id = ${input.externalScanId}, launch_resolution = ${input.launchResolution}, launch_policy_choices = ${choices}, configuration_json = COALESCE(${input.configurationSummary === undefined ? null : JSON.stringify(input.configurationSummary)}, configuration_json), updated_at = ${timestamp} WHERE request_id = ${input.requestId}`;
        const existing = yield* sql<{
          readonly request_id: string;
        }>`SELECT request_id FROM open_kritt_scan_correlations WHERE request_id = ${input.requestId} LIMIT 1`;
        if (existing.length === 0)
          return yield* new OpenKrittPersistenceError({
            detail: "Open Kritt launch correlation does not exist.",
          });
      }),
    );

  const saveUpstreamSnapshot: OpenKrittScanRepositoryShape["saveUpstreamSnapshot"] = (
    scanId,
    input,
    environmentId,
  ) =>
    withSql((sql) =>
      sql`
      UPDATE open_kritt_scan_correlations SET upstream_status = ${input.status}, upstream_phase = ${input.phase}, progress = ${input.progress}, finding_count = ${input.findingCount}, duplicate_count = ${input.duplicateCount}, updated_at = ${input.updatedAt}
      WHERE external_scan_id = ${scanId}
        AND (${environmentId ?? null} IS NULL OR environment_id = ${environmentId ?? null})
    `.pipe(Effect.asVoid),
    );

  const saveSnapshot: OpenKrittScanRepositoryShape["saveSnapshot"] = (input) =>
    withSql((sql) =>
      sql`
        INSERT INTO open_kritt_scan_snapshots
          (snapshot_id, run_id, project_id, folder_name, manifest_digest, file_count, byte_count, exclusions_json, source_commit_sha, dirty, retain_snapshot, created_at, terminal_at)
        VALUES (${input.snapshotId}, NULL, ${input.projectId}, ${input.folderName}, ${input.manifestDigest}, ${input.fileCount}, ${input.byteCount}, ${JSON.stringify(input.exclusions)}, ${input.sourceCommitSha}, ${input.dirty ? 1 : 0}, ${input.retainSnapshot ? 1 : 0}, ${now()}, NULL)
        ON CONFLICT (snapshot_id) DO UPDATE SET
          project_id = excluded.project_id,
          folder_name = excluded.folder_name,
          manifest_digest = excluded.manifest_digest,
          file_count = excluded.file_count,
          byte_count = excluded.byte_count,
          exclusions_json = excluded.exclusions_json,
          source_commit_sha = excluded.source_commit_sha,
          dirty = excluded.dirty,
          retain_snapshot = excluded.retain_snapshot
      `.pipe(Effect.asVoid),
    );

  const findSnapshot: OpenKrittScanRepositoryShape["findSnapshot"] = (snapshotId) =>
    withSql((sql) =>
      Effect.gen(function* () {
        const rows = yield* sql<Record<string, unknown>>`
          SELECT snapshot_id, run_id, project_id, folder_name, manifest_digest, file_count,
            byte_count, exclusions_json, source_commit_sha, dirty, retain_snapshot, created_at,
            terminal_at
          FROM open_kritt_scan_snapshots
          WHERE snapshot_id = ${snapshotId}
          LIMIT 1
        `;
        const row = rows[0];
        return row === undefined ? null : yield* decodePersisted(() => toSnapshot(row));
      }),
    );

  const attachSnapshotToRun: OpenKrittScanRepositoryShape["attachSnapshotToRun"] = (
    snapshotId,
    runId,
  ) =>
    withSql((sql) =>
      Effect.gen(function* () {
        const rows = yield* sql<{ readonly snapshot_id: string }>`
          UPDATE open_kritt_scan_snapshots
          SET run_id = ${runId}
          WHERE snapshot_id = ${snapshotId}
            AND (run_id IS NULL OR run_id = ${runId})
            AND terminal_at IS NULL
          RETURNING snapshot_id
        `;
        if (rows.length === 0)
          return yield* new OpenKrittPersistenceError({
            detail: "Open Kritt snapshot is unavailable or attached to another run.",
          });
      }),
    );

  const releaseSnapshotFromRun: OpenKrittScanRepositoryShape["releaseSnapshotFromRun"] = (
    snapshotId,
    runId,
  ) =>
    withSql((sql) =>
      sql`
        UPDATE open_kritt_scan_snapshots
        SET run_id = NULL
        WHERE snapshot_id = ${snapshotId}
          AND run_id = ${runId}
          AND terminal_at IS NULL
      `.pipe(Effect.asVoid),
    );

  const findSnapshotForRun: OpenKrittScanRepositoryShape["findSnapshotForRun"] = (runId) =>
    withSql((sql) =>
      Effect.gen(function* () {
        const rows = yield* sql<Record<string, unknown>>`
          SELECT snapshot_id, run_id, project_id, folder_name, manifest_digest, file_count,
            byte_count, exclusions_json, source_commit_sha, dirty, retain_snapshot, created_at,
            terminal_at
          FROM open_kritt_scan_snapshots
          WHERE run_id = ${runId}
          ORDER BY created_at DESC
          LIMIT 1
        `;
        const row = rows[0];
        return row === undefined ? null : yield* decodePersisted(() => toSnapshot(row));
      }),
    );

  const listSnapshotsPendingCleanup: OpenKrittScanRepositoryShape["listSnapshotsPendingCleanup"] = (
    createdBefore,
  ) =>
    withSql((sql) =>
      Effect.gen(function* () {
        const rows = yield* sql<Record<string, unknown>>`
          SELECT snapshot_id, run_id, project_id, folder_name, manifest_digest, file_count,
            byte_count, exclusions_json, source_commit_sha, dirty, retain_snapshot, created_at,
            terminal_at
          FROM open_kritt_scan_snapshots
          WHERE terminal_at IS NULL AND created_at <= ${createdBefore}
          ORDER BY created_at ASC
          LIMIT 100
        `;
        return yield* decodePersisted(() => rows.map(toSnapshot));
      }),
    );

  const listSnapshotFolderNames: OpenKrittScanRepositoryShape["listSnapshotFolderNames"] = () =>
    withSql((sql) =>
      Effect.gen(function* () {
        const rows = yield* sql<{ readonly folder_name: string }>`
          SELECT folder_name FROM open_kritt_scan_snapshots
        `;
        return rows.map((row) => row.folder_name);
      }),
    );

  const markSnapshotTerminal: OpenKrittScanRepositoryShape["markSnapshotTerminal"] = (
    snapshotId,
    terminalAt,
  ) =>
    withSql((sql) =>
      sql`
        UPDATE open_kritt_scan_snapshots
        SET terminal_at = COALESCE(terminal_at, ${terminalAt})
        WHERE snapshot_id = ${snapshotId}
      `.pipe(Effect.asVoid),
    );

  const upsertNormalizedFinding: OpenKrittScanRepositoryShape["upsertNormalizedFinding"] = (
    input,
  ) =>
    withSql((sql) =>
      sql`
        INSERT INTO open_kritt_findings
          (finding_id, scan_id, canonical, duplicate_of, severity, rank, type, summary, explanation, path, line, column_number, trigger_flow_json, malicious_input, exploitability, malicious_actor, root_bug, triage, source_commit_sha, snapshot_id, cwe, cvss, normalized_fingerprint, created_at, updated_at)
        VALUES (${input.id}, ${input.scanId}, ${input.canonical ? 1 : 0}, ${input.duplicateOf ?? null}, ${input.severity}, ${input.rank}, ${input.type}, ${input.summary}, ${input.explanation}, ${input.path}, ${input.line ?? null}, ${input.column ?? null}, ${JSON.stringify(input.triggerFlow)}, ${input.maliciousInput ?? null}, ${input.exploitability}, ${input.maliciousActor ?? null}, ${input.rootBug ?? null}, ${input.triage}, ${input.sourceCommitSha ?? null}, ${input.snapshotId ?? null}, ${input.cwe ?? null}, ${input.cvss ?? null}, ${fingerprintFinding({ type: input.type, path: input.path, line: input.line, column: input.column ?? null, rootBug: input.rootBug ?? null, duplicateOf: input.duplicateOf ?? null })}, ${now()}, ${now()})
        ON CONFLICT (finding_id) DO UPDATE SET canonical = excluded.canonical, duplicate_of = excluded.duplicate_of, severity = excluded.severity, rank = excluded.rank, type = excluded.type, summary = excluded.summary, explanation = excluded.explanation, path = excluded.path, line = excluded.line, column_number = excluded.column_number, trigger_flow_json = excluded.trigger_flow_json, malicious_input = excluded.malicious_input, exploitability = excluded.exploitability, malicious_actor = excluded.malicious_actor, root_bug = excluded.root_bug, triage = excluded.triage, source_commit_sha = excluded.source_commit_sha, snapshot_id = excluded.snapshot_id, cwe = excluded.cwe, cvss = excluded.cvss, normalized_fingerprint = excluded.normalized_fingerprint, updated_at = excluded.updated_at
      `.pipe(Effect.asVoid),
    );

  const findByExternalScanId: OpenKrittScanRepositoryShape["findByExternalScanId"] = (
    externalScanId,
    environmentId,
  ) =>
    withSql((sql) =>
      Effect.gen(function* () {
        const rows = yield* sql<Record<string, unknown>>`SELECT * FROM open_kritt_scan_correlations
          WHERE external_scan_id = ${externalScanId}
            AND (${environmentId ?? null} IS NULL OR environment_id = ${environmentId ?? null})
          LIMIT 1`;
        const row = rows[0];
        return row === undefined ? null : yield* decodePersisted(() => toCorrelation(row));
      }),
    );

  const getFinding: OpenKrittScanRepositoryShape["getFinding"] = (findingId, environmentId) =>
    withSql((sql) =>
      Effect.gen(function* () {
        const rows = yield* sql<
          Record<string, unknown>
        >`SELECT findings.finding_id AS id, findings.scan_id AS scanId, findings.canonical,
            findings.duplicate_of AS duplicateOf, findings.severity, findings.rank, findings.type,
            findings.summary, findings.explanation, findings.path, findings.line,
            findings.column_number AS columnNumber, findings.trigger_flow_json AS triggerFlowJson,
            findings.malicious_input AS maliciousInput, findings.exploitability,
            findings.malicious_actor AS maliciousActor, findings.root_bug AS rootBug, findings.triage,
            findings.source_commit_sha AS sourceCommitSha, findings.snapshot_id AS snapshotId,
            findings.cwe, findings.cvss, findings.normalized_fingerprint AS normalizedFingerprint
          FROM open_kritt_findings AS findings
          INNER JOIN open_kritt_scan_correlations AS correlations
            ON correlations.external_scan_id = findings.scan_id
            AND (${environmentId ?? null} IS NULL OR correlations.environment_id = ${environmentId ?? null})
          WHERE findings.finding_id = ${findingId}
          LIMIT 1`;
        const row = rows[0];
        if (row === undefined) return null;
        return yield* decodePersisted(() => persistedFinding(row));
      }),
    );

  const listUnresolvedLaunches: OpenKrittScanRepositoryShape["listUnresolvedLaunches"] = (
    environmentId,
  ) =>
    withSql((sql) =>
      Effect.gen(function* () {
        const rows = yield* sql<Record<string, unknown>>`SELECT * FROM open_kritt_scan_correlations
          WHERE launch_resolution = 'unknown'
            AND (${environmentId ?? null} IS NULL OR environment_id = ${environmentId ?? null})
          ORDER BY updated_at ASC, created_at ASC, request_id ASC
          LIMIT 100`;
        return yield* decodePersisted(() => rows.map(toCorrelation));
      }),
    );

  const touchLaunchReconciliation: OpenKrittScanRepositoryShape["touchLaunchReconciliation"] = (
    requestId,
  ) =>
    withSql((sql) =>
      sql`
        UPDATE open_kritt_scan_correlations
        SET updated_at = ${now()}
        WHERE request_id = ${requestId}
          AND launch_resolution = 'unknown'
      `.pipe(Effect.asVoid),
    );

  const listFindings: OpenKrittScanRepositoryShape["listFindings"] = (input) =>
    withSql((sql) =>
      Effect.gen(function* () {
        const cursor = parseFindingCursor(input.cursor);
        if (input.cursor !== null && input.cursor !== undefined && cursor === null) {
          return yield* new OpenKrittPersistenceError({
            detail: "Invalid Open Kritt finding cursor.",
          });
        }
        const rows = yield* sql<Record<string, unknown>>`
          SELECT finding_id AS id, scan_id AS scanId, canonical, duplicate_of AS duplicateOf,
            severity, rank, type, summary, explanation, path, line,
            column_number AS columnNumber, trigger_flow_json AS triggerFlowJson,
            malicious_input AS maliciousInput, exploitability,
            malicious_actor AS maliciousActor, root_bug AS rootBug, triage,
            source_commit_sha AS sourceCommitSha, snapshot_id AS snapshotId, cwe, cvss,
            normalized_fingerprint AS normalizedFingerprint
          FROM open_kritt_findings AS findings
          INNER JOIN open_kritt_scan_correlations AS correlations
            ON correlations.external_scan_id = findings.scan_id
            AND (${input.environmentId ?? null} IS NULL OR correlations.environment_id = ${input.environmentId ?? null})
          WHERE findings.scan_id = ${input.scanId}
            AND (${input.includeDuplicates ? 1 : 0} = 1 OR findings.canonical = 1)
            AND (${input.cursor ?? null} IS NULL OR COALESCE(findings.rank, ${UNRANKED_SORT_KEY}) > ${cursor?.rank ?? null} OR (COALESCE(findings.rank, ${UNRANKED_SORT_KEY}) = ${cursor?.rank ?? null} AND findings.finding_id > ${cursor?.id ?? null}))
          ORDER BY COALESCE(findings.rank, ${UNRANKED_SORT_KEY}) ASC, findings.finding_id ASC
          LIMIT ${Math.max(1, Math.min(200, Math.floor(input.limit) + 1))}
        `;
        const hasMore = rows.length > input.limit;
        const items = yield* decodePersisted(() =>
          rows.slice(0, input.limit).map(persistedFinding),
        );
        const last = items.at(-1);
        return {
          items,
          nextCursor:
            hasMore && last !== undefined
              ? `rank:${last.rank ?? UNRANKED_SORT_KEY}:${last.id}`
              : null,
        };
      }),
    );

  const getDiagnostics: OpenKrittScanRepositoryShape["getDiagnostics"] = () =>
    withSql((sql) =>
      Effect.gen(function* () {
        const rows = yield* sql<Record<string, unknown>>`
          SELECT health, last_successful_contact AS lastSuccessfulContact,
            next_retry_at AS nextRetryAt, compatibility_version AS compatibilityVersion,
            server_version AS serverVersion, recent_events_json AS recentEventsJson
          FROM open_kritt_diagnostics
          ORDER BY diagnostic_id DESC LIMIT 1
        `;
        const row = rows[0];
        if (row === undefined) return null;
        return yield* decodePersisted(() => toDiagnostics(row));
      }),
    );

  const saveDiagnostics: OpenKrittScanRepositoryShape["saveDiagnostics"] = (diagnostics) =>
    withSql((sql) =>
      sql`
      INSERT INTO open_kritt_diagnostics
        (health, last_successful_contact, next_retry_at, compatibility_version, server_version, recent_events_json, updated_at)
      VALUES (${diagnostics.health}, ${diagnostics.lastSuccessfulContact}, ${diagnostics.nextRetryAt}, ${diagnostics.compatibilityVersion}, ${diagnostics.serverVersion}, ${JSON.stringify(diagnostics.recentEvents)}, ${now()})
    `.pipe(Effect.asVoid),
    );

  return {
    insertLaunchIntent,
    findByRequestId,
    findByRunId,
    listPollableRuns,
    saveCorrelation,
    saveUpstreamSnapshot,
    saveSnapshot,
    findSnapshot,
    attachSnapshotToRun,
    releaseSnapshotFromRun,
    findSnapshotForRun,
    listSnapshotsPendingCleanup,
    listSnapshotFolderNames,
    markSnapshotTerminal,
    upsertNormalizedFinding,
    findByExternalScanId,
    getFinding,
    listFindings,
    listUnresolvedLaunches,
    touchLaunchReconciliation,
    getDiagnostics,
    saveDiagnostics,
  };
};

export const OpenKrittScanRepository = Context.Reference<OpenKrittScanRepositoryShape>(
  "notcodex/integrations/Services/OpenKrittScanRepository",
  { defaultValue: makeRepository },
);

export const OpenKrittScanRepositoryLive = Layer.succeed(OpenKrittScanRepository, makeRepository());
