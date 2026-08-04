import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  NonNegativeInt,
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";
import { ModelSelection, RuntimeMode } from "./orchestration.ts";

export const IntegrationId = Schema.Literals(["monkey-d-loopy", "loopany", "open-kritt"]);
export type IntegrationId = typeof IntegrationId.Type;

export const IntegrationState = Schema.Literals([
  "disabled",
  "disconnected",
  "connecting",
  "ready",
  "error",
]);
export type IntegrationState = typeof IntegrationState.Type;

export const IntegrationCapability = Schema.Literals([
  "author",
  "recipes",
  "infer",
  "validate",
  "verify",
  "run",
  "resume",
  "retry",
  "inspect",
  "cancel",
  "mcp",
  "schedule",
  "deliver",
  "report",
  "scan",
  "findings",
  "triage",
  "rescan",
]);
export type IntegrationCapability = typeof IntegrationCapability.Type;

export const LoopAnyHealthState = Schema.Literals([
  "disabled",
  "misconfigured",
  "connecting",
  "healthy",
  "backing-off",
  "unauthorized",
  "protocol-error",
]);
export type LoopAnyHealthState = typeof LoopAnyHealthState.Type;

export const LoopAnyDiagnosticCode = Schema.Literals([
  "connector-disabled",
  "connector-misconfigured",
  "poll-succeeded",
  "poll-failed",
  "unauthorized",
  "protocol-error",
  "delivery-accepted",
  "delivery-duplicate",
  "delivery-running",
  "workflow-fallback",
  "root-rejected",
  "execution-failed",
  "report-failed",
  "delivery-succeeded",
]);
export type LoopAnyDiagnosticCode = typeof LoopAnyDiagnosticCode.Type;

export const LoopAnyDiagnosticEvent = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  severity: Schema.Literals(["info", "warning", "error"]),
  code: LoopAnyDiagnosticCode,
  summary: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  runId: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(160))),
  occurredAt: IsoDateTime,
});
export type LoopAnyDiagnosticEvent = typeof LoopAnyDiagnosticEvent.Type;

export const LoopAnyConnectorError = Schema.Struct({
  code: LoopAnyDiagnosticCode,
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  occurredAt: IsoDateTime,
});
export type LoopAnyConnectorError = typeof LoopAnyConnectorError.Type;

export const LoopAnyConnectorDiagnostics = Schema.Struct({
  health: LoopAnyHealthState,
  protocolVersion: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  serverVersion: Schema.NullOr(Schema.String.check(Schema.isMaxLength(100))),
  lastPollAt: Schema.NullOr(IsoDateTime),
  lastSuccessAt: Schema.NullOr(IsoDateTime),
  nextRetryAt: Schema.NullOr(IsoDateTime),
  consecutiveFailures: NonNegativeInt,
  inFlight: NonNegativeInt,
  lastError: Schema.NullOr(LoopAnyConnectorError),
  recentEvents: Schema.Array(LoopAnyDiagnosticEvent).check(Schema.isMaxLength(50)),
  updatedAt: IsoDateTime,
});
export type LoopAnyConnectorDiagnostics = typeof LoopAnyConnectorDiagnostics.Type;

const LoopAnyServerUrl = TrimmedString.check(Schema.isMaxLength(4_096));
const LoopAnyRoot = TrimmedNonEmptyString.check(Schema.isMaxLength(4_096));
const LoopAnyRoots = Schema.Array(LoopAnyRoot).check(Schema.isMaxLength(64));
const LoopAnyToken = TrimmedString.check(Schema.isMaxLength(4_096));

export const LoopAnySettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  serverUrl: LoopAnyServerUrl.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  allowedRoots: LoopAnyRoots.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  pollWaitSeconds: Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 60 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(25)),
  ),
});
export type LoopAnySettings = typeof LoopAnySettings.Type;

export const LoopAnySettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  serverUrl: Schema.optionalKey(LoopAnyServerUrl),
  allowedRoots: Schema.optionalKey(LoopAnyRoots),
  pollWaitSeconds: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 60 })),
  ),
});
export type LoopAnySettingsPatch = typeof LoopAnySettingsPatch.Type;

// Open Kritt is an independently installed service.  These schemas deliberately
// contain no bearer token; the token crosses the server boundary only through
// the dedicated ServerSecretStore operation.
const OpenKrittOpaqueId = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(256)),
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_.:-]+$/)),
);
const OpenKrittDescription = Schema.String.check(Schema.isMaxLength(16_000));
const OpenKrittCommitSha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
const OpenKrittRepoFull = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
);
const OpenKrittFilePath = TrimmedString.check(Schema.isMaxLength(4_096));
const OpenKrittSnapshotRoot = TrimmedNonEmptyString.check(
  Schema.isMaxLength(4_096),
  Schema.isPattern(/^(?:\/|[A-Za-z]:[\\/])/),
);
const OpenKrittBoundedIds = Schema.Array(OpenKrittOpaqueId).check(Schema.isMaxLength(64));

/**
 * Operator allowlist of private addresses (or CIDRs) the server may connect to.
 * Open Kritt's own documentation recommends a dedicated private host, which is
 * unreachable while every RFC1918/ULA address is refused. Entries are literal
 * addresses only — never hostnames, because the check runs after DNS — and the
 * server still refuses link-local/metadata, multicast and reserved ranges
 * regardless of what is listed here.
 */
const OpenKrittPrivateAddress = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9A-Fa-f.:]+(?:\/\d{1,3})?$/)),
);
const OpenKrittPrivateAddresses = Schema.Array(OpenKrittPrivateAddress).check(
  Schema.isMaxLength(8),
);

export const OpenKrittAuthMode = Schema.Literals(["none", "bearer"]);
export type OpenKrittAuthMode = typeof OpenKrittAuthMode.Type;

