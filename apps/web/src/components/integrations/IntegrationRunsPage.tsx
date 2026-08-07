import {
  type IntegrationId,
  type IntegrationListRunsInput,
  type IntegrationRunCursor,
  type IntegrationRunState,
  ProjectId,
} from "@notcodex/contracts";
import { Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  Clock3Icon,
  HistoryIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { integrationEnvironment } from "../../state/integrations";
import { useEnvironmentQuery } from "../../state/query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  createdAfterForRange,
  integrationRunSourceLabel,
  projectsForEnvironment,
  relativeRangeRefreshInterval,
  resolveRunsPageEnvironmentSelection,
  resolveRunTimeRangeChange,
  runDurationLabel,
  type RunTimeRange,
} from "./IntegrationRunsPage.logic";
import { IntegrationRunIdCopyButton } from "./IntegrationRunIdCopyButton";

const RUN_STATES: ReadonlyArray<IntegrationRunState> = [
  "queued",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
];

function NativeSelect({
  label,
  value,
  onChange,
  children,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="space-y-1.5">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
      >
        {children}
      </select>
    </label>
  );
}

function stateVariant(state: IntegrationRunState): "success" | "error" | "warning" | "secondary" {
  if (state === "succeeded") return "success";
  if (state === "failed" || state === "cancelled") return "error";
  if (state === "waiting") return "warning";
  return "secondary";
}

