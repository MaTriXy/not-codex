import type { OpenKrittCatalog, OpenKrittCatalogItem, OpenKrittFinding } from "@notcodex/contracts";

import { OPEN_KRITT_PROTOCOL_COMPATIBILITY } from "./openKrittCompatibility.ts";
import { stripOpenKrittControlCharacters } from "./openKrittText.ts";

const MAX_FIELD_CHARS = OPEN_KRITT_PROTOCOL_COMPATIBILITY.limits.fieldChars;
const MAX_PATH_CHARS = OPEN_KRITT_PROTOCOL_COMPATIBILITY.limits.pathChars;
const MAX_COLLECTION_ITEMS = OPEN_KRITT_PROTOCOL_COMPATIBILITY.limits.collectionItems;
const SCAN_STATUSES: ReadonlySet<string> = new Set(OPEN_KRITT_PROTOCOL_COMPATIBILITY.statuses.scan);

export type OpenKrittScanStatus = (typeof OPEN_KRITT_PROTOCOL_COMPATIBILITY.statuses.scan)[number];
export type OpenKrittRepoKind = "remote" | "local";
export type OpenKrittLaunchResolution =
  | "unknown"
  | "accepted"
  | "reconciled"
  | "policy-required"
  | "rejected";
export type OpenKrittFindingSeverity = OpenKrittFinding["severity"];
export type OpenKrittExploitability = OpenKrittFinding["exploitability"];
export type OpenKrittTriage = OpenKrittFinding["triage"];

export class OpenKrittProtocolError extends Error {
  readonly code = "protocol-error";

  constructor(message = "Invalid Open Kritt protocol response.") {
    super(message);
    this.name = "OpenKrittProtocolError";
  }
}

function invalid(message: string): never {
  throw new OpenKrittProtocolError(message);
}

export function isOpenKrittRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isOpenKrittRecord(value)) {
    return invalid(`Invalid Open Kritt ${label} response.`);
  }
  return value;
}

export function isOpenKrittScanStatus(value: unknown): value is OpenKrittScanStatus {
  return typeof value === "string" && SCAN_STATUSES.has(value);
}

export function decodeOpenKrittScanStatus(value: unknown): OpenKrittScanStatus {
  if (!isOpenKrittScanStatus(value)) invalid("Invalid Open Kritt scan status.");
  return value;
}

export function decodeOpenKrittRepoKind(value: unknown): OpenKrittRepoKind {
  if (value === "remote" || value === "local") return value;
  return invalid("Invalid Open Kritt source kind.");
}

export function decodeOpenKrittLaunchResolution(value: unknown): OpenKrittLaunchResolution {
  if (
    value === "unknown" ||
    value === "accepted" ||
    value === "reconciled" ||
    value === "policy-required" ||
    value === "rejected"
  )
    return value;
  return invalid("Invalid Open Kritt launch resolution.");
}

// The three decoders below validate values Not Codex itself persisted, where
// the enum is authoritative. Upstream values go through the `normalize*`
// functions instead, because Open Kritt emits model-authored strings there.
export function decodeOpenKrittFindingSeverity(value: unknown): OpenKrittFindingSeverity {
  if (
    value === "critical" ||
    value === "high" ||
    value === "medium" ||
    value === "low" ||
    value === "info" ||
    value === "unknown"
  )
    return value;
  return invalid("Invalid Open Kritt finding severity.");
}

export function decodeOpenKrittExploitability(value: unknown): OpenKrittExploitability {
  if (value === "likely" || value === "possible" || value === "unlikely" || value === "unknown")
    return value;
  return invalid("Invalid Open Kritt exploitability.");
}

export function decodeOpenKrittTriage(value: unknown): OpenKrittTriage {
  if (value === "interesting" || value === "uninteresting" || value === "untriaged") return value;
  return invalid("Invalid Open Kritt triage state.");
}

/**
 * Upstream severity is post-script output, not a protocol enum: a ranker may
 * emit any label, a different casing, or nothing at all. Recognized names are
 * normalized and everything else becomes `unknown` — inventing a severity for
 * an unrecognized label would misrank a security finding either way.
 */
export function normalizeOpenKrittSeverity(value: unknown): OpenKrittFindingSeverity {
  if (typeof value !== "string") return "unknown";
  switch (value.trim().toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
    case "moderate":
      return "medium";
    case "low":
      return "low";
    case "info":
    case "informational":
      return "info";
    default:
      return "unknown";
  }
}

/** Upstream `exploitable` is a boolean answer field; absent means unassessed. */
export function normalizeOpenKrittExploitability(value: unknown): OpenKrittExploitability {
  if (value === true) return "likely";
  if (value === false) return "unlikely";
  return "unknown";
}

