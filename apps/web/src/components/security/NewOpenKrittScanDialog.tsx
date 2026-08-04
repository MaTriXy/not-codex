import { useMemo, useState } from "react";
import type {
  OpenKrittFieldError,
  OpenKrittLaunchScanInput,
  OpenKrittScanConfiguration,
  OpenKrittScanLaunchResult,
  OpenKrittSourceIdentity,
  ProjectId,
} from "@notcodex/contracts";
import { LoaderCircleIcon, PlayIcon } from "lucide-react";

import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export interface NewOpenKrittScanDialogProps {
  readonly projectId: ProjectId;
  readonly repository: string | null;
  readonly defaultSource: OpenKrittSourceIdentity | null;
  readonly defaultConfiguration: OpenKrittScanConfiguration | null;
  readonly disabled?: boolean;
  /**
   * The dialog owns the request id so an elected launch-policy retry resubmits
   * the *same* id. That is what makes answering a `409` safe: the retry
   * reconciles to the original launch instead of creating a second paid scan.
   */
  readonly onLaunch: (
    input: Omit<OpenKrittLaunchScanInput, "projectId">,
  ) => Promise<OpenKrittScanLaunchResult>;
}

/** Which form control an upstream `422` field name belongs to. */
export function openKrittFieldControlId(field: string): string | null {
  switch (field) {
    case "commit_sha":
      return "open-kritt-commit-sha";
    case "workflow_id":
      return "open-kritt-workflow";
    case "provider_id":
      return "open-kritt-provider";
    case "model_id":
      return "open-kritt-model";
    case "job_limit":
      return "open-kritt-job-limit";
    case "scope":
      return "open-kritt-scope";
    default:
      return null;
  }
}

function fieldErrorFor(
  errors: ReadonlyArray<OpenKrittFieldError>,
  controlId: string,
): string | null {
  return (
    errors.find((error) => openKrittFieldControlId(error.field) === controlId)?.message ?? null
  );
}

/** Renders one upstream field error next to the control it belongs to. */
function FieldError({
  controlId,
  errors,
}: {
  readonly controlId: string;
  readonly errors: ReadonlyArray<OpenKrittFieldError>;
}) {
  const message = fieldErrorFor(errors, controlId);
  if (message === null) return null;
  return (
    <span id={`${controlId}-error`} role="alert" className="mt-1 block text-destructive-foreground">
      {message}
    </span>
  );
}

function newRequestId(): string {
  return randomUUID().replaceAll("-", "");
}

function isFullCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

function repositoryParts(
  repository: string | null,
): { readonly owner: string; readonly name: string } | null {
  if (repository === null) return null;
  const parts = repository
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  return parts.length === 2 ? { owner: parts[0]!, name: parts[1]! } : null;
}

export function buildOpenKrittRemoteSourceFromForm(input: {
  readonly repository: string | null;
  readonly commitSha: string;
  readonly defaultSource: OpenKrittSourceIdentity | null;
}): OpenKrittSourceIdentity | null {
  if (input.defaultSource !== null) return input.defaultSource;
  const parts = repositoryParts(input.repository);
  const commitSha = input.commitSha.trim().toLowerCase();
  if (parts === null || !isFullCommitSha(commitSha)) return null;
  return {
    kind: "remote",
    repoFull: `${parts.owner}/${parts.name}`,
    commitSha,
  };
}

function configurationFromForm(input: {
  readonly defaultConfiguration: OpenKrittScanConfiguration | null;
  readonly workflowId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly scope: string;
  readonly jobLimit: number;
}): OpenKrittScanConfiguration | null {
  const defaults = input.defaultConfiguration;
  const workflowId = input.workflowId.trim();
  const providerId = input.providerId.trim();
  const modelId = input.modelId.trim();
  if (workflowId.length === 0 || providerId.length === 0 || modelId.length === 0) return null;
  return {
    workflowId,
    postScriptIds: defaults?.postScriptIds ?? [],
    agentSkillIds: defaults?.agentSkillIds ?? [],
    severityRankerId: defaults?.severityRankerId ?? null,
    providerId,
    modelId,
    thinkingEffort: defaults?.thinkingEffort ?? "high",
    jobLimit: Math.max(1, Math.min(64, Math.trunc(input.jobLimit))),
    ...(input.scope.trim().length === 0 ? {} : { scope: input.scope.trim() }),
  };
}