export const OpenKrittSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  serverUrl: TrimmedString.check(Schema.isMaxLength(4_096)).pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
  ),
  authMode: OpenKrittAuthMode.pipe(Schema.withDecodingDefault(Effect.succeed("none" as const))),
  snapshotRoot: Schema.NullOr(OpenKrittSnapshotRoot).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  allowedPrivateAddresses: OpenKrittPrivateAddresses.pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  pollIntervalSeconds: Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 300 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(15)),
  ),
  pollConcurrency: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(2)),
  ),
  defaultWorkflowId: Schema.NullOr(OpenKrittOpaqueId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  defaultPostScriptIds: OpenKrittBoundedIds.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  defaultAgentSkillIds: OpenKrittBoundedIds.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  defaultSeverityRankerId: Schema.NullOr(OpenKrittOpaqueId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  defaultProviderId: Schema.NullOr(OpenKrittOpaqueId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  defaultModelId: Schema.NullOr(OpenKrittOpaqueId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type OpenKrittSettings = typeof OpenKrittSettings.Type;

export const OpenKrittSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  serverUrl: Schema.optionalKey(TrimmedString.check(Schema.isMaxLength(4_096))),
  authMode: Schema.optionalKey(OpenKrittAuthMode),
  snapshotRoot: Schema.optionalKey(Schema.NullOr(OpenKrittSnapshotRoot)),
  allowedPrivateAddresses: Schema.optionalKey(OpenKrittPrivateAddresses),
  pollIntervalSeconds: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 300 })),
  ),
  pollConcurrency: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 })),
  ),
  defaultWorkflowId: Schema.optionalKey(Schema.NullOr(OpenKrittOpaqueId)),
  defaultPostScriptIds: Schema.optionalKey(OpenKrittBoundedIds),
  defaultAgentSkillIds: Schema.optionalKey(OpenKrittBoundedIds),
  defaultSeverityRankerId: Schema.optionalKey(Schema.NullOr(OpenKrittOpaqueId)),
  defaultProviderId: Schema.optionalKey(Schema.NullOr(OpenKrittOpaqueId)),
  defaultModelId: Schema.optionalKey(Schema.NullOr(OpenKrittOpaqueId)),
});
export type OpenKrittSettingsPatch = typeof OpenKrittSettingsPatch.Type;

export const OpenKrittConfigureInput = Schema.Struct({
  settings: OpenKrittSettingsPatch,
  token: Schema.optionalKey(TrimmedString.check(Schema.isMaxLength(4_096))),
  clearToken: Schema.optionalKey(Schema.Boolean),
  acknowledgeNonLoopbackWarning: Schema.optionalKey(Schema.Boolean),
});
export type OpenKrittConfigureInput = typeof OpenKrittConfigureInput.Type;

export const OpenKrittConfigureResult = Schema.Struct({
  settings: OpenKrittSettings,
  tokenConfigured: Schema.Boolean,
});
export type OpenKrittConfigureResult = typeof OpenKrittConfigureResult.Type;

export const OpenKrittCatalogItem = Schema.Struct({
  id: OpenKrittOpaqueId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  description: Schema.optionalKey(OpenKrittDescription),
  enabled: Schema.optionalKey(Schema.Boolean),
  /**
   * Prompt/ruleset body, present only where Open Kritt itself returns one.
   * Severity rankers are selected by *content* rather than by id at launch —
   * `POST /api/scans` takes `severity_ranker` as the combined Markdown ruleset —
   * so the body has to survive catalog discovery to reach the launch form.
   */
  content: Schema.optionalKey(OpenKrittDescription),
});
export type OpenKrittCatalogItem = typeof OpenKrittCatalogItem.Type;

export const OpenKrittModelProvider = Schema.Struct({
  id: OpenKrittOpaqueId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  models: Schema.Array(
    Schema.Struct({
      id: OpenKrittOpaqueId,
      name: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
    }),
  )
    .check(Schema.isMaxLength(100))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type OpenKrittModelProvider = typeof OpenKrittModelProvider.Type;

export const OpenKrittCatalog = Schema.Struct({
  workflows: Schema.Array(OpenKrittCatalogItem).check(Schema.isMaxLength(100)),
  postScripts: Schema.Array(OpenKrittCatalogItem).check(Schema.isMaxLength(100)),
  agentSkills: Schema.Array(OpenKrittCatalogItem).check(Schema.isMaxLength(100)),
  severityRankers: Schema.Array(OpenKrittCatalogItem).check(Schema.isMaxLength(100)),
  modelProviders: Schema.Array(OpenKrittModelProvider).check(Schema.isMaxLength(100)),
});
export type OpenKrittCatalog = typeof OpenKrittCatalog.Type;

export const OpenKrittHealthState = Schema.Literals([
  "disabled",
  "misconfigured",
  "connecting",
  "healthy",
  "stale",
  "backing-off",
  "unauthorized",
  "protocol-error",
]);
export type OpenKrittHealthState = typeof OpenKrittHealthState.Type;

export const OpenKrittDiagnosticEvent = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  severity: Schema.Literals(["info", "warning", "error"]),
  code: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  summary: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  occurredAt: IsoDateTime,
});
export type OpenKrittDiagnosticEvent = typeof OpenKrittDiagnosticEvent.Type;

export const OpenKrittDiagnostics = Schema.Struct({
  health: OpenKrittHealthState,
  lastSuccessfulContact: Schema.NullOr(IsoDateTime),
  nextRetryAt: Schema.NullOr(IsoDateTime),
  compatibilityVersion: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  serverVersion: Schema.NullOr(Schema.String.check(Schema.isMaxLength(100))),
  lastError: Schema.NullOr(LoopAnyConnectorError).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  recentEvents: Schema.Array(OpenKrittDiagnosticEvent).check(Schema.isMaxLength(50)),
});
export type OpenKrittDiagnostics = typeof OpenKrittDiagnostics.Type;

