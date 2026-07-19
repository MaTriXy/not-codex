import type {
  EnvironmentId,
  LoopAnyConnectorDiagnostics,
  LoopAnyHealthState,
} from "@notcodex/contracts";
import { Link } from "@tanstack/react-router";
import { ActivityIcon, ArrowRightIcon, Clock3Icon } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { IntegrationRunIdCopyButton } from "./IntegrationRunIdCopyButton";

export function loopAnyHealthVariant(
  health: LoopAnyHealthState,
): "success" | "error" | "warning" | "secondary" {
  if (health === "healthy") return "success";
  if (health === "connecting" || health === "backing-off") return "warning";
  if (health === "disabled") return "secondary";
  return "error";
}

function timestamp(value: string | null): string {
  return value === null ? "Never" : new Date(value).toLocaleString();
}

export function LoopAnyDiagnosticsPanel({
  diagnostics,
  environmentId,
}: {
  readonly diagnostics: LoopAnyConnectorDiagnostics;
  readonly environmentId: EnvironmentId | null;
}) {
  const events = diagnostics.recentEvents.toReversed().slice(0, 10);
  return (
    <section
      aria-labelledby="loopany-diagnostics-title"
      className="border-t border-border/60 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id="loopany-diagnostics-title"
            className="flex items-center gap-2 text-sm font-medium"
          >
            <ActivityIcon className="size-4" /> Connector diagnostics
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Sanitized server-side health and recent delivery events. Secrets, external state, paths,
            and transcripts are never shown here.
          </p>
        </div>
        <Badge variant={loopAnyHealthVariant(diagnostics.health)}>{diagnostics.health}</Badge>
      </div>

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Last poll</dt>
          <dd className="mt-1 font-medium">{timestamp(diagnostics.lastPollAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last successful poll</dt>
          <dd className="mt-1 font-medium">{timestamp(diagnostics.lastSuccessAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Next retry</dt>
          <dd className="mt-1 font-medium">{timestamp(diagnostics.nextRetryAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Consecutive failures</dt>
          <dd className="mt-1 font-medium">{diagnostics.consecutiveFailures}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">In flight</dt>
          <dd className="mt-1 font-medium">{diagnostics.inFlight}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Protocol</dt>
          <dd className="mt-1 font-medium">
            {diagnostics.protocolVersion}
            {diagnostics.serverVersion === null ? "" : ` · server ${diagnostics.serverVersion}`}
          </dd>
        </div>
      </dl>

      {diagnostics.lastError === null ? null : (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
        >
          <span className="font-medium">{diagnostics.lastError.code}:</span>{" "}
          {diagnostics.lastError.message}
        </p>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Clock3Icon className="size-3.5" /> Recent connector events
        </h4>
        <Button size="sm" variant="ghost" render={<Link to="/runs" />}>
          All retained runs <ArrowRightIcon />
        </Button>
      </div>
      {events.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No connector events have been recorded yet.
        </p>
      ) : (
        <ol className="mt-2 divide-y rounded-lg border">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="font-medium">{event.summary}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {timestamp(event.occurredAt)} · {event.code}
                </p>
              </div>
              {event.runId === null ? null : (
                <div className="flex items-center gap-1">
                  <IntegrationRunIdCopyButton runId={event.runId} />
                  {environmentId === null ? null : (
                    <Button
                      size="sm"
                      variant="ghost"
                      render={
                        <Link
                          to="/runs/$environmentId/$runId"
                          params={{ environmentId, runId: event.runId }}
                        />
                      }
                    >
                      Inspect
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