function formatAge(value: string, now: number): string {
  const milliseconds = now - new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) return value;
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function IntegrationRunsPage() {
  const { environments, isReady } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const [environmentId, setEnvironmentId] = useState(primaryEnvironmentId ?? null);
  const [source, setSource] = useState<IntegrationId | "all">("all");
  const [state, setState] = useState<IntegrationRunState | "all">("all");
  const [projectId, setProjectId] = useState("all");
  const [timeRange, setTimeRange] = useState<RunTimeRange>("7d");
  const [limit, setLimit] = useState(25);
  const [pageCursors, setPageCursors] = useState<ReadonlyArray<IntegrationRunCursor | null>>([
    null,
  ]);
  const [filterAnchor, setFilterAnchor] = useState(() => Date.now());
  const cursor = pageCursors.at(-1) ?? null;
  const now = Date.now();

  useEffect(() => {
    const selection = resolveRunsPageEnvironmentSelection({
      currentEnvironmentId: environmentId,
      primaryEnvironmentId,
      availableEnvironmentIds: environments.map((item) => item.environmentId),
      currentProjectId: projectId,
    });
    if (!selection.changed) return;
    setEnvironmentId(selection.environmentId);
    setProjectId(selection.projectId);
  }, [environmentId, environments, primaryEnvironmentId, projectId]);

  useEffect(() => {
    setPageCursors([null]);
  }, [environmentId, limit, projectId, source, state, timeRange]);

  useEffect(() => {
    const interval = relativeRangeRefreshInterval(timeRange);
    if (interval === undefined) return;
    const handle = window.setInterval(() => {
      setFilterAnchor(Date.now());
      setPageCursors([null]);
    }, interval);
    return () => window.clearInterval(handle);
  }, [timeRange]);

  const environmentProjects = useMemo(
    () => projectsForEnvironment(projects, environmentId),
    [environmentId, projects],
  );
  const projectTitleById = useMemo(
    () => new Map(environmentProjects.map((project) => [project.id, project.title])),
    [environmentProjects],
  );
  const input = useMemo<IntegrationListRunsInput>(
    () => ({
      ...(source === "all" ? {} : { source }),
      ...(state === "all" ? {} : { state }),
      ...(projectId === "all" ? {} : { projectId: ProjectId.make(projectId) }),
      ...(() => {
        const createdAfter = createdAfterForRange(timeRange, filterAnchor);
        return createdAfter === undefined ? {} : { createdAfter };
      })(),
      ...(cursor === null ? {} : { cursor }),
      limit,
    }),
    [cursor, filterAnchor, limit, projectId, source, state, timeRange],
  );
  const runsQuery = useEnvironmentQuery(
    environmentId === null ? null : integrationEnvironment.listRuns({ environmentId, input }),
  );
  const runs = runsQuery.data?.runs ?? [];
  const changeTimeRange = useCallback((value: string) => {
    const next = resolveRunTimeRangeChange(value as RunTimeRange, Date.now());
    setTimeRange(next.timeRange);
    setFilterAnchor(next.filterAnchor);
  }, []);
  const refreshRuns = useCallback(() => {
    setFilterAnchor(Date.now());
    setPageCursors([null]);
    runsQuery.refresh();
  }, [runsQuery]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <main className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <HistoryIcon className="size-3.5" /> Integrations
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Inspect durable Monkey.D.Loopy, LoopAny, and Open Kritt activity across connected
              environments.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={refreshRuns} disabled={!environmentId}>
            <RefreshCwIcon
              className={runsQuery.isPending ? "animate-spin motion-reduce:animate-none" : ""}
            />
            Refresh
          </Button>
        </header>

        <section
          aria-label="Run filters"
          className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-6"
        >
          <NativeSelect
            label="Environment"
            value={environmentId ?? ""}
            onChange={(value) => {
              setEnvironmentId(value as typeof environmentId);
              setProjectId("all");
            }}
          >
            {!isReady || environments.length === 0 ? (
              <option value="">No environments</option>
            ) : null}
            {environments.map((environment) => (
              <option key={environment.environmentId} value={environment.environmentId}>
                {environment.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            label="Integration"
            value={source}
            onChange={(value) => setSource(value as typeof source)}
          >
            <option value="all">All integrations</option>
            <option value="monkey-d-loopy">Monkey.D.Loopy</option>
            <option value="loopany">LoopAny</option>
            <option value="open-kritt">Open Kritt</option>
          </NativeSelect>
          <NativeSelect
            label="State"
            value={state}
            onChange={(value) => setState(value as typeof state)}
          >
            <option value="all">All states</option>
            {RUN_STATES.map((runState) => (
              <option key={runState} value={runState}>
                {runState}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect label="Project" value={projectId} onChange={setProjectId}>
            <option value="all">All projects</option>
            {environmentProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect label="Created" value={timeRange} onChange={changeTimeRange}>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All retained runs</option>
          </NativeSelect>
          <NativeSelect
            label="Page size"
            value={String(limit)}
            onChange={(value) => setLimit(Number(value))}
          >
            <option value="25">25 runs</option>
            <option value="50">50 runs</option>
          </NativeSelect>
        </section>

        {environmentId === null ? (
          <section role="status" className="rounded-xl border border-dashed p-8 text-center">
            <h2 className="font-medium">No connected environment</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect an execution environment before browsing durable run history.
            </p>
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              render={<Link to="/settings/connections" />}
            >
              Manage connections
            </Button>
          </section>
        ) : runsQuery.error ? (
          <section role="alert" className="rounded-xl border border-destructive/30 p-5">
            <h2 className="font-medium text-destructive-foreground">Run history is unavailable</h2>
            <p className="mt-1 text-sm text-muted-foreground">{runsQuery.error}</p>
            {runs.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">Showing the last available page.</p>
            ) : null}
            <Button className="mt-3" size="sm" variant="outline" onClick={refreshRuns}>
              Retry
            </Button>
          </section>
        ) : null}

        {environmentId === null ? null : runsQuery.isPending && runs.length === 0 ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" /> Loading
            durable runs…
          </p>
        ) : runs.length === 0 ? (
          <section role="status" className="rounded-xl border border-dashed p-8 text-center">
            <Clock3Icon className="mx-auto size-5 text-muted-foreground" />
            <h2 className="mt-3 font-medium">No runs match these filters</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Launch a Loopy spec or change the environment, state, project, or time range.
            </p>
          </section>
        ) : (
          <section aria-label="Run history" className="space-y-3">
            {runsQuery.isPending ? (
              <p role="status" className="text-xs text-muted-foreground">
                Refreshing this page…
              </p>
            ) : null}
            {runs.map((run) => (
              <article
                key={run.id}
                className="rounded-xl border p-4 transition-colors hover:bg-muted/20"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={stateVariant(run.state)}>{run.state}</Badge>
                      <Badge variant="outline">{integrationRunSourceLabel(run.source)}</Badge>
                      <span className="text-xs text-muted-foreground">Attempt {run.attempt}</span>
                    </div>
                    <p className="text-sm font-medium">
                      {run.projectId === null
                        ? "Unresolved project"
                        : (projectTitleById.get(run.projectId) ?? run.projectId)}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{formatAge(run.createdAt, now)}</span>
                      <span>Duration {runDurationLabel(run, now)}</span>
                      <span>Updated {new Date(run.updatedAt).toLocaleString()}</span>
                    </div>
                    <p className="max-w-full truncate font-mono text-[11px] text-muted-foreground">
                      {run.id}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <IntegrationRunIdCopyButton runId={run.id} />
                    <Button
                      size="sm"
                      variant="outline"
                      render={
                        <Link
                          to="/runs/$environmentId/$runId"
                          params={{ environmentId: environmentId!, runId: run.id }}
                        />
                      }
                    >
                      Inspect <ArrowRightIcon />
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}

        <nav
          aria-label="Run history pages"
          className="flex items-center justify-between border-t pt-4"
        >
          <Button
            size="sm"
            variant="outline"
            disabled={pageCursors.length === 1}
            onClick={() => setPageCursors((pages) => pages.slice(0, -1))}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {pageCursors.length}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={runsQuery.data?.nextCursor === null || runsQuery.data === null}
            onClick={() => {
              const nextCursor = runsQuery.data?.nextCursor;
              if (nextCursor) setPageCursors((pages) => [...pages, nextCursor]);
            }}
          >
            Next
          </Button>
        </nav>
      </main>
    </div>
  );
}
