import { useEffect, useMemo, useRef, useState } from "react";
import type {
  OpenKrittCatalog,
  OpenKrittCatalogItem,
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
  /** Undefined while run history is loading; null once no unresolved launch exists. */
  readonly unresolvedRunId?: string | null;
  /**
   * Loads the installation catalog the first time the form is opened. The
   * post-script and severity-ranker selections are *required* by
   * `POST /api/scans`, and the settings page only carries workflow/provider/model
   * defaults, so the catalog is what makes those selections answerable here
   * instead of failing at launch.
   */
  readonly onLoadCatalog?: () => Promise<OpenKrittCatalog | null>;
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
    case "post_script_id":
    case "post_script_ids":
      return "open-kritt-post-scripts";
    case "severity_ranker":
      return "open-kritt-severity-ranker";
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

/** Catalog-backed id suggestions for a required selection. */
function CatalogOptions({
  id,
  items,
}: {
  readonly id: string;
  readonly items: ReadonlyArray<OpenKrittCatalogItem> | undefined;
}) {
  if (items === undefined || items.length === 0) return null;
  return (
    <datalist id={id}>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </datalist>
  );
}

function newRequestId(): string {
  return randomUUID().replaceAll("-", "");
}

interface PersistedOpenKrittLaunch {
  readonly requestId: string;
  readonly source: OpenKrittSourceIdentity;
  readonly configuration: OpenKrittScanConfiguration;
  readonly resolution: "unknown" | "policy-required";
  readonly policyChoices: ReadonlyArray<string>;
}

function pendingLaunchStorageKey(projectId: ProjectId): string {
  return `notcodex:open-kritt:pending-launch:${projectId}`;
}

function readPendingLaunch(projectId: ProjectId): PersistedOpenKrittLaunch | null {
  try {
    const value = localStorage.getItem(pendingLaunchStorageKey(projectId));
    if (value === null) return null;
    const parsed = JSON.parse(value) as Partial<PersistedOpenKrittLaunch>;
    if (
      typeof parsed.requestId !== "string" ||
      parsed.source === undefined ||
      parsed.configuration === undefined ||
      (parsed.resolution !== "unknown" && parsed.resolution !== "policy-required") ||
      !Array.isArray(parsed.policyChoices)
    )
      return null;
    return parsed as PersistedOpenKrittLaunch;
  } catch {
    return null;
  }
}

function writePendingLaunch(projectId: ProjectId, launch: PersistedOpenKrittLaunch | null): void {
  try {
    const key = pendingLaunchStorageKey(projectId);
    if (launch === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(launch));
  } catch {
    // Storage can be unavailable in hardened browsers. The server-side run
    // still blocks a duplicate launch even when this client cannot resume it.
  }
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

/** Splits the comma/whitespace separated post-script id entry into bounded ids. */
function parseOpenKrittIdList(value: string): ReadonlyArray<string> {
  const seen = new Set<string>();
  for (const raw of value.split(/[\s,]+/)) {
    const id = raw.trim();
    if (id.length > 0) seen.add(id);
  }
  return [...seen].slice(0, 20);
}

function configurationFromForm(input: {
  readonly defaultConfiguration: OpenKrittScanConfiguration | null;
  readonly workflowId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly postScriptIds: string;
  readonly severityRankerId: string;
  readonly scope: string;
  readonly jobLimit: number;
}): OpenKrittScanConfiguration | null {
  const defaults = input.defaultConfiguration;
  const workflowId = input.workflowId.trim();
  const providerId = input.providerId.trim();
  const modelId = input.modelId.trim();
  if (workflowId.length === 0 || providerId.length === 0 || modelId.length === 0) return null;
  // Upstream `POST /api/scans` refuses a launch without a primary post-script and
  // without the severity-ranker ruleset the server resolves from this id, so an
  // unanswered selection has to block the launch here rather than fail remotely.
  const postScriptIds = parseOpenKrittIdList(input.postScriptIds);
  const severityRankerId = input.severityRankerId.trim();
  if (postScriptIds.length === 0 || severityRankerId.length === 0) return null;
  return {
    workflowId,
    postScriptIds,
    agentSkillIds: defaults?.agentSkillIds ?? [],
    severityRankerId,
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
  unresolvedRunId,
  onLoadCatalog,
  onLaunch,
}: NewOpenKrittScanDialogProps) {
  const [open, setOpen] = useState(false);
  const [commitSha, setCommitSha] = useState(
    defaultSource?.kind === "remote" ? defaultSource.commitSha : "",
  );
  const [workflowId, setWorkflowId] = useState(defaultConfiguration?.workflowId ?? "");
  const [providerId, setProviderId] = useState(defaultConfiguration?.providerId ?? "");
  const [modelId, setModelId] = useState(defaultConfiguration?.modelId ?? "");
  const [postScriptIds, setPostScriptIds] = useState(
    (defaultConfiguration?.postScriptIds ?? []).join(", "),
  );
  const [severityRankerId, setSeverityRankerId] = useState(
    defaultConfiguration?.severityRankerId ?? "",
  );
  const [catalog, setCatalog] = useState<OpenKrittCatalog | null>(null);
  const [scope, setScope] = useState(defaultConfiguration?.scope ?? "");
  const [jobLimit, setJobLimit] = useState(defaultConfiguration?.jobLimit ?? 1);
  const [notice, setNotice] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [requestId, setRequestId] = useState(newRequestId);
  const [unknownPending, setUnknownPending] = useState(false);
  const [policyChoices, setPolicyChoices] = useState<ReadonlyArray<string>>([]);
  const [fieldErrors, setFieldErrors] = useState<ReadonlyArray<OpenKrittFieldError>>([]);
  const [unresolvedWithoutPayload, setUnresolvedWithoutPayload] = useState(false);
  const pendingLaunch = useRef<{
    readonly source: OpenKrittSourceIdentity;
    readonly configuration: OpenKrittScanConfiguration;
  } | null>(null);
  const source = useMemo(
    () => buildOpenKrittRemoteSourceFromForm({ repository, commitSha, defaultSource }),
    [commitSha, defaultSource, repository],
  );
  const configuration = useMemo(
    () =>
      configurationFromForm({
        defaultConfiguration,
        workflowId,
        providerId,
        modelId,
        postScriptIds,
        severityRankerId,
        scope,
        jobLimit,
      }),
    [
      defaultConfiguration,
      jobLimit,
      modelId,
      postScriptIds,
      providerId,
      scope,
      severityRankerId,
      workflowId,
    ],
  );

  useEffect(() => {
    if (unresolvedRunId === undefined) return;
    if (unresolvedRunId === null) {
      writePendingLaunch(projectId, null);
      setUnresolvedWithoutPayload(false);
      return;
    }
    const persisted = readPendingLaunch(projectId);
    if (persisted === null || `open-kritt-${persisted.requestId}` !== unresolvedRunId) {
      setUnresolvedWithoutPayload(true);
      setNotice(
        "An unresolved launch already exists for this project. Wait for reconciliation before starting another scan.",
      );
      return;
    }
    pendingLaunch.current = {
      source: persisted.source,
      configuration: persisted.configuration,
    };
    setRequestId(persisted.requestId);
    setUnknownPending(persisted.resolution === "unknown");
    setPolicyChoices(persisted.resolution === "policy-required" ? persisted.policyChoices : []);
    setUnresolvedWithoutPayload(false);
    setOpen(true);
    setNotice(
      persisted.resolution === "unknown"
        ? "Launch is uncertain. Check the same request before trying anything else."
        : "Open Kritt needs an explicit choice for the existing launch request.",
    );
  }, [projectId, unresolvedRunId]);

  // One attempt per mounted dialog. The parent passes a fresh callback identity
  // on every render, so without this latch an unloaded catalog would re-issue an
  // upstream request on each re-render instead of staying bounded.
  const catalogRequested = useRef(false);
  useEffect(() => {
    if (!open || catalogRequested.current || onLoadCatalog === undefined) return;
    catalogRequested.current = true;
    let cancelled = false;
    void onLoadCatalog().then(
      (loaded) => {
        if (!cancelled && loaded !== null) setCatalog(loaded);
      },
      // A catalog that cannot be loaded only costs the id suggestions; the
      // required selections stay answerable by typing the ids directly.
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [onLoadCatalog, open]);

  const launch = async (launchPolicy?: string) => {
    const selected =
      pendingLaunch.current ??
      (source === null || configuration === null ? null : { source, configuration });
    if (selected === null) {
      setNotice(
        "Choose a full 40-character commit SHA, the catalog workflow/provider/model values, at least one post-script, and a severity ranker.",
      );
      return;
    }
    // The request id and its exact payload are one idempotent launch. Form
    // edits made while reconciliation or a 409 answer is pending apply only to
    // a later request; they must not mutate the paid operation behind this id.
    pendingLaunch.current = selected;
    // Persist before crossing the RPC boundary. If the tab reloads or the
    // socket disconnects after the server records an unresolved launch but
    // before this promise settles, the same request id and immutable payload
    // must already be recoverable. `unknown` is the safe provisional state:
    // retrying it only asks the server to reconcile this id.
    writePendingLaunch(projectId, {
      requestId,
      source: selected.source,
      configuration: selected.configuration,
      resolution: "unknown",
      policyChoices: [],
    });
    setLaunching(true);
    setNotice(null);
    try {
      const result = await onLaunch({
        source: selected.source,
        configuration: selected.configuration,
        requestId,
        ...(launchPolicy === undefined ? {} : { launchPolicy }),
      });
      setPolicyChoices(result.launchResolution === "policy-required" ? result.policyChoices : []);
      setFieldErrors(result.launchResolution === "rejected" ? result.fieldErrors : []);
      if (result.launchResolution === "unknown") {
        // The POST may already have started paid work. Keep the marker and the
        // form open; the only safe follow-up is a status check using this exact
        // id, which the server reconciles without issuing another POST.
        setUnknownPending(true);
        writePendingLaunch(projectId, {
          requestId,
          source: selected.source,
          configuration: selected.configuration,
          resolution: "unknown",
          policyChoices: [],
        });
        setNotice("Launch is uncertain. Check the same request before trying anything else.");
        return;
      }
      if (result.launchResolution === "policy-required") {
        setUnknownPending(false);
        writePendingLaunch(projectId, {
          requestId,
          source: selected.source,
          configuration: selected.configuration,
          resolution: "policy-required",
          policyChoices: result.policyChoices,
        });
        setNotice(
          "Open Kritt already has work in flight and needs an explicit choice before starting this scan.",
        );
        return;
      }
      if (result.launchResolution === "rejected") {
        setUnknownPending(false);
        pendingLaunch.current = null;
        writePendingLaunch(projectId, null);
        // Rejection is authoritative: no upstream scan exists, so corrected
        // input must use a fresh launch identity rather than retrying a terminal
        // request id.
        setRequestId(newRequestId());
        setNotice("Open Kritt rejected this configuration. Correct the highlighted fields.");
        return;
      }
      // Only a resolved launch retires the request id; anything still pending
      // must keep it so a follow-up cannot duplicate the scan.
      setRequestId(newRequestId());
      setUnknownPending(false);
      pendingLaunch.current = null;
      writePendingLaunch(projectId, null);
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
        <Button
          size="sm"
          disabled={disabled || unresolvedWithoutPayload}
          onClick={() => setOpen((value) => !value)}
        >
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
              Post-script IDs
              <Input
                className="mt-1"
                value={postScriptIds}
                onChange={(event) => setPostScriptIds(event.currentTarget.value)}
                id="open-kritt-post-scripts"
                list="open-kritt-post-script-options"
                aria-label="Open Kritt post-scripts"
                aria-invalid={fieldErrorFor(fieldErrors, "open-kritt-post-scripts") !== null}
                aria-errormessage={"open-kritt-post-scripts-error"}
                placeholder="At least one post-script ID"
              />
              <CatalogOptions id="open-kritt-post-script-options" items={catalog?.postScripts} />
              <FieldError controlId="open-kritt-post-scripts" errors={fieldErrors} />
            </label>
            <label className="text-xs font-medium">
              Severity ranker ID
              <Input
                className="mt-1"
                value={severityRankerId}
                onChange={(event) => setSeverityRankerId(event.currentTarget.value)}
                id="open-kritt-severity-ranker"
                list="open-kritt-severity-ranker-options"
                aria-label="Open Kritt severity ranker"
                aria-invalid={fieldErrorFor(fieldErrors, "open-kritt-severity-ranker") !== null}
                aria-errormessage={"open-kritt-severity-ranker-error"}
                placeholder="Required ranking ruleset"
              />
              <CatalogOptions
                id="open-kritt-severity-ranker-options"
                items={catalog?.severityRankers}
              />
              <FieldError controlId="open-kritt-severity-ranker" errors={fieldErrors} />
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
            <Button
              size="sm"
              onClick={() => void launch()}
              disabled={
                launching ||
                unknownPending ||
                unresolvedWithoutPayload ||
                source === null ||
                configuration === null
              }
            >
              {launching ? (
                <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
              ) : (
                <PlayIcon />
              )}
              {launching ? "Launching…" : "Launch scan"}
            </Button>
            {unknownPending ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void launch()}
                disabled={launching}
              >
                {launching ? (
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                ) : null}
                {launching ? "Checking…" : "Check launch status"}
              </Button>
            ) : null}
            {source === null ? (
              <span className="text-xs text-muted-foreground">
                A verified full SHA is required.
              </span>
            ) : null}
            {source !== null && configuration === null ? (
              <span className="text-xs text-muted-foreground">
                A workflow, provider, model, at least one post-script, and a severity ranker are
                required.
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
