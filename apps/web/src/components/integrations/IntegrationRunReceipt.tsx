import { EnvironmentId, type IntegrationRunState } from "@notcodex/contracts";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  Clock3Icon,
  ExternalLinkIcon,
  LoaderCircleIcon,
} from "lucide-react";

import { integrationEnvironment } from "../../state/integrations";
import { useEnvironmentQuery } from "../../state/query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const TERMINAL_STATES = new Set<IntegrationRunState>(["succeeded", "failed", "cancelled"]);

function RunStateIcon({ state }: { readonly state: IntegrationRunState }) {
  if (state === "succeeded") return <CheckCircle2Icon className="size-4" />;
  if (state === "failed" || state === "cancelled") return <CircleAlertIcon className="size-4" />;
  if (state === "queued" || state === "running") {
    return <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />;
  }
  return <Clock3Icon className="size-4" />;
}

function stateVariant(state: IntegrationRunState): "success" | "error" | "warning" | "secondary" {
  if (state === "succeeded") return "success";
  if (state === "failed" || state === "cancelled") return "error";
  if (state === "waiting") return "warning";
  return "secondary";
}

function formatTimestamp(value: string | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function IntegrationRunReceipt({
  environmentId: rawEnvironmentId,
  runId,
}: {
  readonly environmentId: string;
  readonly runId: string;
}) {
  const environmentId = EnvironmentId.make(rawEnvironmentId);
  const runQuery = useEnvironmentQuery(
    integrationEnvironment.getRun({ environmentId, input: { id: runId } }),
  );
  const run = runQuery.data;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <main className="mx-auto max-w-3xl space-y-6 px-5 py-8 sm:px-8">
        <Button size="sm" variant="ghost" render={<Link to="/settings/integrations" />}>
          <ArrowLeftIcon /> Back to integrations
        </Button>

        <header className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Monkey.D.Loopy run
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">Run receipt</h1>
            {run ? (
              <Badge variant={stateVariant(run.state)}>
                <RunStateIcon state={run.state} /> {run.state}
              </Badge>
            ) : null}
          </div>
          <p className="break-all font-mono text-xs text-muted-foreground">{runId}</p>
        </header>

        {runQuery.error ? (
          <section role="alert" className="rounded-xl border border-destructive/30 p-4">
            <h2 className="font-medium text-destructive-foreground">Run could not be loaded</h2>
            <p className="mt-1 text-sm text-muted-foreground">{runQuery.error}</p>
            <Button className="mt-3" size="sm" variant="outline" onClick={runQuery.refresh}>
              Retry
            </Button>
          </section>
        ) : runQuery.isPending && !run ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
            Loading the durable run record…
          </p>
        ) : !run ? (
          <section role="status" className="rounded-xl border p-4">
            <h2 className="font-medium">Run not found</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This environment does not have a durable record for this run id.
            </p>
          </section>
        ) : (
          <>
            <section aria-labelledby="run-details-heading" className="rounded-xl border p-5">
              <h2 id="run-details-heading" className="text-sm font-semibold">
                Durable status
              </h2>
              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Project</dt>
                  <dd className="mt-1 font-mono text-xs">{run.projectId ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Attempt</dt>
                  <dd className="mt-1">{run.attempt}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Queued</dt>
                  <dd className="mt-1">{formatTimestamp(run.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Started</dt>
                  <dd className="mt-1">{formatTimestamp(run.startedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Updated</dt>
                  <dd className="mt-1">{formatTimestamp(run.updatedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Completed</dt>
                  <dd className="mt-1">{formatTimestamp(run.completedAt)}</dd>
                </div>
              </dl>
              {!TERMINAL_STATES.has(run.state) ? (
                <p role="status" className="mt-4 text-xs text-muted-foreground">
                  This receipt refreshes automatically while the server owns the run.
                </p>
              ) : null}
            </section>

            {run.threadIds.length > 0 ? (
              <section aria-labelledby="run-threads-heading" className="rounded-xl border p-5">
                <h2 id="run-threads-heading" className="text-sm font-semibold">
                  Not Codex threads
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Each agent step remains inspectable as an ordinary thread.
                </p>
                <ul className="mt-3 space-y-2">
                  {run.threadIds.map((threadId, index) => (
                    <li key={threadId}>
                      <Button
                        size="sm"
                        variant="outline"
                        render={
                          <Link
                            to="/$environmentId/$threadId"
                            params={{ environmentId, threadId }}
                          />
                        }
                      >
                        Step {index + 1} <ExternalLinkIcon />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {run.failure ? (
              <section
                aria-labelledby="run-failure-heading"
                className="rounded-xl border border-destructive/30 p-5"
              >
                <h2 id="run-failure-heading" className="text-sm font-semibold">
                  Failure
                </h2>
                <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-destructive-foreground">
                  {run.failure}
                </pre>
              </section>
            ) : null}

            {run.outputSummary ? (
              <section aria-labelledby="run-output-heading" className="rounded-xl border p-5">
                <h2 id="run-output-heading" className="text-sm font-semibold">
                  Output summary
                </h2>
                <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                  {run.outputSummary}
                </pre>
              </section>
            ) : null}

            {run.journalRef ? (
              <p className="break-all text-xs text-muted-foreground">
                Journal reference: <span className="font-mono">{run.journalRef}</span>
              </p>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
