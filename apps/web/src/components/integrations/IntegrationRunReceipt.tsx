import { useEffect, useRef } from "react";
import { EnvironmentId, type IntegrationRunState } from "@notcodex/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import {
  BanIcon,
  ArrowLeftIcon,
  CheckIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  Clock3Icon,
  CopyIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  PlayIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useState } from "react";

import { integrationEnvironment } from "../../state/integrations";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironment } from "../../state/environments";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { randomUUID } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import {
  deriveIntegrationRunControls,
  getOrCreateIntegrationRetryRequest,
  integrationRunOperationConfirmation,
  shouldAutoRefreshIntegrationRunReceipt,
  TERMINAL_INTEGRATION_RUN_STATES,
  type IntegrationRunOperation,
} from "./IntegrationRunReceipt.logic";
import { deriveRunTimeline } from "./IntegrationRunsPage.logic";

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

function operationLabel(operation: IntegrationRunOperation): string {
  if (operation === "cancel") return "Cancel run";
  if (operation === "resume") return "Resume run";
  return "Retry run";
}

function RunOperationIcon({ operation }: { readonly operation: IntegrationRunOperation }) {
  if (operation === "cancel") return <BanIcon />;
  if (operation === "resume") return <PlayIcon />;
  return <RotateCcwIcon />;
}

function formatOperationFailure(operation: IntegrationRunOperation, cause: Cause.Cause<unknown>) {
  const error = Cause.squash(cause);
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return `${operationLabel(operation)} failed. Refresh the durable run state and try again.`;
}

