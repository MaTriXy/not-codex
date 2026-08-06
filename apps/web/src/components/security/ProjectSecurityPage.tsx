import { useMemo, useState, type ReactNode } from "react";
import type {
  EnvironmentId,
  IntegrationDescriptor,
  IntegrationRun,
  ModelSelection,
  OpenKrittCatalog,
  OpenKrittFinding,
  OpenKrittLaunchScanInput,
  OpenKrittScanConfiguration,
  OpenKrittScanLaunchResult,
  OpenKrittSnapshotPreviewResult,
  OpenKrittSourceIdentity,
  ProjectId,
} from "@notcodex/contracts";
import * as Cause from "effect/Cause";
import { Link } from "@tanstack/react-router";
import {
  CircleAlertIcon,
  HistoryIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { integrationEnvironment } from "../../state/integrations";
import { useProject } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { usePrimarySettings } from "../../hooks/useSettings";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { FindingRemediationButton } from "./FindingRemediationButton";
import { LocalSnapshotConfirmation } from "./LocalSnapshotConfirmation";
import { NewOpenKrittScanDialog } from "./NewOpenKrittScanDialog";
import { RescanButton } from "./RescanButton";
import { ScanComparisonPanel } from "./ScanComparisonPanel";
import { SecurityFindingDetail } from "./SecurityFindingDetail";
import { SecurityFindingMarkdown } from "./SecurityFindingMarkdown";

export type ProjectSecurityConnectorState = "disabled" | "misconfigured" | "ready" | "error";

export function deriveProjectSecurityEmptyState(input: {
  readonly connectorState: ProjectSecurityConnectorState;
  readonly projectId: string;
}): {
  readonly kind: "not-configured" | "unavailable";
  readonly message: string;
  readonly canLaunch: boolean;
} {
  if (input.connectorState === "disabled" || input.connectorState === "misconfigured") {
    return {
      kind: "not-configured",
      message: "Connect and test Open Kritt in Integrations before launching a project scan.",
      canLaunch: false,
    };
  }
  return {
    kind: "unavailable",
    message: "Open Kritt findings are not currently available for this project.",
    canLaunch: input.connectorState === "ready",
  };
}

export function formatSecuritySourceIdentity(input: {
  readonly repoFull: string;
  readonly commitSha: string;
  readonly dirty: boolean;
  readonly unpushed: boolean;
}) {
  return {
    label: `${input.repoFull} @ ${input.commitSha.slice(0, 8)}`,
    warnings: [
      ...(input.dirty ? ["Uncommitted local changes are excluded from this scan."] : []),
      ...(input.unpushed ? ["Unpushed commits are not visible to the remote scan."] : []),
    ],
  } as const;
}

export function buildSecurityFindingRows(input: {
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly canonical: boolean;
    readonly duplicateOf: string | null;
    readonly severity: string;
    /** Null until Open Kritt's ranking pass has ordered the finding. */
    readonly rank: number | null;
    readonly type: string;
    readonly path: string;
    readonly line: number | null;
    readonly summary: string;
    readonly exploitability: string;
    readonly triage: string;
  }>;
  readonly includeDuplicates: boolean;
}) {
  return input.items
    .filter((finding) => input.includeDuplicates || finding.canonical)
    .map((finding) => ({
      id: finding.id,
      severityLabel:
        finding.rank === null
          ? `${finding.severity} (unranked)`
          : `${finding.severity} (rank ${finding.rank})`,
      locationLabel: finding.line === null ? finding.path : `${finding.path}:${finding.line}`,
      type: finding.type,
      summary: finding.summary,
      exploitability: finding.exploitability,
      triage: finding.triage,
      canonical: finding.canonical,
      duplicateOf: finding.duplicateOf,
    }));
}

export function extractOpenKrittExternalScanId(summary: string | null): string | null {
  if (summary === null || !summary.startsWith("external-scan:")) return null;
  const id = summary.slice("external-scan:".length).split("\n", 1)[0]?.trim() ?? "";
  return /^[A-Za-z0-9_.:-]{1,256}$/.test(id) ? id : null;
}