export const IntegrationDescriptor = Schema.Struct({
  id: IntegrationId,
  name: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  state: IntegrationState,
  capabilities: Schema.Array(IntegrationCapability),
  tokenConfigured: Schema.Boolean,
  lastActivityAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  error: Schema.NullOr(Schema.String),
  diagnostics: Schema.NullOr(
    Schema.Union([LoopAnyConnectorDiagnostics, OpenKrittDiagnostics]),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type IntegrationDescriptor = typeof IntegrationDescriptor.Type;

export const OpenKrittConnectionTestResult = Schema.Struct({
  ok: Schema.Boolean,
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  diagnostics: OpenKrittDiagnostics,
  catalog: Schema.NullOr(OpenKrittCatalog),
});
export type OpenKrittConnectionTestResult = typeof OpenKrittConnectionTestResult.Type;

export const OpenKrittRemoteSourceIdentity = Schema.Struct({
  kind: Schema.Literal("remote"),
  repoFull: OpenKrittRepoFull,
  commitSha: OpenKrittCommitSha,
  dirty: Schema.optionalKey(Schema.Boolean),
  unpushed: Schema.optionalKey(Schema.Boolean),
});
export const OpenKrittLocalSourceIdentity = Schema.Struct({
  kind: Schema.Literal("local"),
  snapshotId: OpenKrittOpaqueId,
  commitSha: Schema.NullOr(OpenKrittCommitSha),
});
export const OpenKrittSourceIdentity = Schema.Union([
  OpenKrittRemoteSourceIdentity,
  OpenKrittLocalSourceIdentity,
]);
export type OpenKrittSourceIdentity = typeof OpenKrittSourceIdentity.Type;

export const OpenKrittScanConfiguration = Schema.Struct({
  workflowId: OpenKrittOpaqueId,
  postScriptIds: OpenKrittBoundedIds,
  agentSkillIds: OpenKrittBoundedIds,
  /** Retained for display and rescan comparison only; never sent upstream. */
  severityRankerId: Schema.NullOr(OpenKrittOpaqueId),
  /**
   * The combined Markdown ranking ruleset. Open Kritt v1.2.0 stores the ranker
   * *body* on the scan (`severity_ranker`) and rejects a launch without it, so
   * the id alone is not a usable selection. When omitted the server resolves it
   * from `severityRankerId` against the installation's current catalog, which
   * keeps a 32 KB prompt off the client and out of durable run history.
   */
  severityRankerContent: Schema.optionalKey(
    TrimmedNonEmptyString.check(Schema.isMaxLength(32_000)),
  ),
  providerId: OpenKrittOpaqueId,
  modelId: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  /**
   * Upstream `HARNESSES`. Optional because the provider constrains the valid
   * set; when omitted the server sends the first harness the pinned
   * `MODEL_PROVIDER_HARNESSES` table lists as compatible with the provider.
   */
  harness: Schema.optionalKey(Schema.Literals(["codex", "claude-code", "cursor"])),
  thinkingEffort: Schema.Literals(["default", "low", "medium", "high", "xhigh", "max", "ultra"]),
  jobLimit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 })),
  scope: Schema.optionalKey(TrimmedString.check(Schema.isMaxLength(4_096))),
  /**
   * Values for the `{{extra.<key>}}` placeholders the selected workflow and
   * post-scripts declare. Upstream rejects a launch that omits a required key
   * with a bounded `422` field error, which the launch form surfaces.
   */
  extra: Schema.optionalKey(
    Schema.Record(
      TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
      Schema.String.check(Schema.isMaxLength(4_096)),
    ),
  ),
});
export type OpenKrittScanConfiguration = typeof OpenKrittScanConfiguration.Type;

/**
 * One documented Open Kritt launch-policy option, as returned by a
 * `409 scan_launch_policy_required` response. The user elects one explicitly;
 * Not Codex never picks concurrent paid work on their behalf.
 */
export const OpenKrittLaunchPolicyChoice = TrimmedNonEmptyString.check(Schema.isMaxLength(100));
export type OpenKrittLaunchPolicyChoice = typeof OpenKrittLaunchPolicyChoice.Type;

/** One bounded upstream `422` field error, kept structured so the form can attach it to a control. */
export const OpenKrittFieldError = Schema.Struct({
  field: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
});
export type OpenKrittFieldError = typeof OpenKrittFieldError.Type;

export const OpenKrittLaunchScanInput = Schema.Struct({
  projectId: ProjectId,
  requestId: TrimmedNonEmptyString.check(
    Schema.isMaxLength(120),
    Schema.isPattern(/^[A-Za-z0-9_-]+$/),
  ),
  source: OpenKrittSourceIdentity,
  configuration: OpenKrittScanConfiguration,
  parentRunId: Schema.optionalKey(TrimmedString.check(Schema.isMaxLength(160))),
  /**
   * The user's elected answer to a prior `policy-required` outcome. Resubmitting
   * with the same `requestId` is what keeps the elected retry from creating a
   * second paid scan.
   */
  launchPolicy: Schema.optionalKey(OpenKrittLaunchPolicyChoice),
});
export type OpenKrittLaunchScanInput = typeof OpenKrittLaunchScanInput.Type;

export const OpenKrittScanLaunchResult = Schema.Struct({
  run: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  externalScanId: Schema.NullOr(OpenKrittOpaqueId),
  launchResolution: Schema.Literals([
    "unknown",
    "accepted",
    "reconciled",
    "policy-required",
    "rejected",
  ]),
  /** Non-empty only when `launchResolution` is `policy-required`. */
  policyChoices: Schema.Array(OpenKrittLaunchPolicyChoice).check(Schema.isMaxLength(8)),
  /** Non-empty only when `launchResolution` is `rejected`. */
  fieldErrors: Schema.Array(OpenKrittFieldError).check(Schema.isMaxLength(50)),
});
export type OpenKrittScanLaunchResult = typeof OpenKrittScanLaunchResult.Type;

export const OpenKrittScanControlInput = Schema.Struct({
  scanId: OpenKrittOpaqueId,
  action: Schema.Literals(["pause", "stop", "resume"]),
});
export type OpenKrittScanControlInput = typeof OpenKrittScanControlInput.Type;