export function NewOpenKrittScanDialog({
  projectId,
  repository,
  defaultSource,
  defaultConfiguration,
  disabled = false,
  onLaunch,
}: NewOpenKrittScanDialogProps) {
  const [open, setOpen] = useState(false);
  const [commitSha, setCommitSha] = useState(
    defaultSource?.kind === "remote" ? defaultSource.commitSha : "",
  );
  const [workflowId, setWorkflowId] = useState(defaultConfiguration?.workflowId ?? "");
  const [providerId, setProviderId] = useState(defaultConfiguration?.providerId ?? "");
  const [modelId, setModelId] = useState(defaultConfiguration?.modelId ?? "");
  const [scope, setScope] = useState(defaultConfiguration?.scope ?? "");
  const [jobLimit, setJobLimit] = useState(defaultConfiguration?.jobLimit ?? 1);
  const [notice, setNotice] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [requestId, setRequestId] = useState(newRequestId);
  const [policyChoices, setPolicyChoices] = useState<ReadonlyArray<string>>([]);
  const [fieldErrors, setFieldErrors] = useState<ReadonlyArray<OpenKrittFieldError>>([]);
  const source = useMemo(
    () => buildOpenKrittRemoteSourceFromForm({ repository, commitSha, defaultSource }),
    [commitSha, defaultSource, repository],
  );

  const launch = async (launchPolicy?: string) => {
    const configuration = configurationFromForm({
      defaultConfiguration,
      workflowId,
      providerId,
      modelId,
      scope,
      jobLimit,
    });
    if (source === null || configuration === null) {
      setNotice(
        "Choose a full 40-character commit SHA and the catalog workflow/provider/model values.",
      );
      return;
    }
    setLaunching(true);
    setNotice(null);
    try {
      const result = await onLaunch({
        source,
        configuration,
        requestId,
        ...(launchPolicy === undefined ? {} : { launchPolicy }),
      });
      setPolicyChoices(result.launchResolution === "policy-required" ? result.policyChoices : []);
      setFieldErrors(result.launchResolution === "rejected" ? result.fieldErrors : []);
      if (result.launchResolution === "policy-required") {
        setNotice(
          "Open Kritt already has work in flight and needs an explicit choice before starting this scan.",
        );
        return;
      }
      if (result.launchResolution === "rejected") {
        setNotice("Open Kritt rejected this configuration. Correct the highlighted fields.");
        return;
      }
      // Only a resolved launch retires the request id; anything still pending
      // must keep it so a follow-up cannot duplicate the scan.
      setRequestId(newRequestId());
      setOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Open Kritt scan launch failed.");
    } finally {
      setLaunching(false);
    }
  };

  return (
    <section aria-labelledby="new-open-kritt-scan-heading" className="rounded-xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3" data-project-id={projectId}>
        <div>
          <h2 id="new-open-kritt-scan-heading" className="text-sm font-semibold">
            New Open Kritt scan
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Scans use a full immutable commit. Uncommitted and unpushed local changes are excluded.
          </p>
        </div>
        <Button size="sm" disabled={disabled} onClick={() => setOpen((value) => !value)}>
          <PlayIcon /> {open ? "Close" : "Prepare scan"}
        </Button>
      </div>
      {open ? (
        <div className="mt-4 space-y-4 border-t pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium">
              Repository
              <Input
                className="mt-1"
                value={repository ?? "Unknown repository"}
                readOnly
                aria-label="Open Kritt repository"
              />
            </label>
            <label className="text-xs font-medium">
              Full commit SHA
              <Input
                className="mt-1 font-mono text-xs"
                value={commitSha}
                onChange={(event) => setCommitSha(event.currentTarget.value)}
                placeholder="40 hexadecimal characters"
                id="open-kritt-commit-sha"
                aria-label="Open Kritt commit SHA"
                aria-invalid={fieldErrorFor(fieldErrors, "open-kritt-commit-sha") !== null}
                aria-errormessage={"open-kritt-commit-sha-error"}
                disabled={defaultSource?.kind === "remote"}
              />
              <FieldError controlId="open-kritt-commit-sha" errors={fieldErrors} />
            </label>
            <label className="text-xs font-medium">
              Workflow ID
              <Input
                className="mt-1"
                value={workflowId}
                onChange={(event) => setWorkflowId(event.currentTarget.value)}
                id="open-kritt-workflow"
                aria-label="Open Kritt workflow"
                aria-invalid={fieldErrorFor(fieldErrors, "open-kritt-workflow") !== null}
                aria-errormessage={"open-kritt-workflow-error"}
              />
              <FieldError controlId="open-kritt-workflow" errors={fieldErrors} />
            </label>
            <label className="text-xs font-medium">
              Provider ID
              <Input
                className="mt-1"
                value={providerId}
                onChange={(event) => setProviderId(event.currentTarget.value)}
                id="open-kritt-provider"
                aria-label="Open Kritt provider"
                aria-invalid={fieldErrorFor(fieldErrors, "open-kritt-provider") !== null}
                aria-errormessage={"open-kritt-provider-error"}
              />
              <FieldError controlId="open-kritt-provider" errors={fieldErrors} />
            </label>
            <label className="text-xs font-medium">
              Model ID
              <Input
                className="mt-1"
                value={modelId}
                onChange={(event) => setModelId(event.currentTarget.value)}
                id="open-kritt-model"
                aria-label="Open Kritt model"
                aria-invalid={fieldErrorFor(fieldErrors, "open-kritt-model") !== null}
                aria-errormessage={"open-kritt-model-error"}
              />
              <FieldError controlId="open-kritt-model" errors={fieldErrors} />
            </label>
            <label className="text-xs font-medium">
              Job limit
              <Input
                className="mt-1"
                type="number"
                min={1}
                max={64}
                value={jobLimit}
                onChange={(event) => setJobLimit(Number(event.currentTarget.value))}
                id="open-kritt-job-limit"
                aria-label="Open Kritt job limit"
                aria-invalid={fieldErrorFor(fieldErrors, "open-kritt-job-limit") !== null}
                aria-errormessage={"open-kritt-job-limit-error"}
              />
              <FieldError controlId="open-kritt-job-limit" errors={fieldErrors} />
            </label>
          </div>
          <label className="block text-xs font-medium">
            Scope (optional)
            <Input
              className="mt-1"
              value={scope}
              onChange={(event) => setScope(event.currentTarget.value)}
              id="open-kritt-scope"
              aria-label="Open Kritt scan scope"
              aria-invalid={fieldErrorFor(fieldErrors, "open-kritt-scope") !== null}
              aria-errormessage={"open-kritt-scope-error"}
              placeholder="Optional bounded scope"
            />
            <FieldError controlId="open-kritt-scope" errors={fieldErrors} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void launch()} disabled={launching || source === null}>
              {launching ? (
                <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
              ) : (
                <PlayIcon />
              )}
              {launching ? "Launching…" : "Launch scan"}
            </Button>
            {source === null ? (
              <span className="text-xs text-muted-foreground">
                A verified full SHA is required.
              </span>
            ) : null}
            {notice ? (
              <span role="alert" className="text-xs text-destructive-foreground">
                {notice}
              </span>
            ) : null}
          </div>
          {policyChoices.length > 0 ? (
            <section
              aria-labelledby="open-kritt-launch-policy-heading"
              className="rounded-lg border border-warning/40 bg-warning/8 p-3"
            >
              <h3 id="open-kritt-launch-policy-heading" className="text-xs font-semibold">
                Choose how to proceed
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Open Kritt will not start this scan until you answer. Each option may start
                additional paid work; Not Codex will not choose for you. Answering keeps the same
                launch request, so no duplicate scan is created.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {policyChoices.map((choice) => (
                  <Button
                    key={choice}
                    size="xs"
                    variant="outline"
                    disabled={launching}
                    onClick={() => void launch(choice)}
                  >
                    {choice}
                  </Button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
