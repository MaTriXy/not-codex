import type { OpenKrittScanConfiguration } from "@notcodex/contracts";
import {
  decodeOpenKrittErrorResponse,
  decodeOpenKrittScan,
  isOpenKrittRecord,
} from "../openKrittSchemas.ts";

export { mapOpenKrittStatus } from "../openKrittStatus.ts";

/** The exact set `SCAN_LAUNCH_POLICIES` accepts in v1.2.0. */
export const OPEN_KRITT_LAUNCH_POLICIES: ReadonlyArray<string> = ["immediate", "queue"];

export function buildOpenKrittRequestMarker(requestId: string): {
  readonly not_codex: { readonly request_id: string };
} {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(requestId))
    throw new Error("Open Kritt request marker must be bounded and opaque.");
  return { not_codex: { request_id: requestId } };
}

/**
 * Wire format for `POST /api/scans`, verified against the pinned v1.2.0
 * `validateScan` implementation and a live deployment.
 *
 * The selection lives at the top level, not inside `configuration`: upstream
 * reads `workflowId`, `postScriptId`, `model`, `model_provider`, `harness`,
 * `thinking_effort`, `severity_ranker`, `job_limit`, and the target repo fields
 * from the request root. `configuration` is a free-form JSON column that
 * upstream stores verbatim (adding only `post_script_ids` and
 * `agent_skill_ids`), which is why the reserved Not Codex request marker can
 * survive there and make an uncertain POST reconcilable.
 *
 * The severity ranker is submitted as its combined Markdown body rather than an
 * id — upstream persists the ruleset text on the scan.
 */
function configurationBody(
  configuration: OpenKrittScanConfiguration,
  requestId: string,
): Record<string, unknown> {
  return {
    // The primary post-script is a top-level field; the remainder ride here and
    // upstream unions them into the stored `post_script_ids`.
    post_script_ids: [...configuration.postScriptIds],
    agent_skill_ids: [...configuration.agentSkillIds],
    ...buildOpenKrittRequestMarker(requestId),
  };
}

/**
 * Harness compatibility from the pinned `MODEL_PROVIDER_HARNESSES` table. Used
 * only to default an unspecified harness; an explicit choice is sent as-is and
 * upstream validates it.
 */
const OPEN_KRITT_PROVIDER_HARNESSES: Readonly<Record<string, ReadonlyArray<string>>> = {
  codex: ["codex"],
  claude: ["claude-code"],
  openrouter: ["codex", "claude-code"],
};

export function defaultOpenKrittHarness(providerId: string): string {
  const harness = OPEN_KRITT_PROVIDER_HARNESSES[providerId]?.[0];
  if (harness === undefined)
    throw new Error(`No Open Kritt harness is compatible with provider "${providerId}".`);
  return harness;
}

function selectionBody(configuration: OpenKrittScanConfiguration): Record<string, unknown> {
  const [primaryPostScriptId] = configuration.postScriptIds;
  if (primaryPostScriptId === undefined)
    throw new Error("Open Kritt requires at least one post-script.");
  if (
    configuration.severityRankerContent === undefined ||
    configuration.severityRankerContent.length === 0
  ) {
    // Resolved before the request is built; reaching here would submit a launch
    // upstream rejects with a 422 the user cannot act on.
    throw new Error("Open Kritt requires the severity ranker ruleset content.");
  }
  return {
    workflowId: configuration.workflowId,
    postScriptId: primaryPostScriptId,
    agentSkillIds: [...configuration.agentSkillIds],
    model: configuration.modelId,
    model_provider: configuration.providerId,
    harness: configuration.harness ?? defaultOpenKrittHarness(configuration.providerId),
    thinking_effort: configuration.thinkingEffort,
    severity_ranker: configuration.severityRankerContent,
    job_limit: configuration.jobLimit,
    ...(configuration.scope === undefined ? {} : { repo_scope: configuration.scope }),
    ...(configuration.extra === undefined ? {} : { extra: configuration.extra }),
  };
}

export function buildOpenKrittLaunchRequestBody(input: {
  readonly source: {
    readonly repoKind: "remote";
    readonly repoFull: string;
    readonly commitSha: string;
  };
  readonly requestId: string;
  readonly configuration: OpenKrittScanConfiguration;
  readonly launchPolicy?: string | undefined;
}): Record<string, unknown> {
  if (
    input.source.repoKind !== "remote" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.source.repoFull)
  )
    throw new Error("Invalid Open Kritt remote source.");
  if (!/^[0-9a-f]{40}$/.test(input.source.commitSha))
    throw new Error("Open Kritt requires a full immutable commit SHA.");
  return {
    repo_kind: "remote",
    repo_full: input.source.repoFull,
    commit_sha: input.source.commitSha,
    ...selectionBody(input.configuration),
    ...launchPolicyBody(input.launchPolicy),
    configuration: configurationBody(input.configuration, input.requestId),
  };
}