export const OpenKrittScanControlResult = Schema.Struct({
  scanId: OpenKrittOpaqueId,
  action: Schema.Literals(["pause", "stop", "resume"]),
  upstreamStatus: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
});
export type OpenKrittScanControlResult = typeof OpenKrittScanControlResult.Type;

export const OpenKrittFindingsListInput = Schema.Struct({
  scanId: OpenKrittOpaqueId,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(100)),
  ),
  cursor: Schema.NullOr(TrimmedString.check(Schema.isMaxLength(500))).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  includeDuplicates: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type OpenKrittFindingsListInput = typeof OpenKrittFindingsListInput.Type;

/**
 * Severity is post-script output upstream, not a fixed enum: a ranker may emit
 * any string or none at all. Recognized names are normalized; anything else
 * becomes `unknown` rather than being silently promoted or dropped.
 */
const OpenKrittFindingSeverity = Schema.Literals([
  "critical",
  "high",
  "medium",
  "low",
  "info",
  "unknown",
]);
/** Derived from the boolean `exploitable` answer field; absent maps to `unknown`. */
const OpenKrittExploitability = Schema.Literals(["likely", "possible", "unlikely", "unknown"]);
const OpenKrittTriage = Schema.Literals(["interesting", "uninteresting", "untriaged"]);

export const OpenKrittFindingLocation = Schema.Struct({
  path: OpenKrittFilePath,
  line: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000_000 }))),
  column: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000_000 }))),
});
export type OpenKrittFindingLocation = typeof OpenKrittFindingLocation.Type;

export const OpenKrittFinding = Schema.Struct({
  id: OpenKrittOpaqueId,
  scanId: OpenKrittOpaqueId,
  severity: OpenKrittFindingSeverity,
  /** Null until the scan's ranking pass has ordered the finding. */
  rank: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 }))),
  type: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  summary: OpenKrittDescription,
  explanation: OpenKrittDescription,
  location: OpenKrittFindingLocation,
  triggerFlow: Schema.Array(OpenKrittDescription).check(Schema.isMaxLength(200)),
  maliciousInput: Schema.NullOr(OpenKrittDescription),
  exploitability: OpenKrittExploitability,
  maliciousActor: Schema.NullOr(TrimmedString.check(Schema.isMaxLength(500))),
  canonical: Schema.Boolean,
  duplicateOf: Schema.NullOr(OpenKrittOpaqueId),
  /** Free-text root-bug label from the ranking pass, not an identifier. */
  rootBug: Schema.NullOr(TrimmedString.check(Schema.isMaxLength(500))),
  triage: OpenKrittTriage,
  source: Schema.Struct({
    commitSha: Schema.NullOr(OpenKrittCommitSha),
    snapshotId: Schema.NullOr(OpenKrittOpaqueId),
  }),
  cwe: Schema.optionalKey(TrimmedString.check(Schema.isMaxLength(100))),
  cvss: Schema.optionalKey(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 10 }))),
});
export type OpenKrittFinding = typeof OpenKrittFinding.Type;

export const OpenKrittFindingsListResult = Schema.Struct({
  items: Schema.Array(OpenKrittFinding).check(Schema.isMaxLength(200)),
  nextCursor: Schema.NullOr(TrimmedString.check(Schema.isMaxLength(500))),
  stale: Schema.Boolean,
});
export type OpenKrittFindingsListResult = typeof OpenKrittFindingsListResult.Type;

export const OpenKrittFindingDetailResult = Schema.Struct({
  finding: OpenKrittFinding,
  upstreamUrl: TrimmedString.check(Schema.isMaxLength(2_048)),
  stale: Schema.Boolean,
});
export type OpenKrittFindingDetailResult = typeof OpenKrittFindingDetailResult.Type;

export const OpenKrittRemediationEvidence = Schema.Struct({
  type: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  severity: OpenKrittFindingSeverity,
  summary: OpenKrittDescription,
  explanation: OpenKrittDescription,
  path: OpenKrittFilePath,
  line: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000_000 }))),
  triggerFlow: Schema.Array(OpenKrittDescription).check(Schema.isMaxLength(200)),
  maliciousInput: Schema.NullOr(OpenKrittDescription),
  exploitability: OpenKrittExploitability.pipe(
    Schema.withDecodingDefault(Effect.succeed("unknown" as const)),
  ),
  maliciousActor: Schema.NullOr(TrimmedString.check(Schema.isMaxLength(500))).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  cwe: Schema.NullOr(TrimmedString.check(Schema.isMaxLength(100))).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  cvss: Schema.NullOr(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 10 }))).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type OpenKrittRemediationEvidence = typeof OpenKrittRemediationEvidence.Type;

export const OpenKrittRemediationLaunchInput = Schema.Struct({
  projectId: ProjectId,
  findingId: OpenKrittOpaqueId,
  targetCommitSha: OpenKrittCommitSha,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  evidence: OpenKrittRemediationEvidence,
  worktreePreference: Schema.Literals(["from-exact-commit", "existing-clean-worktree"]),
});
export type OpenKrittRemediationLaunchInput = typeof OpenKrittRemediationLaunchInput.Type;

export const OpenKrittRemediationLaunchResult = Schema.Struct({
  threadId: ThreadId,
  runId: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(160))),
  sourceCommitSha: OpenKrittCommitSha,
});
export type OpenKrittRemediationLaunchResult = typeof OpenKrittRemediationLaunchResult.Type;

export const OpenKrittRescanInput = Schema.Struct({
  projectId: ProjectId,
  priorScanId: OpenKrittOpaqueId,
  priorRunId: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  remediationThreadId: Schema.optionalKey(TrimmedString.check(Schema.isMaxLength(160))),
  requestId: TrimmedNonEmptyString.check(
    Schema.isMaxLength(120),
    Schema.isPattern(/^[A-Za-z0-9_-]+$/),
  ),
  source: OpenKrittSourceIdentity,
  configurationConfirmed: Schema.Boolean,
  /**
   * Optional edited configuration. When omitted the server reuses the
   * configuration persisted with the prior launch intent so a rescan stays
   * comparable with the scan it is linked to; current settings defaults are
   * never silently substituted.
   */
  configuration: Schema.optionalKey(OpenKrittScanConfiguration),
});
export type OpenKrittRescanInput = typeof OpenKrittRescanInput.Type;

