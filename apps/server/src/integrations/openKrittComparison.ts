import { OpenKrittScanConfiguration } from "@notcodex/contracts";
import * as Schema from "effect/Schema";

import type { OpenKrittPersistedFinding } from "./Services/OpenKrittScanRepository.ts";

const decodeOpenKrittScanConfiguration = Schema.decodeUnknownSync(OpenKrittScanConfiguration);

/**
 * Reads the configuration persisted with a launch intent back into the bounded
 * contract shape. A rescan must reuse the prior configuration so the two scans
 * stay comparable; falling back to current settings defaults would silently
 * change workflow, model, thinking effort and job limit.
 */
export function priorScanConfiguration(
  summary: Readonly<Record<string, unknown>> | undefined,
): OpenKrittScanConfiguration | null {
  if (summary === undefined) return null;
  try {
    return decodeOpenKrittScanConfiguration(summary);
  } catch {
    return null;
  }
}

/**
 * Order-insensitive equality for two persisted configuration summaries. Post
 * script and skill ids are sets upstream, so a reordered list is the same scan
 * configuration and must not make a comparison "uncertain".
 */
export function sameOpenKrittConfiguration(
  left: Readonly<Record<string, unknown>> | undefined,
  right: Readonly<Record<string, unknown>> | undefined,
): boolean {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${[...value].map(canonical).sort().join(",")}]`;
    if (value !== null && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>)
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
        .sort()
        .join(",")}}`;
    }
    return JSON.stringify(value ?? null);
  };
  if (left === undefined || right === undefined) return false;
  return canonical(left) === canonical(right);
}

/** Bounded presentation entry for one side of a scan comparison. */
export function comparisonEntry(finding: OpenKrittPersistedFinding, fingerprint: string) {
  return {
    fingerprint,
    findingId: finding.id,
    severity: finding.severity,
    type: finding.type,
    location: { path: finding.path, line: finding.line, column: finding.column },
    summary: finding.summary,
  };
}