export function IntegrationRunControls({
  controls,
  confirmingState,
  pendingOperation,
  operationStatus,
  onSelect,
}: {
  readonly controls: ReturnType<typeof deriveIntegrationRunControls>;
  readonly confirmingState: boolean;
  readonly pendingOperation: IntegrationRunOperation | null;
  readonly operationStatus: { readonly kind: "success" | "error"; readonly message: string } | null;
  readonly onSelect: (operation: IntegrationRunOperation) => void;
}) {
  return (
    <section aria-labelledby="run-controls-heading" className="rounded-xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="run-controls-heading" className="text-sm font-semibold">
            Run controls
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Available actions come from the server’s durable state and your connection scope.
          </p>
        </div>
        {confirmingState ? (
          <span role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
            Confirming state…
          </span>
        ) : null}
      </div>

      {controls.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2" aria-busy={pendingOperation !== null}>
          {controls.map((control) => (
            <Button
              key={control.operation}
              size="sm"
              variant={control.operation === "cancel" ? "destructive-outline" : "outline"}
              disabled={control.disabled}
              title={control.disabledReason ?? undefined}
              onClick={() => onSelect(control.operation)}
            >
              {pendingOperation === control.operation ? (
                <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
              ) : (
                <RunOperationIcon operation={control.operation} />
              )}
              {operationLabel(control.operation)}
            </Button>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No run operations are available for this state or connection scope.
        </p>
      )}

      {operationStatus ? (
        <p
          role={operationStatus.kind === "error" ? "alert" : "status"}
          className={
            operationStatus.kind === "error"
              ? "mt-4 text-sm text-destructive-foreground"
              : "mt-4 text-sm text-success-foreground"
          }
        >
          {operationStatus.message}
        </p>
      ) : null}
    </section>
  );
}

export function IntegrationRunReceipt({
  environmentId: rawEnvironmentId,
  runId,
}: {
  readonly environmentId: string;
  readonly runId: string;
}) {
  const environmentId = EnvironmentId.make(rawEnvironmentId);
  const navigate = useNavigate();
  const environment = useEnvironment(environmentId);
  const runQuery = useEnvironmentQuery(
    integrationEnvironment.inspectRun({ environmentId, input: { id: runId } }),
  );
  const inspection = runQuery.data;
  const run = inspection?.run ?? null;
  const shouldAutoRefresh = shouldAutoRefreshIntegrationRunReceipt({
    state: run?.state ?? null,
    isPending: runQuery.isPending,
    error: runQuery.error,
  });

  useEffect(() => {
    if (!shouldAutoRefresh) return;
    const timer = window.setInterval(runQuery.refresh, 1_000);
    return () => window.clearInterval(timer);
  }, [runQuery.refresh, shouldAutoRefresh]);
  const timeline = run ? deriveRunTimeline(run) : [];
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "run id" });
  const cancelRun = useAtomCommand(integrationEnvironment.cancelRun, { reportFailure: false });
  const resumeRun = useAtomCommand(integrationEnvironment.resumeRun, { reportFailure: false });
  const retryRun = useAtomCommand(integrationEnvironment.retryRun, { reportFailure: false });
  const retryRequestRef = useRef<ReturnType<typeof getOrCreateIntegrationRetryRequest> | null>(
    null,
  );
  const [confirmOperation, setConfirmOperation] = useState<IntegrationRunOperation | null>(null);
  const [pendingOperation, setPendingOperation] = useState<IntegrationRunOperation | null>(null);
  const [operationStatus, setOperationStatus] = useState<{
    readonly kind: "success" | "error";
    readonly message: string;
  } | null>(null);
  const connected = environment?.connection.phase === "connected";
  const controls = inspection
    ? deriveIntegrationRunControls({
        inspection,
        connected,
        queryPending: runQuery.isPending,
        pendingOperation,
      })
    : [];
  const confirmation =
    confirmOperation && run ? integrationRunOperationConfirmation(confirmOperation, run) : null;
  const confirmationAllowed =
    confirmOperation !== null &&
    inspection?.operations[confirmOperation].allowed === true &&
    connected &&
    !runQuery.isPending;

  const executeConfirmedOperation = async () => {
    if (!confirmOperation || !run || !confirmationAllowed || pendingOperation !== null) return;
    const operation = confirmOperation;
    setPendingOperation(operation);
    setOperationStatus(null);
    const result = await (async () => {
      if (operation === "cancel") {
        return cancelRun({ environmentId, input: { id: run.id } });
      }
      if (operation === "resume") {
        return resumeRun({
          environmentId,
          input: { id: run.id, approveCaps: run.state === "waiting" },
        });
      }
      const retryRequest = getOrCreateIntegrationRetryRequest(
        retryRequestRef.current,
        run.id,
        randomUUID(),
      );
      retryRequestRef.current = retryRequest;
      return retryRun({
        environmentId,
        input: { id: run.id, requestId: retryRequest.requestId },
      });
    })();

    if (result._tag === "Failure") {
      setOperationStatus({
        kind: "error",
        message: formatOperationFailure(operation, result.cause),
      });
      setConfirmOperation(null);
      setPendingOperation(null);
      runQuery.refresh();
      return;
    }

    if (operation === "retry") {
      retryRequestRef.current = null;
      setOperationStatus({
        kind: "success",
        message: "Retry created. Opening the linked attempt…",
      });
      setConfirmOperation(null);
      setPendingOperation(null);
      await navigate({
        to: "/runs/$environmentId/$runId",
        params: { environmentId, runId: result.value.run.id },
      });
      return;
    }

    setOperationStatus({
      kind: "success",
      message:
        operation === "cancel"
          ? `Cancellation completed with state: ${result.value.run.state}.`
          : "Resume accepted. The durable run is continuing from its existing journal.",
    });
    setConfirmOperation(null);
    setPendingOperation(null);
    runQuery.refresh();
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <main className="mx-auto max-w-3xl space-y-6 px-5 py-8 sm:px-8">
        <Button size="sm" variant="ghost" render={<Link to="/runs" />}>
          <ArrowLeftIcon /> Back to runs
        </Button>

        <header className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {run?.source === "loopany" ? "LoopAny" : "Monkey.D.Loopy"} run
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">Run receipt</h1>
            {run ? (
              <Badge variant={stateVariant(run.state)}>
                <RunStateIcon state={run.state} /> {run.state}
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <p className="break-all font-mono text-xs text-muted-foreground">{runId}</p>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Copy run id"
              onClick={() => copyToClipboard(runId, undefined)}
            >
              {isCopied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </div>
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
        ) : !run || !inspection ? (
          <section role="status" className="rounded-xl border p-4">
            <h2 className="font-medium">Run not found</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This environment does not have a durable record for this run id.
            </p>
          </section>
        ) : (
          <>
            {environment?.connection.phase !== "connected" ? (
              <section role="status" className="rounded-xl border border-warning/30 p-4">
                <h2 className="font-medium">Run controls are offline</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  The last inspected record remains visible. Controls stay disabled until this
                  environment reconnects and confirms the latest durable state.
                </p>
              </section>
            ) : null}

            <IntegrationRunControls
              controls={controls}
              confirmingState={runQuery.isPending}
              pendingOperation={pendingOperation}
              operationStatus={operationStatus}
              onSelect={(operation) => {
                setOperationStatus(null);
                setConfirmOperation(operation);
              }}
            />

            <section aria-labelledby="run-runtime-heading" className="rounded-xl border p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="run-runtime-heading" className="text-sm font-semibold">
                  Runtime inspection
                </h2>
                <Badge variant={inspection.runtime.live ? "success" : "secondary"}>
                  {inspection.runtime.live ? "live" : "durable only"} · {inspection.runtime.phase}
                </Badge>
              </div>
              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Agent calls started</dt>
                  <dd className="mt-1">{inspection.runtime.progress.agentCallsStarted}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Agent calls completed</dt>
                  <dd className="mt-1">{inspection.runtime.progress.agentCallsCompleted}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Active step</dt>
                  <dd className="mt-1">{inspection.runtime.progress.activeStep ?? "—"}</dd>
                </div>
              </dl>
              {inspection.runtime.diagnostics.length > 0 ? (
                <div className="mt-4">
                  <h3 className="text-xs font-medium text-muted-foreground">Runtime diagnostics</h3>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
                    {inspection.runtime.diagnostics.join("\n")}
                  </pre>
                </div>
              ) : null}
            </section>

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
              {!TERMINAL_INTEGRATION_RUN_STATES.has(run.state) ? (
                <p role="status" className="mt-4 text-xs text-muted-foreground">
                  This receipt refreshes automatically while the server owns the run.
                </p>
              ) : null}
            </section>

            <section aria-labelledby="run-timeline-heading" className="rounded-xl border p-5">
              <h2 id="run-timeline-heading" className="text-sm font-semibold">
                Lifecycle timeline
              </h2>
              <ol className="mt-4 space-y-4">
                {timeline.map((event) => (
                  <li
                    key={`${event.sequence}-${event.state}`}
                    className="grid grid-cols-[1rem_1fr] gap-3"
                  >
                    <span className="mt-1 size-2 rounded-full bg-primary" aria-hidden="true" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={stateVariant(event.state)}>{event.state}</Badge>
                        <time className="text-xs text-muted-foreground" dateTime={event.occurredAt}>
                          {formatTimestamp(event.occurredAt)}
                        </time>
                      </div>
                      <p className="mt-1 text-sm">{event.summary}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {run.verification ? (
              <section aria-labelledby="run-verification-heading" className="rounded-xl border p-5">
                <h2 id="run-verification-heading" className="text-sm font-semibold">
                  Verification summary
                </h2>
                <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Loop</dt>
                    <dd className="mt-1">{run.verification.name ?? "Unnamed"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Score</dt>
                    <dd className="mt-1">{run.verification.score ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Valid</dt>
                    <dd className="mt-1">{run.verification.valid ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Verified</dt>
                    <dd className="mt-1">{run.verification.verified ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Execution ready</dt>
                    <dd className="mt-1">{run.verification.executionReady ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Runtime versions</dt>
                    <dd className="mt-1 font-mono text-xs">
                      factory {run.verification.factoryVersion} · execution{" "}
                      {run.verification.executionVersion}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">Diagnostics</dt>
                    <dd className="mt-1">
                      {run.verification.errorCount} errors · {run.verification.warningCount}{" "}
                      warnings · {run.verification.infoCount} info
                    </dd>
                  </div>
                </dl>
              </section>
            ) : null}

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

            {run.journalRef || run.parentRunId ? (
              <section
                aria-label="Run metadata"
                className="space-y-1 break-all text-xs text-muted-foreground"
              >
                {run.journalRef ? (
                  <p>
                    Journal reference: <span className="font-mono">{run.journalRef}</span>
                  </p>
                ) : null}
                {run.parentRunId ? (
                  <p>
                    Parent run:{" "}
                    <Link
                      className="font-mono underline underline-offset-2"
                      to="/runs/$environmentId/$runId"
                      params={{ environmentId, runId: run.parentRunId }}
                    >
                      {run.parentRunId}
                    </Link>
                  </p>
                ) : null}
              </section>
            ) : null}
          </>
        )}

        <Dialog
          open={confirmOperation !== null}
          onOpenChange={(open) => {
            if (!open && pendingOperation === null) setConfirmOperation(null);
          }}
        >
          <DialogPopup className="max-w-md">
            <DialogHeader>
              <DialogTitle>{confirmation?.title ?? "Confirm run operation"}</DialogTitle>
              <DialogDescription>{confirmation?.description}</DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <p className="text-sm text-muted-foreground">{confirmation?.consequence}</p>
              {!confirmationAllowed && pendingOperation === null ? (
                <p role="alert" className="mt-3 text-sm text-destructive-foreground">
                  The action is no longer available in the latest server state. Close this dialog
                  and review the refreshed run.
                </p>
              ) : null}
            </DialogPanel>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={pendingOperation !== null}
                onClick={() => setConfirmOperation(null)}
              >
                Keep run
              </Button>
              <Button
                variant={confirmOperation === "cancel" ? "destructive" : "default"}
                disabled={!confirmationAllowed || pendingOperation !== null}
                onClick={() => void executeConfirmedOperation()}
              >
                {pendingOperation !== null ? (
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                ) : null}
                {confirmation?.confirmLabel ?? "Confirm"}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      </main>
    </div>
  );
}