export const OpenKrittRescanResult = Schema.Struct({
  childRunId: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  externalScanId: Schema.NullOr(OpenKrittOpaqueId),
  /** The configuration actually used, so the client can disclose it. */
  configuration: OpenKrittScanConfiguration,
  /** True when the prior scan's persisted configuration was reused verbatim. */
  reusedPriorConfiguration: Schema.Boolean,
});
export type OpenKrittRescanResult = typeof OpenKrittRescanResult.Type;

/**
 * Comparison between two linked Open Kritt scans.
 *
 * `conclusion` deliberately separates "not reproduced" from "proven fixed":
 * absence in a later scan only proves a fix when the source revision and the
 * scan configuration were both identical, which is rarely true for a rescan of
 * a remediated revision.
 */
export const OpenKrittComparisonConclusion = Schema.Literals([
  "still-present",
  "not-reproduced",
  "uncertain",
  "proven-fixed",
]);
export type OpenKrittComparisonConclusion = typeof OpenKrittComparisonConclusion.Type;

export const OpenKrittComparisonEntry = Schema.Struct({
  fingerprint: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  findingId: OpenKrittOpaqueId,
  severity: OpenKrittFindingSeverity,
  type: TrimmedString.check(Schema.isMaxLength(500)),
  location: OpenKrittFindingLocation,
  summary: OpenKrittDescription,
});
export type OpenKrittComparisonEntry = typeof OpenKrittComparisonEntry.Type;

export const OpenKrittCompareScansInput = Schema.Struct({
  projectId: ProjectId,
  priorScanId: OpenKrittOpaqueId,
  currentScanId: OpenKrittOpaqueId,
  includeDuplicates: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type OpenKrittCompareScansInput = typeof OpenKrittCompareScansInput.Type;

export const OpenKrittComparisonResult = Schema.Struct({
  priorScanId: OpenKrittOpaqueId,
  currentScanId: OpenKrittOpaqueId,
  sameSourceRevision: Schema.Boolean,
  sameConfiguration: Schema.Boolean,
  conclusion: OpenKrittComparisonConclusion,
  reason: Schema.NullOr(TrimmedString.check(Schema.isMaxLength(500))),
  stillPresent: Schema.Array(OpenKrittComparisonEntry).check(Schema.isMaxLength(200)),
  disappeared: Schema.Array(OpenKrittComparisonEntry).check(Schema.isMaxLength(200)),
  stale: Schema.Boolean,
});
export type OpenKrittComparisonResult = typeof OpenKrittComparisonResult.Type;

export const OpenKrittSnapshotPreviewInput = Schema.Struct({
  projectId: ProjectId,
});
export type OpenKrittSnapshotPreviewInput = typeof OpenKrittSnapshotPreviewInput.Type;

export const OpenKrittSnapshotPreviewResult = Schema.Struct({
  projectId: ProjectId,
  snapshotId: Schema.NullOr(OpenKrittOpaqueId),
  manifestDigest: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  fileCount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50_000 })),
  byteCount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 536_870_912 })),
  includedPaths: Schema.Array(OpenKrittFilePath).check(Schema.isMaxLength(50_000)),
  excludedPaths: Schema.Array(OpenKrittFilePath).check(Schema.isMaxLength(50_000)),
  confirmedSafeForProvider: Schema.Literal(false),
});
export type OpenKrittSnapshotPreviewResult = typeof OpenKrittSnapshotPreviewResult.Type;

export const OpenKrittSnapshotCreateInput = Schema.Struct({
  projectId: ProjectId,
  confirmSafeForProvider: Schema.Boolean,
  /**
   * Digest of the manifest the user actually reviewed. The server rebuilds the
   * manifest and fails closed on a mismatch so the bytes sent to the model
   * provider are exactly the bytes that were confirmed.
   */
  acknowledgedManifestDigest: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
});
export type OpenKrittSnapshotCreateInput = typeof OpenKrittSnapshotCreateInput.Type;

export const OpenKrittSnapshotCreateResult = Schema.Struct({
  projectId: ProjectId,
  snapshotId: OpenKrittOpaqueId,
  manifestDigest: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  fileCount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50_000 })),
  byteCount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 536_870_912 })),
});
export type OpenKrittSnapshotCreateResult = typeof OpenKrittSnapshotCreateResult.Type;

export const IntegrationListResult = Schema.Struct({
  integrations: Schema.Array(IntegrationDescriptor),
});
export type IntegrationListResult = typeof IntegrationListResult.Type;

export const LoopAnyConfigureInput = Schema.Struct({
  settings: LoopAnySettingsPatch,
  token: Schema.optionalKey(LoopAnyToken),
  clearToken: Schema.optionalKey(Schema.Boolean),
});
export type LoopAnyConfigureInput = typeof LoopAnyConfigureInput.Type;

export const LoopAnyConfigureResult = Schema.Struct({
  settings: LoopAnySettings,
  tokenConfigured: Schema.Boolean,
});
export type LoopAnyConfigureResult = typeof LoopAnyConfigureResult.Type;

export const LoopAnyConnectionTestResult = Schema.Struct({
  ok: Schema.Boolean,
  message: TrimmedNonEmptyString,
  serverVersion: Schema.NullOr(Schema.String),
});
export type LoopAnyConnectionTestResult = typeof LoopAnyConnectionTestResult.Type;

export const MonkeyLoopyDiagnostic = Schema.Struct({
  level: Schema.Literals(["error", "warning", "info"]),
  message: TrimmedNonEmptyString,
  path: Schema.NullOr(Schema.String),
});
export type MonkeyLoopyDiagnostic = typeof MonkeyLoopyDiagnostic.Type;