/** Upstream `interesting` is 1 / 0 / null, serialized as a number. */
export function normalizeOpenKrittTriage(value: unknown): OpenKrittTriage {
  if (value === 1) return "interesting";
  if (value === 0) return "uninteresting";
  if (value === null || value === undefined) return "untriaged";
  return invalid("Invalid Open Kritt triage state.");
}

function stringValue(value: unknown, label: string, max: number = MAX_FIELD_CHARS): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    return invalid(`Invalid or oversized Open Kritt ${label}.`);
  }
  return stripOpenKrittControlCharacters(value);
}

function nullableString(
  value: unknown,
  label: string,
  max: number = MAX_FIELD_CHARS,
): string | null {
  if (value === null || value === undefined) return null;
  return stringValue(value, label, max);
}

function boundedArray(
  value: unknown,
  label: string,
  max: number = MAX_COLLECTION_ITEMS,
): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    return invalid(`Invalid or oversized Open Kritt ${label}.`);
  return value;
}

function integer(value: unknown, label: string, min = 0, max = 10_000_000): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return invalid(`Invalid Open Kritt ${label}.`);
  }
  return value;
}

function boundedId(value: unknown, label: string): string {
  const id = stringValue(value, label, 256);
  if (!/^[A-Za-z0-9_.:-]+$/.test(id)) return invalid(`Invalid Open Kritt ${label}.`);
  return id;
}

function commitSha(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const sha = stringValue(value, "commit SHA", 64);
  if (!/^[0-9a-f]{40}$/.test(sha)) return invalid("Invalid Open Kritt commit SHA.");
  return sha;
}

/** Upstream serializes progress as a display string such as `"42%"`. */
function progressPercent(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return invalid("Invalid Open Kritt scan progress.");
  const match = /^(\d{1,3})%$/.exec(value.trim());
  if (match === null) return invalid("Invalid Open Kritt scan progress.");
  const percent = Number(match[1]);
  if (percent > 100) return invalid("Invalid Open Kritt scan progress.");
  return percent;
}

function decodeCatalogItem(value: unknown): OpenKrittCatalogItem {
  const item = record(value, "catalog item");
  const id = boundedId(item.id, "catalog id");
  const name = stringValue(item.name, "catalog name", 500);
  // Upstream always emits `description`, as `""` when unset; an empty string is
  // not a protocol violation, it just carries no information.
  const description =
    item.description === undefined || item.description === null || item.description === ""
      ? undefined
      : stringValue(item.description, "catalog description");
  return {
    id,
    name,
    ...(description === undefined ? {} : { description }),
  };
}

/**
 * Severity rankers are selected by content at launch, so their Markdown body is
 * carried through catalog discovery rather than being fetched again later.
 */
function decodeSeverityRankerItem(value: unknown): OpenKrittCatalogItem {
  const item = record(value, "catalog item");
  const base = decodeCatalogItem(item);
  const content = stringValue(item.content, "severity ranker content", 32_000);
  return { ...base, content };
}

export function decodeOpenKrittHealth(value: unknown): {
  readonly service: string;
  readonly status: "ok";
} {
  const health = record(value, "health");
  if (
    health.service !== OPEN_KRITT_PROTOCOL_COMPATIBILITY.serviceIdentity ||
    health.status !== "ok"
  ) {
    return invalid("Invalid Open Kritt health service identity.");
  }
  return { service: OPEN_KRITT_PROTOCOL_COMPATIBILITY.serviceIdentity, status: "ok" };
}

/**
 * Catalog assembly from the six discovery endpoints. Each returns a bare JSON
 * array except `/api/model-providers`, which returns `{ providers: [id] }`, and
 * `/api/model-catalog`, which carries the per-provider model list.
 */
