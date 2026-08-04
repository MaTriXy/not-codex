import type { OpenKrittFinding } from "@notcodex/contracts";
import { normalizeOpenKrittServerUrl } from "./openKrittUrl.ts";
import { decodeOpenKrittFindingDetail, type OpenKrittDecodedFinding } from "./openKrittSchemas.ts";
import { stripOpenKrittControlCharacters } from "./openKrittText.ts";

const MAX_EVIDENCE_CHARS = 16_000;

export function sanitizeOpenKrittEvidenceText(value: string): string {
  return stripOpenKrittControlCharacters(value).slice(0, MAX_EVIDENCE_CHARS);
}

export type NormalizedOpenKrittFinding = {
  readonly id: string;
  readonly scanId: string;
  readonly canonical: boolean;
  readonly duplicateOf: string | null;
  readonly severity: OpenKrittFinding["severity"];
  readonly rank: number | null;
  readonly type: string;
  readonly summary: string;
  readonly explanation: string;
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
  readonly triggerFlow: ReadonlyArray<string>;
  readonly maliciousInput: string | null;
  readonly exploitability: OpenKrittFinding["exploitability"];
  readonly maliciousActor: string | null;
  readonly rootBug: string | null;
  readonly triage: OpenKrittFinding["triage"];
  readonly cwe: string | null;
  readonly cvss: number | null;
  readonly sourceCommitSha: string;
  readonly snapshotId: string | null;
};

/**
 * The scan-level source identity a finding belongs to. Open Kritt does not
 * repeat the target revision on each finding, so it is carried from the scan
 * the findings were read from rather than invented per finding.
 */
export interface OpenKrittFindingSource {
  readonly commitSha: string | null;
  readonly snapshotId: string | null;
}

export function normalizeOpenKrittFinding(
  value: unknown,
  source: OpenKrittFindingSource = { commitSha: null, snapshotId: null },
): NormalizedOpenKrittFinding {
  return normalizeOpenKrittDecodedFinding(decodeOpenKrittFindingDetail(value), source);
}

export function normalizeOpenKrittDecodedFinding(
  finding: OpenKrittDecodedFinding,
  source: OpenKrittFindingSource = { commitSha: null, snapshotId: null },
): NormalizedOpenKrittFinding {
  return {
    id: finding.id,
    scanId: finding.scanId,
    canonical: finding.canonical,
    duplicateOf: finding.duplicateOf,
    severity: finding.severity,
    rank: finding.rank,
    type: sanitizeOpenKrittEvidenceText(finding.type),
    summary: sanitizeOpenKrittEvidenceText(finding.summary),
    explanation: sanitizeOpenKrittEvidenceText(finding.explanation),
    path: sanitizeOpenKrittEvidenceText(finding.location.path),
    line: finding.location.line,
    column: finding.location.column,
    triggerFlow: finding.triggerFlow.map(sanitizeOpenKrittEvidenceText),
    maliciousInput:
      finding.maliciousInput === null
        ? null
        : sanitizeOpenKrittEvidenceText(finding.maliciousInput),
    exploitability: finding.exploitability,
    maliciousActor:
      finding.maliciousActor === null
        ? null
        : sanitizeOpenKrittEvidenceText(finding.maliciousActor),
    rootBug: finding.rootBug === null ? null : sanitizeOpenKrittEvidenceText(finding.rootBug),
    triage: finding.triage,
    cwe: finding.cwe,
    cvss: finding.cvss,
    sourceCommitSha: source.commitSha ?? "unknown",
    snapshotId: source.snapshotId,
  };
}

export function buildOpenKrittFindingUrl(
  serverUrl: string,
  scanId: string,
  findingId: string,
): string {
  const origin = normalizeOpenKrittServerUrl(serverUrl);
  const validId = (value: string, label: string): string => {
    if (!/^[A-Za-z0-9_.:-]{1,256}$/.test(value)) throw new Error(`Invalid Open Kritt ${label}.`);
    return encodeURIComponent(value);
  };
  return `${origin}/scans/${validId(scanId, "scan id")}/vulnerabilities/${validId(findingId, "finding id")}`;
}

/** Converts the normalized presentation shape into the shared contract shape. */
export function toOpenKrittFindingContract(finding: NormalizedOpenKrittFinding): OpenKrittFinding {
  return {
    id: finding.id,
    scanId: finding.scanId,
    severity: finding.severity,
    rank: finding.rank,
    type: finding.type,
    summary: finding.summary,
    explanation: finding.explanation,
    location: { path: finding.path, line: finding.line, column: finding.column },
    triggerFlow: finding.triggerFlow,
    maliciousInput: finding.maliciousInput,
    exploitability: finding.exploitability,
    maliciousActor: finding.maliciousActor,
    canonical: finding.canonical,
    duplicateOf: finding.duplicateOf,
    rootBug: finding.rootBug,
    triage: finding.triage,
    source: {
      commitSha: /^[0-9a-f]{40}$/.test(finding.sourceCommitSha) ? finding.sourceCommitSha : null,
      snapshotId: finding.snapshotId,
    },
    ...(finding.cwe === null ? {} : { cwe: finding.cwe }),
    ...(finding.cvss === null ? {} : { cvss: finding.cvss }),
  };
}
