import type { OpenKrittComparisonResult } from "@notcodex/contracts";

import { securityComparisonLabel } from "./ProjectSecurityPage";

/**
 * Presents a linked rescan comparison. "Not reproduced" and "proven fixed" are
 * always rendered as distinct outcomes so an absent finding is never read as a
 * confirmed remediation.
 */
export function ScanComparisonPanel({
  comparison,
}: {
  readonly comparison: OpenKrittComparisonResult;
}) {
  return (
    <section
      aria-labelledby="security-comparison-heading"
      className="space-y-3 rounded-lg border p-4 text-sm"
    >
      <h3 id="security-comparison-heading" className="text-sm font-semibold">
        Rescan comparison
      </h3>
      <p className="font-mono text-xs text-muted-foreground">
        {comparison.priorScanId} → {comparison.currentScanId}
      </p>
      <p role="status">{securityComparisonLabel(comparison.conclusion)}</p>
      {comparison.reason === null ? null : (
        <p className="text-xs text-muted-foreground">{comparison.reason}</p>
      )}
      <ul className="text-xs text-muted-foreground">
        <li>Same source revision: {comparison.sameSourceRevision ? "yes" : "no"}</li>
        <li>Same configuration: {comparison.sameConfiguration ? "yes" : "no"}</li>
      </ul>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Still present ({comparison.stillPresent.length})
          </h4>
          <ul className="mt-1 space-y-1 text-xs">
            {comparison.stillPresent.map((entry) => (
              <li key={entry.fingerprint} className="font-mono">
                {entry.severity} · {entry.location.path}
                {entry.location.line === null ? "" : `:${entry.location.line}`}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            No longer reported ({comparison.disappeared.length})
          </h4>
          <ul className="mt-1 space-y-1 text-xs">
            {comparison.disappeared.map((entry) => (
              <li key={entry.fingerprint} className="font-mono">
                {entry.severity} · {entry.location.path}
                {entry.location.line === null ? "" : `:${entry.location.line}`}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