export function decodeOpenKrittCatalog(input: {
  readonly workflows: unknown;
  readonly postScripts: unknown;
  readonly agentSkills: unknown;
  readonly severityRankers: unknown;
  readonly modelProviders: unknown;
  readonly modelCatalog: unknown;
}): OpenKrittCatalog {
  const catalogItems = (value: unknown, label: string) =>
    boundedArray(value, label, 100).map(decodeCatalogItem);
  const providerIds = boundedArray(
    record(input.modelProviders, "model providers").providers,
    "model providers",
    100,
  ).map((raw) => boundedId(raw, "model provider id"));
  const catalogByProvider = new Map<string, ReadonlyArray<{ id: string; name: string }>>();
  for (const raw of boundedArray(
    record(input.modelCatalog, "model catalog").providers,
    "model catalog",
    100,
  )) {
    const entry = record(raw, "model catalog provider");
    const provider = boundedId(entry.provider, "model provider id");
    const models = boundedArray(entry.models ?? [], "models", 500).map((model) => {
      // Upstream model entries are either a bare id or `{ id, name }`.
      if (typeof model === "string") {
        const id = stringValue(model, "model id", 200);
        return { id, name: id };
      }
      const item = record(model, "model");
      const id = stringValue(item.id, "model id", 200);
      return { id, name: item.name === undefined ? id : stringValue(item.name, "model name", 500) };
    });
    catalogByProvider.set(provider, models);
  }
  return {
    workflows: catalogItems(input.workflows, "workflows"),
    postScripts: catalogItems(input.postScripts, "post scripts"),
    agentSkills: catalogItems(input.agentSkills, "agent skills"),
    severityRankers: boundedArray(input.severityRankers, "severity rankers", 100).map(
      decodeSeverityRankerItem,
    ),
    modelProviders: providerIds.map((id) => ({
      id,
      name: id,
      models: catalogByProvider.get(id) ?? [],
    })),
  };
}

export interface OpenKrittDecodedScan {
  readonly id: string;
  readonly status: OpenKrittScanStatus;
  readonly phase: string | null;
  readonly progress: number | null;
  readonly findingCount: number | null;
  readonly duplicateCount: number | null;
  readonly source: {
    readonly repoKind: OpenKrittRepoKind;
    readonly repoFull: string;
    readonly commitSha: string | null;
  } | null;
  readonly updatedAt: string | null;
  readonly configuration: unknown;
}

function decodeScanBase(value: unknown): OpenKrittDecodedScan {
  const scan = record(value, "scan");
  const id = boundedId(scan.id, "scan id");
  const status = decodeOpenKrittScanStatus(scan.status);
  // Upstream has no `phase`; `progressLabel` is the human-readable stage.
  const phase = nullableString(scan.progressLabel, "scan phase", 500);
  const repoFull =
    scan.repoFull === undefined || scan.repoFull === null
      ? null
      : stringValue(scan.repoFull, "repository", MAX_PATH_CHARS);
  const source =
    repoFull === null
      ? null
      : {
          repoKind: decodeOpenKrittRepoKind(scan.repoKind ?? "remote"),
          repoFull,
          commitSha: commitSha(scan.commitSha),
        };
  if (source !== null && source.repoKind === "remote" && source.commitSha === null) {
    return invalid("Missing Open Kritt remote source commit SHA.");
  }
  return {
    id,
    status,
    phase,
    progress: progressPercent(scan.progress),
    findingCount:
      scan.canonicalFindings === undefined || scan.canonicalFindings === null
        ? null
        : integer(scan.canonicalFindings, "finding count"),
    duplicateCount:
      scan.duplicateFindings === undefined || scan.duplicateFindings === null
        ? null
        : integer(scan.duplicateFindings, "duplicate count"),
    source,
    updatedAt: nullableString(scan.updatedAt, "scan updated timestamp", 100),
    configuration: scan.configuration,
  };
}

export function decodeOpenKrittScan(value: unknown): OpenKrittDecodedScan {
  return decodeScanBase(value);
}

/**
 * `GET /api/scans` returns a bare array unless `page`/`pageSize` are supplied,
 * in which case it returns an envelope with `totalPages`. Both are accepted so
 * a caller that does not paginate still decodes.
 */
export function decodeOpenKrittScanList(value: unknown): {
  readonly items: ReadonlyArray<OpenKrittDecodedScan>;
  readonly page: number | null;
  readonly pageSize: number | null;
  readonly totalPages: number | null;
} {
  if (Array.isArray(value)) {
    return {
      items: boundedArray(value, "scan list", 200).map(decodeScanBase),
      page: null,
      pageSize: null,
      totalPages: null,
    };
  }
  const list = record(value, "scan list");
  const items = boundedArray(list.items, "scan list", 200).map(decodeScanBase);
  return {
    items,
    page: list.page === undefined ? null : integer(list.page, "scan page", 1, 1_000_000),
    pageSize: list.pageSize === undefined ? null : integer(list.pageSize, "scan page size", 1, 100),
    totalPages:
      list.totalPages === undefined
        ? null
        : integer(list.totalPages, "scan page count", 1, 1_000_000),
  };
}

export interface OpenKrittDecodedFinding {
  readonly id: string;
  readonly scanId: string;
  readonly rank: number | null;
  readonly severity: OpenKrittFindingSeverity;
  readonly type: string;
  readonly summary: string;
  readonly explanation: string;
  readonly location: {
    readonly path: string;
    readonly line: number | null;
    readonly column: number | null;
  };
  readonly triggerFlow: ReadonlyArray<string>;
  readonly maliciousInput: string | null;
  readonly exploitability: OpenKrittExploitability;
  readonly maliciousActor: string | null;
  readonly canonical: boolean;
  readonly duplicateOf: string | null;
  readonly rootBug: string | null;
  readonly triage: OpenKrittTriage;
  readonly cwe: string | null;
  readonly cvss: number | null;
}