export const MonkeyLoopyBlueprint = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
});
export type MonkeyLoopyBlueprint = typeof MonkeyLoopyBlueprint.Type;

export const MonkeyLoopyRecipe = Schema.Struct({
  name: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  scheduleMode: TrimmedNonEmptyString,
  cadence: Schema.NullOr(Schema.String),
  requiredInputs: Schema.Array(TrimmedNonEmptyString),
  minimumScore: Schema.Number,
  safety: TrimmedNonEmptyString,
});
export type MonkeyLoopyRecipe = typeof MonkeyLoopyRecipe.Type;

export const MonkeyLoopyAuthoringContextResult = Schema.Struct({
  factoryVersion: TrimmedNonEmptyString,
  executionVersion: TrimmedNonEmptyString,
  guideUrl: TrimmedNonEmptyString,
  llmsUrl: TrimmedNonEmptyString,
  llmsFullUrl: TrimmedNonEmptyString,
  schemaGuide: TrimmedNonEmptyString,
  blueprints: Schema.Array(MonkeyLoopyBlueprint),
  recipes: Schema.Array(MonkeyLoopyRecipe),
  executionNotice: TrimmedNonEmptyString,
});
export type MonkeyLoopyAuthoringContextResult = typeof MonkeyLoopyAuthoringContextResult.Type;

export const MonkeyLoopyScaffoldInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  recipe: Schema.optionalKey(TrimmedNonEmptyString),
  blueprint: Schema.optionalKey(TrimmedNonEmptyString),
});
export type MonkeyLoopyScaffoldInput = typeof MonkeyLoopyScaffoldInput.Type;

export const MonkeyLoopyScaffoldResult = Schema.Struct({
  yaml: TrimmedNonEmptyString,
  source: TrimmedNonEmptyString,
  factoryVersion: TrimmedNonEmptyString,
});
export type MonkeyLoopyScaffoldResult = typeof MonkeyLoopyScaffoldResult.Type;

export const MonkeyLoopyInferInput = Schema.Struct({
  source: Schema.String.check(Schema.isMaxLength(1_000_000)),
  filename: TrimmedNonEmptyString,
});
export type MonkeyLoopyInferInput = typeof MonkeyLoopyInferInput.Type;

export const MonkeyLoopyInferResult = Schema.Struct({
  kind: TrimmedNonEmptyString,
  confidence: TrimmedNonEmptyString,
  candidatePattern: TrimmedNonEmptyString,
  draftYaml: TrimmedNonEmptyString,
  secretsFlagged: Schema.Array(Schema.String),
  notes: Schema.Array(Schema.String),
  factoryVersion: TrimmedNonEmptyString,
});
export type MonkeyLoopyInferResult = typeof MonkeyLoopyInferResult.Type;

export const MonkeyLoopyValidateInput = Schema.Struct({
  yaml: Schema.String.check(Schema.isMaxLength(1_000_000)),
});
export type MonkeyLoopyValidateInput = typeof MonkeyLoopyValidateInput.Type;

export const MonkeyLoopyValidateResult = Schema.Struct({
  valid: Schema.Boolean,
  verified: Schema.Boolean,
  executionReady: Schema.Boolean,
  score: Schema.NullOr(Schema.Number),
  name: Schema.NullOr(Schema.String),
  factoryVersion: TrimmedNonEmptyString,
  executionVersion: TrimmedNonEmptyString,
  diagnostics: Schema.Array(MonkeyLoopyDiagnostic),
});
export type MonkeyLoopyValidateResult = typeof MonkeyLoopyValidateResult.Type;

export const MonkeyLoopyRunInput = Schema.Struct({
  requestId: TrimmedNonEmptyString.check(
    Schema.isMaxLength(120),
    Schema.isPattern(/^[A-Za-z0-9_-]+$/),
  ),
  projectId: ProjectId,
  yaml: Schema.String.check(Schema.isMaxLength(1_000_000)),
  inputs: Schema.Record(Schema.String, Schema.Unknown).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("approval-required" as const)),
  ),
  timeoutMinutes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 240 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(30)),
  ),
});
export type MonkeyLoopyRunInput = typeof MonkeyLoopyRunInput.Type;

export const IntegrationRunState = Schema.Literals([
  "queued",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
]);
export type IntegrationRunState = typeof IntegrationRunState.Type;

// Durable lifecycle records intentionally retain only bounded, presentation-safe
// summaries. Inputs, credentials and runtime environments never cross this boundary.
export const IntegrationRunId = TrimmedNonEmptyString.check(Schema.isMaxLength(160));
export type IntegrationRunId = typeof IntegrationRunId.Type;
const IntegrationRunSummary = Schema.String.check(Schema.isMaxLength(16_384));
const IntegrationRunFailure = Schema.String.check(Schema.isMaxLength(4_096));
const IntegrationRunTimelineSummary = Schema.String.check(Schema.isMaxLength(500));

export const IntegrationRunTimelineEvent = Schema.Struct({
  sequence: NonNegativeInt,
  state: IntegrationRunState,
  occurredAt: IsoDateTime,
  summary: IntegrationRunTimelineSummary,
});
export type IntegrationRunTimelineEvent = typeof IntegrationRunTimelineEvent.Type;

export const IntegrationRunVerificationSummary = Schema.Struct({
  valid: Schema.Boolean,
  verified: Schema.Boolean,
  executionReady: Schema.Boolean,
  score: Schema.NullOr(Schema.Number),
  name: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
  factoryVersion: TrimmedNonEmptyString,
  executionVersion: TrimmedNonEmptyString,
  errorCount: NonNegativeInt,
  warningCount: NonNegativeInt,
  infoCount: NonNegativeInt,
});
export type IntegrationRunVerificationSummary = typeof IntegrationRunVerificationSummary.Type;