/**
 * The user's elected answer to a `409 scan_launch_policy_required`. It is only
 * ever a value Open Kritt itself offered (`immediate` or `queue`), and it is
 * sent alongside the original request marker so an interrupted POST can be
 * discovered by a later read-only reconciliation. The marker is not an
 * upstream idempotency key; callers must never blindly repeat the POST.
 *
 * Upstream reads `launchPolicy` or `launch_policy` at the request root only.
 */
function launchPolicyBody(launchPolicy: string | undefined): Record<string, unknown> {
  if (launchPolicy === undefined) return {};
  if (!OPEN_KRITT_LAUNCH_POLICIES.includes(launchPolicy))
    throw new Error("Invalid Open Kritt launch policy choice.");
  return { launchPolicy };
}

export function buildOpenKrittLocalScanRequestBody(input: {
  readonly snapshotFolderName: string;
  readonly requestId: string;
  readonly configuration: OpenKrittScanConfiguration;
  readonly launchPolicy?: string | undefined;
}): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(input.snapshotFolderName))
    throw new Error("Open Kritt local repo_full must be an immediate folder name.");
  return {
    repo_kind: "local",
    repo_full: input.snapshotFolderName,
    ...selectionBody(input.configuration),
    ...launchPolicyBody(input.launchPolicy),
    configuration: configurationBody(input.configuration, input.requestId),
  };
}

export type OpenKrittLaunchClassification =
  | { readonly kind: "accepted"; readonly externalScanId: string }
  | { readonly kind: "policy-required"; readonly choices: ReadonlyArray<string> }
  | {
      readonly kind: "validation-error";
      readonly fieldErrors: ReadonlyArray<{ readonly field: string; readonly message: string }>;
    };

export function classifyOpenKrittLaunchResponse(
  status: number,
  body: unknown,
): OpenKrittLaunchClassification {
  if (status === 201) {
    // A 201 is the full serialized scan; decoding it (rather than reading `id`
    // alone) means an accepted launch that came back in an unexpected shape
    // fails closed instead of correlating a run to a scan we cannot observe.
    return { kind: "accepted", externalScanId: decodeOpenKrittScan(body).id };
  }
  if (status === 409) {
    const error = decodeOpenKrittErrorResponse(body);
    if (error.code !== "scan_launch_policy_required")
      throw new Error("Unexpected Open Kritt conflict response.");
    // v1.2.0 states the requirement but does not enumerate the options, so the
    // documented policy set is offered rather than inferred from the response.
    return { kind: "policy-required", choices: OPEN_KRITT_LAUNCH_POLICIES };
  }
  if (status === 422) {
    const error = decodeOpenKrittErrorResponse(body);
    if (error.fieldErrors.length === 0) throw new Error("Invalid Open Kritt validation response.");
    return { kind: "validation-error", fieldErrors: error.fieldErrors };
  }
  throw new Error("Unexpected Open Kritt scan launch response.");
}

/** Reads the reserved launch marker back out of a stored scan configuration. */
export function readOpenKrittRequestMarker(configuration: unknown): string | null {
  if (!isOpenKrittRecord(configuration)) return null;
  const marker = configuration.not_codex;
  if (!isOpenKrittRecord(marker)) return null;
  return typeof marker.request_id === "string" ? marker.request_id : null;
}

export function launchResolutionForTimeout(): {
  readonly launchResolution: "unknown";
  readonly durableState: "waiting";
  readonly requiresReconciliation: true;
} {
  return { launchResolution: "unknown", durableState: "waiting", requiresReconciliation: true };
}

/**
 * The status a `pause` / `stop` / `resume` request maps to, and whether upstream
 * authorizes it from the current status. Mirrors `USER_STATUS_TRANSITIONS` in
 * the pinned `routes/scans.js`; an unauthorized transition returns a 500 there,
 * so it has to be refused before the request is sent.
 */
const OPEN_KRITT_USER_TRANSITIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  queued: ["stopped"],
  pending: ["stopped"],
  prewarming_cache: ["paused", "stopped"],
  running: ["paused", "stopped"],
  rate_limited: ["stopped"],
  paused: ["pending", "stopped"],
  post_processing: ["paused", "stopped"],
  completed: [],
  stopped: ["pending"],
  failed: ["pending"],
};

export function openKrittControlStatus(action: "pause" | "stop" | "resume"): string {
  return action === "pause" ? "paused" : action === "stop" ? "stopped" : "pending";
}

export function isOpenKrittControlAuthorized(
  action: "pause" | "stop" | "resume",
  currentStatus: string,
): boolean {
  return (OPEN_KRITT_USER_TRANSITIONS[currentStatus] ?? []).includes(
    openKrittControlStatus(action),
  );
}