/**
 * Upstream serializes a finding from a model-authored `jsonAnswer` plus
 * post-script enrichment, so almost every content field is nullable and none of
 * it is trustworthy. Only the identifiers and the dedupe/triage metadata are
 * structural; the rest is decoded defensively, bounded, and treated as evidence.
 */
export function decodeOpenKrittFindingDetail(value: unknown): OpenKrittDecodedFinding {
  const finding = record(value, "finding");
  const id = boundedId(finding.id, "finding id");
  const scanId = boundedId(finding.scanId, "finding scan id");
  const rank =
    finding.rank === null || finding.rank === undefined
      ? null
      : integer(finding.rank, "finding rank", 0, 1_000_000);
  const post = isOpenKrittRecord(finding.postScriptAnswer) ? finding.postScriptAnswer : {};
  const dedupe = record(finding.dedupe ?? {}, "finding dedupe");
  const bountyRank = isOpenKrittRecord(finding.bountyRank) ? finding.bountyRank : {};
  const triggerFlowValue = finding.trigger_flow ?? [];
  const triggerFlow = (
    Array.isArray(triggerFlowValue)
      ? boundedArray(triggerFlowValue, "trigger flow", 200)
      : [triggerFlowValue]
  ).map((item) =>
    typeof item === "string"
      ? stringValue(item, "trigger flow item")
      : invalid("Invalid Open Kritt trigger flow item."),
  );
  const line =
    finding.line === null || finding.line === undefined
      ? null
      : integer(finding.line, "finding line", 0, 10_000_000);
  return {
    id,
    scanId,
    rank,
    severity: normalizeOpenKrittSeverity(finding.severity ?? post.severity),
    type: nullableString(finding.vulnerability_type, "finding type", 500) ?? "unclassified",
    summary: nullableString(finding.summary, "finding summary") ?? "",
    explanation: nullableString(finding.explanation, "finding explanation") ?? "",
    location: {
      path: nullableString(finding.file_path, "finding path", MAX_PATH_CHARS) ?? "",
      // Upstream models occasionally answer `0`; that is "no line", not line 0.
      line: line === null || line === 0 ? null : line,
      column: null,
    },
    triggerFlow,
    maliciousInput: nullableString(finding.malicious_input_example, "malicious input"),
    exploitability: normalizeOpenKrittExploitability(finding.exploitable),
    maliciousActor: nullableString(finding.malicious_actor, "malicious actor", 500),
    canonical: dedupe.isCanonical !== false,
    duplicateOf:
      dedupe.canonicalId === null || dedupe.canonicalId === undefined
        ? null
        : boundedId(dedupe.canonicalId, "duplicate finding id"),
    rootBug: nullableString(bountyRank.rootBug, "root bug", 500),
    triage: normalizeOpenKrittTriage(finding.interesting),
    cwe: nullableString(post.cwe, "CWE", 100),
    cvss:
      post.cvss === null || post.cvss === undefined
        ? null
        : typeof post.cvss === "number" && post.cvss >= 0 && post.cvss <= 10
          ? post.cvss
          : invalid("Invalid Open Kritt CVSS value."),
  };
}

/** `GET /api/scans/:id/vulnerabilities` returns a bare, already-ranked array. */
export function decodeOpenKrittFindings(value: unknown): {
  readonly items: ReadonlyArray<OpenKrittDecodedFinding>;
} {
  return {
    items: boundedArray(
      value,
      "findings",
      OPEN_KRITT_PROTOCOL_COMPATIBILITY.limits.findingsItems,
    ).map(decodeOpenKrittFindingDetail),
  };
}

/**
 * Upstream error envelope: `{ error, code?, errors?: [{ field, message }] }`.
 * Used for both `422` field errors and the `409` launch-policy response.
 */
export function decodeOpenKrittErrorResponse(value: unknown): {
  readonly code: string | null;
  readonly fieldErrors: ReadonlyArray<{ readonly field: string; readonly message: string }>;
} {
  const body = record(value, "error");
  const details = body.errors === undefined ? [] : boundedArray(body.errors, "error details", 50);
  return {
    code: nullableString(body.code, "error code", 100),
    fieldErrors: details.map((raw) => {
      const detail = record(raw, "error field");
      return {
        field: stringValue(detail.field, "error field name", 200),
        message: stringValue(detail.message, "error message", 500),
      };
    }),
  };
}