export const IntegrationRun = Schema.Struct({
  id: IntegrationRunId,
  source: IntegrationId,
  state: IntegrationRunState,
  projectId: Schema.NullOr(ProjectId),
  parentRunId: Schema.NullOr(IntegrationRunId),
  attempt: NonNegativeInt,
  threadIds: Schema.Array(ThreadId).check(Schema.isMaxLength(100)),
  journalRef: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(4_096))),
  outputSummary: Schema.NullOr(IntegrationRunSummary),
  failure: Schema.NullOr(IntegrationRunFailure),
  verification: Schema.NullOr(IntegrationRunVerificationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  timeline: Schema.Array(IntegrationRunTimelineEvent)
    .check(Schema.isMaxLength(100))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  createdAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type IntegrationRun = typeof IntegrationRun.Type;

export const IntegrationRunCursor = Schema.Struct({
  createdAt: IsoDateTime,
  id: IntegrationRunId,
});
export type IntegrationRunCursor = typeof IntegrationRunCursor.Type;

export const IntegrationListRunsInput = Schema.Struct({
  source: Schema.optionalKey(IntegrationId),
  state: Schema.optionalKey(IntegrationRunState),
  projectId: Schema.optionalKey(ProjectId),
  createdAfter: Schema.optionalKey(IsoDateTime),
  createdBefore: Schema.optionalKey(IsoDateTime),
  cursor: Schema.optionalKey(IntegrationRunCursor),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(50)),
  ),
});
export type IntegrationListRunsInput = typeof IntegrationListRunsInput.Type;
export const IntegrationGetRunInput = Schema.Struct({ id: IntegrationRunId });
export type IntegrationGetRunInput = typeof IntegrationGetRunInput.Type;
export const IntegrationListRunsResult = Schema.Struct({
  runs: Schema.Array(IntegrationRun),
  nextCursor: Schema.NullOr(IntegrationRunCursor),
});
export type IntegrationListRunsResult = typeof IntegrationListRunsResult.Type;

export const MonkeyLoopyRunResult = Schema.Struct({
  run: IntegrationRun,
  created: Schema.Boolean,
});
export type MonkeyLoopyRunResult = typeof MonkeyLoopyRunResult.Type;

export const IntegrationRunRuntimePhase = Schema.Literals([
  "queued",
  "starting",
  "running",
  "agent",
  "stopping",
  "waiting",
  "terminal",
  "orphaned",
]);
export type IntegrationRunRuntimePhase = typeof IntegrationRunRuntimePhase.Type;

export const IntegrationRunCaps = Schema.Struct({
  maxIterations: NonNegativeInt,
  noProgressMaxRepeats: Schema.NullOr(NonNegativeInt),
  tokenBudget: Schema.NullOr(NonNegativeInt),
  usdBudget: Schema.NullOr(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))),
  wallclockBudget: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(100))),
  onCapExceeded: Schema.Literals(["fail", "breakpoint", "exit-clean"]),
});
export type IntegrationRunCaps = typeof IntegrationRunCaps.Type;

export const IntegrationRunRuntimeSnapshot = Schema.Struct({
  live: Schema.Boolean,
  phase: IntegrationRunRuntimePhase,
  recoverable: Schema.Boolean,
  progress: Schema.Struct({
    agentCallsStarted: NonNegativeInt,
    agentCallsCompleted: NonNegativeInt,
    activeStep: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
    activeThreadId: Schema.NullOr(ThreadId),
    linkedThreadIds: Schema.Array(ThreadId).check(Schema.isMaxLength(100)),
  }),
  caps: Schema.NullOr(IntegrationRunCaps),
  diagnostics: Schema.Array(Schema.String.check(Schema.isMaxLength(500))).check(
    Schema.isMaxLength(20),
  ),
});
export type IntegrationRunRuntimeSnapshot = typeof IntegrationRunRuntimeSnapshot.Type;

export const IntegrationRunOperationAvailability = Schema.Struct({
  allowed: Schema.Boolean,
  reason: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
});
export type IntegrationRunOperationAvailability = typeof IntegrationRunOperationAvailability.Type;

export const IntegrationRunOperations = Schema.Struct({
  cancel: IntegrationRunOperationAvailability,
  resume: IntegrationRunOperationAvailability,
  retry: IntegrationRunOperationAvailability,
});
export type IntegrationRunOperations = typeof IntegrationRunOperations.Type;

export const IntegrationInspectRunResult = Schema.Struct({
  run: IntegrationRun,
  runtime: IntegrationRunRuntimeSnapshot,
  operations: IntegrationRunOperations,
});
export type IntegrationInspectRunResult = typeof IntegrationInspectRunResult.Type;

export const IntegrationCancelRunResult = Schema.Struct({
  run: IntegrationRun,
  outcome: Schema.Literals(["cancelled", "already-terminal", "orphaned-failed"]),
});
export type IntegrationCancelRunResult = typeof IntegrationCancelRunResult.Type;

