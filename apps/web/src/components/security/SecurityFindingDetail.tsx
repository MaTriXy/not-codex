import type { OpenKrittFindingDetailResult } from "@notcodex/contracts";

import { SecurityFindingMarkdown } from "./SecurityFindingMarkdown";

/**
 * Only an absolute http(s) URL is rendered as a link. The server builds this
 * value from the configured Open Kritt origin plus validated ids, but the client
 * refuses anything else so a future protocol change cannot turn upstream data
 * into a `javascript:` or `file:` navigation.
 */
export function securityUpstreamHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Bounded finding detail. Every upstream string goes through the inert
 * plain-text renderer; nothing here interprets Markdown, HTML or file links.
 */
export function SecurityFindingDetail({
  detail,
}: {
  readonly detail: OpenKrittFindingDetailResult;
}) {
  const finding = detail.finding;
  const href = securityUpstreamHref(detail.upstreamUrl);
  return (
    <section
      aria-labelledby={`finding-detail-${finding.id}`}
      className="space-y-3 rounded-lg border bg-muted/20 p-4 text-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`finding-detail-${finding.id}`} className="text-sm font-semibold">
          {finding.type} — severity {finding.severity} (rank {finding.rank})
        </h3>
        <span className="text-xs text-muted-foreground">
          exploitability {finding.exploitability} · triage {finding.triage}
        </span>
      </div>
      {detail.stale ? (
        <p role="status" className="text-xs text-warning-foreground">
          Showing the last authoritative copy of this finding; Open Kritt is unreachable.
        </p>
      ) : null}
      <p className="font-mono text-xs">
        {finding.location.path}
        {finding.location.line === null ? "" : `:${finding.location.line}`}
      </p>
      <div>
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Explanation
        </h4>
        <SecurityFindingMarkdown value={finding.explanation} />
      </div>
      {finding.triggerFlow.length > 0 ? (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Trigger flow
          </h4>
          <ol className="list-decimal space-y-1 pl-5 text-xs">
            {finding.triggerFlow.map((step) => (
              <li key={`${finding.id}:flow:${step}`}>
                <SecurityFindingMarkdown value={step} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {finding.maliciousInput === null ? null : (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Malicious input example
          </h4>
          <SecurityFindingMarkdown value={finding.maliciousInput} />
        </div>
      )}
      <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div>
          <dt className="inline font-medium">Scanned revision: </dt>
          <dd className="inline font-mono">{finding.source.commitSha ?? "local snapshot"}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Canonical: </dt>
          <dd className="inline">
            {finding.canonical ? "yes" : `duplicate of ${finding.duplicateOf ?? "unknown"}`}
          </dd>
        </div>
      </dl>
      {href === null ? (
        <p className="text-xs text-muted-foreground">
          No upstream Open Kritt record link is available.
        </p>
      ) : (
        <a
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
          href={href}
          target="_blank"
          rel="noreferrer noopener"
        >
          Open the upstream Open Kritt record
        </a>
      )}
    </section>
  );
}