export function securityRunStateLabel(
  run: Pick<IntegrationRun, "state" | "outputSummary">,
): string {
  const upstream =
    run.outputSummary?.split("\n", 2)[1]?.replace(/^Open Kritt status:\s*/i, "") ?? null;
  if (upstream !== null && upstream.length > 0) return `${run.state} · ${upstream}`;
  return run.state;
}

/**
 * Every launch outcome is reported plainly. `policy-required` and `rejected`
 * are questions the user has to answer, not failures, and neither may read as
 * "the scan started".
 */
export function securityLaunchNotice(
  launchResolution: OpenKrittScanLaunchResult["launchResolution"],
): string {
  switch (launchResolution) {
    case "unknown":
      return "Launch is uncertain and will be reconciled by the server before another POST.";
    case "policy-required":
      return "Open Kritt needs an explicit launch-policy choice before this scan can start.";
    case "rejected":
      return "Open Kritt rejected the scan configuration. Correct the reported fields and launch again.";
    default:
      return "Scan queued.";
  }
}

export function deriveProjectSecurityStaleness(input: {
  readonly connectionPhase: string;
  readonly lastUpdatedAt: string | null;
}) {
  const stale = input.connectionPhase !== "connected";
  return { stale, readOnly: stale } as const;
}

export function securityComparisonLabel(
  value: "not-reproduced" | "still-present" | "uncertain" | "proven-fixed",
): string {
  switch (value) {
    case "not-reproduced":
      return "Not reproduced; absence is not proof of a fix.";
    case "still-present":
      return "Still present in the new scan.";
    case "uncertain":
      return "Uncertain; not proven fixed. See the stated reason.";
    case "proven-fixed":
      return "Proven fixed under the same source and configuration.";
  }
}

/**
 * Chooses the two scans a comparison should span: the newest scan and the most
 * recent earlier scan for the same project. Returns null when there is nothing
 * to compare, so the UI never offers a self-comparison.
 */
export function deriveScanComparisonPair(
  runs: ReadonlyArray<Pick<IntegrationRun, "outputSummary">>,
): { readonly currentScanId: string; readonly priorScanId: string } | null {
  const scanIds: Array<string> = [];
  for (const run of runs) {
    const id = extractOpenKrittExternalScanId(run.outputSummary ?? null);
    if (id !== null && !scanIds.includes(id)) scanIds.push(id);
  }
  const [currentScanId, priorScanId] = scanIds;
  if (currentScanId === undefined || priorScanId === undefined) return null;
  return { currentScanId, priorScanId };
}

/**
 * Resolves the immutable source a rescan should target. A freshly reviewed local
 * snapshot wins; otherwise the operator must supply a full 40-hex commit SHA,
 * which the server independently verifies. Anything else yields null so the
 * rescan control refuses to launch.
 */
export function deriveRescanSource(input: {
  readonly localSnapshotSource: OpenKrittSourceIdentity | null;
  readonly repository: string | null;
  readonly commitSha: string;
}): OpenKrittSourceIdentity | null {
  if (input.localSnapshotSource !== null) return input.localSnapshotSource;
  const commitSha = input.commitSha.trim().toLowerCase();
  if (input.repository === null || !/^[0-9a-f]{40}$/.test(commitSha)) return null;
  return { kind: "remote", repoFull: input.repository, commitSha };
}

/** A rescan may only be launched from a scan that reached a terminal state. */
export function canRescanFromRun(run: Pick<IntegrationRun, "state">): boolean {
  return run.state === "succeeded" || run.state === "failed" || run.state === "cancelled";
}