export const IntegrationResumeRunInput = Schema.Struct({
  id: IntegrationRunId,
  approveCaps: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type IntegrationResumeRunInput = typeof IntegrationResumeRunInput.Type;

export const IntegrationRetryRunInput = Schema.Struct({
  id: IntegrationRunId,
  requestId: TrimmedNonEmptyString.check(
    Schema.isMaxLength(120),
    Schema.isPattern(/^[A-Za-z0-9_-]+$/),
  ),
});
export type IntegrationRetryRunInput = typeof IntegrationRetryRunInput.Type;

export const IntegrationRecoverRunResult = Schema.Struct({
  run: IntegrationRun,
  operation: Schema.Literals(["resume", "retry"]),
  created: Schema.Boolean,
});
export type IntegrationRecoverRunResult = typeof IntegrationRecoverRunResult.Type;

export const IntegrationRequestErrorCode = Schema.Literals([
  "invalid-config",
  "not-configured",
  "validation-failed",
  "connection-failed",
  "execution-failed",
  "unauthorized",
  "run-not-found",
  "run-not-cancellable",
  "run-not-recoverable",
  "recovery-in-progress",
  "recovery-metadata-missing",
  "journal-invalid",
  "version-mismatch",
]);
export type IntegrationRequestErrorCode = typeof IntegrationRequestErrorCode.Type;

export class IntegrationRequestError extends Schema.TaggedErrorClass<IntegrationRequestError>()(
  "IntegrationRequestError",
  {
    code: IntegrationRequestErrorCode,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const INTEGRATION_WS_METHODS = {
  list: "integrations.list",
  configureLoopAny: "integrations.loopany.configure",
  testLoopAny: "integrations.loopany.test",
  configureOpenKritt: "integrations.openKritt.configure",
  testOpenKritt: "integrations.openKritt.test",
  refreshOpenKrittCatalog: "integrations.openKritt.catalog.refresh",
  launchOpenKrittScan: "integrations.openKritt.scan.launch",
  pauseOpenKrittScan: "integrations.openKritt.scan.pause",
  stopOpenKrittScan: "integrations.openKritt.scan.stop",
  resumeOpenKrittScan: "integrations.openKritt.scan.resume",
  listOpenKrittRuns: "integrations.openKritt.runs.list",
  listOpenKrittFindings: "integrations.openKritt.findings.list",
  getOpenKrittFinding: "integrations.openKritt.finding.get",
  launchOpenKrittRemediation: "integrations.openKritt.remediation.launch",
  rescanOpenKritt: "integrations.openKritt.rescan",
  compareOpenKrittScans: "integrations.openKritt.scans.compare",
  previewOpenKrittSnapshot: "integrations.openKritt.snapshot.preview",
  createOpenKrittSnapshot: "integrations.openKritt.snapshot.create",
  getMonkeyLoopyAuthoringContext: "integrations.monkeyLoopy.authoringContext",
  scaffoldMonkeyLoopy: "integrations.monkeyLoopy.scaffold",
  inferMonkeyLoopy: "integrations.monkeyLoopy.infer",
  validateMonkeyLoopy: "integrations.monkeyLoopy.validate",
  runMonkeyLoopy: "integrations.monkeyLoopy.run",
  listRuns: "integrations.runs.list",
  getRun: "integrations.runs.get",
  inspectRun: "integrations.runs.inspect",
  cancelRun: "integrations.runs.cancel",
  resumeRun: "integrations.runs.resume",
  retryRun: "integrations.runs.retry",
} as const;

export const IntegrationRpcSchemas = {
  // RPC payloads cross JSON boundaries, where `undefined` is encoded as `null`.
  // Model no-input integration methods explicitly as null to keep the wire
  // contract stable in browser and relay clients.
  list: { input: Schema.Null, output: IntegrationListResult },
  configureLoopAny: { input: LoopAnyConfigureInput, output: LoopAnyConfigureResult },
  testLoopAny: { input: Schema.Null, output: LoopAnyConnectionTestResult },
  configureOpenKritt: { input: OpenKrittConfigureInput, output: OpenKrittConfigureResult },
  testOpenKritt: { input: Schema.Null, output: OpenKrittConnectionTestResult },
  refreshOpenKrittCatalog: { input: Schema.Null, output: OpenKrittCatalog },
  launchOpenKrittScan: { input: OpenKrittLaunchScanInput, output: OpenKrittScanLaunchResult },
  pauseOpenKrittScan: { input: OpenKrittScanControlInput, output: OpenKrittScanControlResult },
  stopOpenKrittScan: { input: OpenKrittScanControlInput, output: OpenKrittScanControlResult },
  resumeOpenKrittScan: { input: OpenKrittScanControlInput, output: OpenKrittScanControlResult },
  listOpenKrittRuns: { input: IntegrationListRunsInput, output: IntegrationListRunsResult },
  listOpenKrittFindings: {
    input: OpenKrittFindingsListInput,
    output: OpenKrittFindingsListResult,
  },
  getOpenKrittFinding: {
    input: Schema.Struct({ scanId: OpenKrittOpaqueId, findingId: OpenKrittOpaqueId }),
    output: OpenKrittFindingDetailResult,
  },
  launchOpenKrittRemediation: {
    input: OpenKrittRemediationLaunchInput,
    output: OpenKrittRemediationLaunchResult,
  },
  rescanOpenKritt: { input: OpenKrittRescanInput, output: OpenKrittRescanResult },
  compareOpenKrittScans: {
    input: OpenKrittCompareScansInput,
    output: OpenKrittComparisonResult,
  },
  previewOpenKrittSnapshot: {
    input: OpenKrittSnapshotPreviewInput,
    output: OpenKrittSnapshotPreviewResult,
  },
  createOpenKrittSnapshot: {
    input: OpenKrittSnapshotCreateInput,
    output: OpenKrittSnapshotCreateResult,
  },
  getMonkeyLoopyAuthoringContext: {
    input: Schema.Null,
    output: MonkeyLoopyAuthoringContextResult,
  },
  scaffoldMonkeyLoopy: { input: MonkeyLoopyScaffoldInput, output: MonkeyLoopyScaffoldResult },
  inferMonkeyLoopy: { input: MonkeyLoopyInferInput, output: MonkeyLoopyInferResult },
  validateMonkeyLoopy: { input: MonkeyLoopyValidateInput, output: MonkeyLoopyValidateResult },
  runMonkeyLoopy: { input: MonkeyLoopyRunInput, output: MonkeyLoopyRunResult },
  listRuns: { input: IntegrationListRunsInput, output: IntegrationListRunsResult },
  getRun: { input: IntegrationGetRunInput, output: Schema.NullOr(IntegrationRun) },
  inspectRun: { input: IntegrationGetRunInput, output: IntegrationInspectRunResult },
  cancelRun: { input: IntegrationGetRunInput, output: IntegrationCancelRunResult },
  resumeRun: { input: IntegrationResumeRunInput, output: IntegrationRecoverRunResult },
  retryRun: { input: IntegrationRetryRunInput, output: IntegrationRecoverRunResult },
} as const;