function commandFailureMessage(result: { readonly cause: Cause.Cause<unknown> }): string {
  const error = Cause.squash(result.cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The Open Kritt request failed.";
}

function connectorStateForDescriptor(
  descriptor: IntegrationDescriptor | null,
): ProjectSecurityConnectorState {
  if (descriptor === null || descriptor.state === "disabled") return "disabled";
  if (descriptor.state === "ready") return "ready";
  if (descriptor.state === "connecting") return "misconfigured";
  return "error";
}

function sourceRepository(project: ReturnType<typeof useProject>): string | null {
  const identity = project?.repositoryIdentity;
  if (!identity) return null;
  return (
    identity.displayName ??
    (identity.owner && identity.name ? `${identity.owner}/${identity.name}` : null)
  );
}

function timestamp(value: string | null): string {
  if (value === null) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function runVariant(state: IntegrationRun["state"]): "success" | "error" | "warning" | "secondary" {
  if (state === "succeeded") return "success";
  if (state === "failed" || state === "cancelled") return "error";
  if (state === "waiting") return "warning";
  return "secondary";
}

function FindingRow({
  finding,
  environmentId,
  projectId,
  scanId,
  modelSelection,
  readOnly,
}: {
  readonly finding: OpenKrittFinding;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly scanId: string;
  readonly modelSelection: ModelSelection | null;
  readonly readOnly: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // The bounded detail (explanation, trigger flow, PoC input, upstream link) is
  // fetched only on demand so opening the table does not request every record.
  const detailQuery = useEnvironmentQuery(
    expanded
      ? integrationEnvironment.getOpenKrittFinding({
          environmentId,
          input: { scanId, findingId: finding.id },
        })
      : null,
  );
  const row = buildSecurityFindingRows({
    includeDuplicates: true,
    items: [
      {
        id: finding.id,
        canonical: finding.canonical,
        duplicateOf: finding.duplicateOf,
        severity: finding.severity,
        rank: finding.rank,
        type: finding.type,
        path: finding.location.path,
        line: finding.location.line,
        summary: finding.summary,
        exploitability: finding.exploitability,
        triage: finding.triage,
      },
    ],
  })[0]!;
  return (
    <tr className="border-t align-top">
      <td className="px-3 py-3">
        <Badge
          variant={
            finding.severity === "critical" || finding.severity === "high" ? "error" : "warning"
          }
        >
          {row.severityLabel}
        </Badge>
      </td>
      <td className="px-3 py-3 font-mono text-xs">{row.locationLabel}</td>
      <td className="px-3 py-3">
        <p className="font-medium">{row.type}</p>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{row.summary}</p>
        <button
          type="button"
          className="mt-2 text-xs font-medium text-primary underline-offset-2 hover:underline"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide bounded detail" : "Show bounded detail"}
        </button>
        {expanded ? (
          <div className="mt-3 max-w-2xl space-y-2">
            {detailQuery.isPending && (detailQuery.data ?? null) === null ? (
              <p role="status" className="text-xs text-muted-foreground">
                Loading bounded finding detail…
              </p>
            ) : null}
            {detailQuery.error ? (
              <p role="alert" className="text-xs text-destructive-foreground">
                {detailQuery.error}
              </p>
            ) : null}
            {(detailQuery.data ?? null) === null ? (
              // Fall back to the bounded list row so a disconnected environment
              // still shows the evidence it already has.
              <div className="rounded-lg bg-muted/30 p-3 text-sm">
                <SecurityFindingMarkdown value={finding.explanation} />
              </div>
            ) : (
              <SecurityFindingDetail detail={detailQuery.data!} />
            )}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-3 text-sm">
        {row.exploitability}
        <br />
        <span className="text-xs text-muted-foreground">{row.triage}</span>
      </td>
      <td className="px-3 py-3 text-right">
        <FindingRemediationButton
          environmentId={environmentId}
          projectId={projectId}
          scanId={scanId}
          finding={finding}
          modelSelection={modelSelection}
          disabled={readOnly}
        />
      </td>
    </tr>
  );
}

export function ProjectSecurityPage({
  children,
  environmentId = null,
  projectId = null,
}: {
  readonly children?: ReactNode;
  readonly environmentId?: EnvironmentId | null;
  readonly projectId?: ProjectId | null;
}) {
  const environment = useEnvironment(environmentId);
  const project = useProject(
    environmentId === null || projectId === null ? null : { environmentId, projectId },
  );
  const integrationsQuery = useEnvironmentQuery(
    environmentId === null ? null : integrationEnvironment.list({ environmentId, input: null }),
  );
  const runPageKey = `${environmentId ?? "none"}:${projectId ?? "none"}`;
  const [runPaging, setRunPaging] = useState<{
    readonly key: string;
    readonly cursor: { readonly createdAt: string; readonly id: string } | null;
    readonly runs: ReadonlyArray<IntegrationRun>;
  }>({ key: runPageKey, cursor: null, runs: [] });
  const activeRunPaging =
    runPaging.key === runPageKey
      ? runPaging
      : { key: runPageKey, cursor: null, runs: [] as ReadonlyArray<IntegrationRun> };
  const runsQuery = useEnvironmentQuery(
    environmentId === null || projectId === null
      ? null
      : integrationEnvironment.listOpenKrittRuns({
          environmentId,
          input: {
            projectId,
            limit: 50,
            ...(activeRunPaging.cursor === null ? {} : { cursor: activeRunPaging.cursor }),
          },
        }),
  );
  const runs = useMemo(() => {
    const byId = new Map<string, IntegrationRun>();
    for (const run of activeRunPaging.runs) byId.set(run.id, run);
    for (const run of runsQuery.data?.runs ?? []) byId.set(run.id, run);
    return [...byId.values()];
  }, [activeRunPaging.runs, runsQuery.data?.runs]);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const activeRun =
    runs.find((run) => !["succeeded", "failed", "cancelled"].includes(run.state)) ??
    runs[0] ??
    null;
  const retainedScanIds = runs.flatMap((run) => {
    const retainedScanId = extractOpenKrittExternalScanId(run.outputSummary);
    return retainedScanId === null ? [] : [retainedScanId];
  });
  const scanId =
    selectedScanId !== null && retainedScanIds.includes(selectedScanId)
      ? selectedScanId
      : (retainedScanIds[0] ?? null);
  const findingPageKey = scanId ?? "none";
  const [findingPaging, setFindingPaging] = useState<{
    readonly key: string;
    readonly cursor: string | null;
    readonly items: ReadonlyArray<OpenKrittFinding>;
  }>({ key: findingPageKey, cursor: null, items: [] });
  const activeFindingPaging =
    findingPaging.key === findingPageKey
      ? findingPaging
      : { key: findingPageKey, cursor: null, items: [] as ReadonlyArray<OpenKrittFinding> };
  const findingsQuery = useEnvironmentQuery(
    environmentId === null || scanId === null
      ? null
      : integrationEnvironment.listOpenKrittFindings({
          environmentId,
          input: {
            scanId,
            limit: 100,
            cursor: activeFindingPaging.cursor,
            includeDuplicates: false,
          },
        }),
  );
  const configureQuery = integrationsQuery.data?.integrations ?? [];
  const descriptor = configureQuery.find((item) => item.id === "open-kritt") ?? null;
  const connectorState = connectorStateForDescriptor(descriptor);
  const staleness = deriveProjectSecurityStaleness({
    connectionPhase: environment?.connection.phase ?? "disconnected",
    lastUpdatedAt: activeRun?.updatedAt ?? null,
  });
  const emptyState = deriveProjectSecurityEmptyState({
    connectorState,
    projectId: projectId ?? "unknown",
  });
  const launch = useAtomCommand(integrationEnvironment.launchOpenKrittScan, {
    reportFailure: false,
  });
  const refreshCatalog = useAtomCommand(integrationEnvironment.refreshOpenKrittCatalog, {
    reportFailure: false,
  });
  const previewSnapshot = useAtomCommand(integrationEnvironment.previewOpenKrittSnapshot, {
    reportFailure: false,
  });
  const createSnapshot = useAtomCommand(integrationEnvironment.createOpenKrittSnapshot, {
    reportFailure: false,
  });
  const [launchNotice, setLaunchNotice] = useState<string | null>(null);
  const [snapshotPreview, setSnapshotPreview] = useState<OpenKrittSnapshotPreviewResult | null>(
    null,
  );
  const [localSnapshotSource, setLocalSnapshotSource] = useState<OpenKrittSourceIdentity | null>(
    null,
  );
  const [snapshotNotice, setSnapshotNotice] = useState<string | null>(null);
  const [snapshotPending, setSnapshotPending] = useState(false);
  const [comparisonRequested, setComparisonRequested] = useState(false);
  const [rescanCommitSha, setRescanCommitSha] = useState("");
  const comparisonPair = useMemo(() => deriveScanComparisonPair(runs), [runs]);
  const comparisonQuery = useEnvironmentQuery(
    !comparisonRequested || environmentId === null || projectId === null || comparisonPair === null
      ? null
      : integrationEnvironment.compareOpenKrittScans({
          environmentId,
          input: {
            projectId,
            priorScanId: comparisonPair.priorScanId,
            currentScanId: comparisonPair.currentScanId,
            includeDuplicates: false,
          },
        }),
  );
  const repository = sourceRepository(project);
  const rescanSource = deriveRescanSource({
    localSnapshotSource,
    repository,
    commitSha: rescanCommitSha,
  });
  const modelSelection = project?.defaultModelSelection ?? null;
  const openKrittDefaults = usePrimarySettings((settings) => settings.integrations.openKritt);
  const defaultConfiguration = useMemo<OpenKrittScanConfiguration | null>(() => {
    if (
      openKrittDefaults.defaultWorkflowId === null ||
      openKrittDefaults.defaultProviderId === null ||
      openKrittDefaults.defaultModelId === null
    ) {
      return null;
    }
    return {
      workflowId: openKrittDefaults.defaultWorkflowId,
      postScriptIds: openKrittDefaults.defaultPostScriptIds,
      agentSkillIds: openKrittDefaults.defaultAgentSkillIds,
      severityRankerId: openKrittDefaults.defaultSeverityRankerId,
      providerId: openKrittDefaults.defaultProviderId,
      modelId: openKrittDefaults.defaultModelId,
      thinkingEffort: "high",
      jobLimit: 1,
    };
  }, [openKrittDefaults]);
  const refreshRunsFromFirstPage = () => {
    setRunPaging({ key: runPageKey, cursor: null, runs: [] });
    if (activeRunPaging.cursor === null) runsQuery.refresh();
  };
  const refreshFindingsFromFirstPage = () => {
    setFindingPaging({ key: findingPageKey, cursor: null, items: [] });
    if (activeFindingPaging.cursor === null) findingsQuery.refresh();
  };
  const refresh = () => {
    integrationsQuery.refresh();
    refreshRunsFromFirstPage();
    refreshFindingsFromFirstPage();
  };
  const findingItems = useMemo(() => {
    const byId = new Map<string, OpenKrittFinding>();
    for (const finding of activeFindingPaging.items) byId.set(finding.id, finding);
    for (const finding of findingsQuery.data?.items ?? []) byId.set(finding.id, finding);
    return [...byId.values()];
  }, [activeFindingPaging.items, findingsQuery.data?.items]);
  const unresolvedRunId =
    runsQuery.data === null
      ? undefined
      : (runsQuery.data.unresolvedRuns.find((run) => run.parentRunId === null)?.id ?? null);
  const currentSourceCommit =
    findingItems.find((finding) => finding.source.commitSha !== null)?.source.commitSha ?? null;
  const sourceIdentity = useMemo(
    () =>
      repository !== null && currentSourceCommit !== null
        ? { repoFull: repository, commitSha: currentSourceCommit, dirty: false, unpushed: false }
        : null,
    [currentSourceCommit, repository],
  );

  const handleLaunch = async (input: Omit<OpenKrittLaunchScanInput, "projectId">) => {
    const result = await launch({
      environmentId: environmentId!,
      input: { ...input, projectId: projectId! },
    });
    if (result._tag === "Failure") {
      const message = commandFailureMessage(result);
      setLaunchNotice(message);
      throw new Error(message);
    }
    setLaunchNotice(securityLaunchNotice(result.value.launchResolution));
    // A pending launch keeps its snapshot selection: the user still has to
    // answer or correct something, and the same snapshot must back that retry.
    if (
      input.source.kind === "local" &&
      result.value.launchResolution !== "policy-required" &&
      result.value.launchResolution !== "rejected"
    )
      setLocalSnapshotSource(null);
    setRunPaging({ key: runPageKey, cursor: null, runs: [] });
    if (activeRunPaging.cursor === null) runsQuery.refresh();
    return result.value;
  };

  // Loaded lazily, only once the launch form is actually opened, so browsing the
  // security page never triggers an upstream catalog round trip.
  const handleLoadCatalog = async (): Promise<OpenKrittCatalog | null> => {
    if (environmentId === null) return null;
    const result = await refreshCatalog({ environmentId, input: null });
    return result._tag === "Failure" ? null : result.value;
  };

  const handlePreviewSnapshot = async () => {
    if (environmentId === null || projectId === null) return;
    setSnapshotPending(true);
    setSnapshotNotice(null);
    const result = await previewSnapshot({
      environmentId,
      input: { projectId },
    });
    setSnapshotPending(false);
    if (result._tag === "Failure") {
      setSnapshotNotice(commandFailureMessage(result));
      return;
    }
    setSnapshotPreview(result.value);
  };

  const handleCreateSnapshot = async () => {
    if (environmentId === null || projectId === null || snapshotPreview === null) return;
    setSnapshotPending(true);
    setSnapshotNotice(null);
    // Send the digest of the manifest the user actually reviewed so the server
    // can refuse to publish a workspace that changed after confirmation.
    const result = await createSnapshot({
      environmentId,
      input: {
        projectId,
        confirmSafeForProvider: true,
        acknowledgedManifestDigest: snapshotPreview.manifestDigest,
      },
    });
    setSnapshotPending(false);
    if (result._tag === "Failure") {
      setSnapshotNotice(commandFailureMessage(result));
      setSnapshotPreview(null);
      return;
    }
    setLocalSnapshotSource({ kind: "local", snapshotId: result.value.snapshotId, commitSha: null });
    setSnapshotPreview(null);
    setSnapshotNotice("Snapshot created. Review the scan options, then launch it.");
  };

  return (
    <main
      aria-labelledby="project-security-heading"
      className="min-h-0 flex-1 overflow-y-auto px-5 py-8"
    >
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <ShieldCheckIcon className="size-3.5" /> Security
            </p>
            <h1 id="project-security-heading" className="text-2xl font-semibold">
              Project Security
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Review normalized Open Kritt evidence and route fixes through ordinary Not Codex
              threads.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={refresh}
            disabled={integrationsQuery.isPending || runsQuery.isPending || findingsQuery.isPending}
          >
            <RefreshCwIcon
              className={
                integrationsQuery.isPending || runsQuery.isPending || findingsQuery.isPending
                  ? "animate-spin motion-reduce:animate-none"
                  : ""
              }
            />{" "}
            Refresh
          </Button>
        </header>

        {staleness.stale ? (
          <p
            role="status"
            className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-xs text-warning-foreground"
          >
            <CircleAlertIcon className="size-4" /> Environment is{" "}
            {environment?.connection.phase ?? "offline"}; cached security observations are stale and
            read-only.
          </p>
        ) : null}
        {integrationsQuery.error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {integrationsQuery.error}
          </p>
        ) : null}
        {runsQuery.error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {runsQuery.error}
          </p>
        ) : null}

        {integrationsQuery.isPending && descriptor === null ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading Open Kritt connector state…
          </p>
        ) : null}
        {!integrationsQuery.isPending && emptyState.kind === "not-configured" ? (
          <section className="rounded-xl border border-dashed p-6">
            <h2 className="font-medium">Connect Open Kritt to scan this project</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{emptyState.message}</p>
            <Button
              className="mt-4"
              size="sm"
              variant="outline"
              render={<Link to="/settings/integrations" />}
            >
              Open integration settings
            </Button>
          </section>
        ) : null}

        {connectorState === "ready" ? (
          <>
            <section aria-labelledby="security-source-heading" className="rounded-xl border p-5">
              <div className="flex items-start gap-3">
                <HistoryIcon className="mt-0.5 size-4 text-muted-foreground" />
                <div className="min-w-0">
                  <h2 id="security-source-heading" className="text-sm font-semibold">
                    Immutable source
                  </h2>
                  <p className="mt-1 break-all text-sm">
                    {repository ?? "Repository identity is unavailable."}
                  </p>
                  {sourceIdentity ? (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {formatSecuritySourceIdentity(sourceIdentity).label}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      A full commit SHA must be verified by the server before a scan can start.
                    </p>
                  )}
                </div>
              </div>
            </section>
            {projectId !== null ? (
              <NewOpenKrittScanDialog
                key={`${environmentId ?? "none"}:${projectId}`}
                projectId={projectId}
                repository={repository}
                defaultSource={localSnapshotSource}
                defaultConfiguration={defaultConfiguration}
                {...(unresolvedRunId === undefined ? {} : { unresolvedRunId })}
                onLoadCatalog={handleLoadCatalog}
                disabled={
                  staleness.readOnly || (repository === null && localSnapshotSource === null)
                }
                onLaunch={handleLaunch}
              />
            ) : null}
            {projectId !== null ? (
              <section className="rounded-xl border p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">Scan a reviewed local snapshot</h2>
                    <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                      Use this only when the configured Open Kritt service is approved to receive
                      the selected source contents. The live workspace is never mounted.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handlePreviewSnapshot()}
                    disabled={staleness.readOnly || snapshotPending}
                  >
                    {snapshotPending ? (
                      <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                    ) : null}
                    {snapshotPending ? "Preparing…" : "Review local snapshot"}
                  </Button>
                </div>
                {snapshotPreview ? (
                  <div className="mt-4">
                    <LocalSnapshotConfirmation
                      preview={snapshotPreview}
                      onConfirm={() => void handleCreateSnapshot()}
                      disabled={staleness.readOnly || snapshotPending}
                    />
                  </div>
                ) : null}
                {snapshotNotice ? (
                  <p role="status" className="mt-3 text-xs text-muted-foreground">
                    {snapshotNotice}
                  </p>
                ) : null}
              </section>
            ) : null}
            {launchNotice ? (
              <p role="status" className="text-sm text-muted-foreground">
                {launchNotice}
              </p>
            ) : null}
          </>
        ) : null}

        <section aria-labelledby="security-scans-heading" className="rounded-xl border p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="security-scans-heading" className="text-sm font-semibold">
              Scans
            </h2>
            <span className="text-xs text-muted-foreground">{runs.length} retained</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="security-rescan-sha" className="text-xs text-muted-foreground">
              Rescan revision (full commit SHA)
            </label>
            <input
              id="security-rescan-sha"
              className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 font-mono text-xs"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="40-character commit SHA"
              value={rescanCommitSha}
              onChange={(event) => setRescanCommitSha(event.target.value)}
              aria-describedby="security-rescan-sha-help"
            />
            <span id="security-rescan-sha-help" className="text-xs text-muted-foreground">
              {rescanSource === null
                ? "A new immutable revision or reviewed local snapshot is required."
                : "Ready to rescan; the server verifies this revision."}
            </span>
          </div>
          {runs.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No Open Kritt scans are linked to this project yet.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{run.id}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Updated {timestamp(run.updatedAt)}
                      {run.outputSummary
                        ? ` · ${run.outputSummary.split("\n", 2)[1] ?? run.outputSummary}`
                        : ""}
                    </p>
                  </div>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant={runVariant(run.state)}>{securityRunStateLabel(run)}</Badge>
                    {extractOpenKrittExternalScanId(run.outputSummary) !== null ? (
                      <Button
                        size="xs"
                        variant={
                          scanId === extractOpenKrittExternalScanId(run.outputSummary)
                            ? "secondary"
                            : "outline"
                        }
                        aria-pressed={scanId === extractOpenKrittExternalScanId(run.outputSummary)}
                        onClick={() =>
                          setSelectedScanId(extractOpenKrittExternalScanId(run.outputSummary))
                        }
                      >
                        {scanId === extractOpenKrittExternalScanId(run.outputSummary)
                          ? "Viewing findings"
                          : "View findings"}
                      </Button>
                    ) : null}
                    {environmentId !== null &&
                    projectId !== null &&
                    canRescanFromRun(run) &&
                    extractOpenKrittExternalScanId(run.outputSummary) !== null ? (
                      <RescanButton
                        environmentId={environmentId}
                        projectId={projectId}
                        priorRunId={run.id}
                        priorScanId={extractOpenKrittExternalScanId(run.outputSummary)!}
                        source={rescanSource}
                        {...(runsQuery.data === null
                          ? {}
                          : {
                              unresolvedRunId:
                                runsQuery.data.unresolvedRuns.find(
                                  (candidate) =>
                                    candidate.parentRunId === run.id &&
                                    extractOpenKrittExternalScanId(candidate.outputSummary) ===
                                      null,
                                )?.id ?? null,
                            })}
                        disabled={staleness.readOnly}
                        onComplete={() => {
                          refreshRunsFromFirstPage();
                          setComparisonRequested(true);
                        }}
                      />
                    ) : null}
                  </span>
                </div>
              ))}
              {runsQuery.data?.nextCursor ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={runsQuery.isPending}
                  onClick={() => {
                    setRunPaging({
                      key: runPageKey,
                      cursor: runsQuery.data!.nextCursor,
                      runs,
                    });
                  }}
                >
                  Load older scans
                </Button>
              ) : null}
            </div>
          )}
          {comparisonRequested && comparisonPair !== null ? (
            <div className="mt-4">
              {comparisonQuery.error ? (
                <p role="alert" className="text-sm text-destructive-foreground">
                  {comparisonQuery.error}
                </p>
              ) : null}
              {comparisonQuery.data ? (
                <ScanComparisonPanel comparison={comparisonQuery.data} />
              ) : (
                <p role="status" className="text-sm text-muted-foreground">
                  Comparing the two most recent linked scans…
                </p>
              )}
            </div>
          ) : null}
          {comparisonPair !== null && !comparisonRequested ? (
            <Button
              className="mt-4"
              size="sm"
              variant="outline"
              onClick={() => setComparisonRequested(true)}
            >
              Compare the two most recent scans
            </Button>
          ) : null}
        </section>

        <section aria-labelledby="security-findings-heading" className="rounded-xl border p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="security-findings-heading" className="text-sm font-semibold">
              Canonical findings
            </h2>
            {scanId ? (
              <span className="font-mono text-xs text-muted-foreground">scan {scanId}</span>
            ) : null}
          </div>
          {findingsQuery.isPending ? (
            <p role="status" className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> Loading
              bounded findings…
            </p>
          ) : null}
          {findingsQuery.error ? (
            <p role="alert" className="mt-4 text-sm text-destructive-foreground">
              {findingsQuery.error}
            </p>
          ) : null}
          {!findingsQuery.isPending && !findingsQuery.error && findingItems.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Select a completed or active scan to view normalized findings.
            </p>
          ) : null}
          {findingItems.length > 0 && scanId && environmentId !== null && projectId !== null ? (
            <div className="mt-4">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Severity</th>
                      <th className="px-3 py-2 font-medium">Location</th>
                      <th className="px-3 py-2 font-medium">Finding</th>
                      <th className="px-3 py-2 font-medium">Risk / triage</th>
                      <th className="px-3 py-2 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {findingItems.map((finding) => (
                      <FindingRow
                        key={finding.id}
                        finding={finding}
                        environmentId={environmentId}
                        projectId={projectId}
                        scanId={scanId}
                        modelSelection={modelSelection}
                        readOnly={staleness.readOnly}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {findingsQuery.data?.nextCursor ? (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  disabled={findingsQuery.isPending}
                  onClick={() => {
                    setFindingPaging({
                      key: findingPageKey,
                      cursor: findingsQuery.data!.nextCursor,
                      items: findingItems,
                    });
                  }}
                >
                  Load more findings
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
        {children}
      </div>
    </main>
  );
}
