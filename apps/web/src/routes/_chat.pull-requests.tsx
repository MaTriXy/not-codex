import type {
  ProjectId,
  PullRequestInvolvement,
  PullRequestListEntry,
  PullRequestListState,
  PullRequestRef,
} from "@notcodex/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  GitPullRequestIcon,
  LayersIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PullRequestDetailPanel } from "../components/pullRequest/PullRequestDetailPanel";
import { PullRequestListEmptyState } from "../components/pullRequest/PullRequestListEmptyState";
import { PullRequestListGhost } from "../components/pullRequest/PullRequestGhosts";
import { PullRequestRow } from "../components/pullRequest/PullRequestRow";
import { PullRequestsUnavailableState } from "../components/pullRequest/PullRequestsUnavailableState";
import {
  groupPullRequestsByInvolvement,
  matchesPullRequestQuery,
  readPullRequestListSnapshot,
  withDiffStat,
  writePullRequestListSnapshot,
} from "../components/pullRequest/pullRequestList.logic";
import { Button } from "../components/ui/button";
import { SidebarInset } from "../components/ui/sidebar";
import { useDebouncedValue } from "../state/queries";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironment } from "../state/environments";
import { pullRequestEnvironment } from "../state/pullRequests";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { cn } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

export interface PullRequestsSearch {
  readonly involvement: PullRequestInvolvement;
  readonly state: PullRequestListState;
  readonly projectId?: ProjectId;
  readonly selectedProjectId?: ProjectId;
  readonly repository?: string;
  readonly number?: number;
  readonly q?: string;
}

type PullRequestsSearchPatch = {
  [Key in keyof PullRequestsSearch]?: PullRequestsSearch[Key] | undefined;
};

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;
const SEARCH_DEBOUNCE_MS = 250;

export const Route = createFileRoute("/_chat/pull-requests")({
  validateSearch: (raw: Record<string, unknown>): PullRequestsSearch => ({
    involvement:
      raw.involvement === "reviewing" || raw.involvement === "authored" ? raw.involvement : "all",
    state:
      raw.state === "all" || raw.state === "closed" || raw.state === "merged" ? raw.state : "open",
    ...(typeof raw.projectId === "string" && raw.projectId
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.selectedProjectId === "string" && raw.selectedProjectId
      ? { selectedProjectId: raw.selectedProjectId as ProjectId }
      : {}),
    ...(typeof raw.repository === "string" && raw.repository
      ? { repository: raw.repository.slice(0, 512) }
      : {}),
    ...(typeof raw.number === "number" && Number.isSafeInteger(raw.number) && raw.number > 0
      ? { number: raw.number }
      : {}),
    ...(typeof raw.q === "string" && raw.q.trim() ? { q: raw.q.slice(0, 200) } : {}),
  }),
  component: PullRequestsRoute,
});

function PullRequestsRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = primaryEnvironment?.environmentId ?? null;
  const capabilityKnown = primaryEnvironment?.serverConfig !== null;
  const supported =
    primaryEnvironment?.serverConfig?.environment.capabilities.pullRequests === true;
  const projects = useProjects()
    .filter((project) => project.environmentId === environmentId)
    .toSorted((left, right) => left.title.localeCompare(right.title));
  const scopedProjectId = projects.some((project) => project.id === search.projectId)
    ? search.projectId
    : undefined;
  const typedQuery = search.q?.trim() ?? "";
  const sentQuery = useDebouncedValue(typedQuery, SEARCH_DEBOUNCE_MS);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const scope = `${search.state}:${search.involvement}:${scopedProjectId ?? ""}:${sentQuery}:${limit}`;

  useEffect(
    () => setLimit(PAGE_SIZE),
    [scopedProjectId, search.involvement, search.state, sentQuery],
  );

  const listQuery = useEnvironmentQuery(
    supported && environmentId !== null
      ? pullRequestEnvironment.list({
          environmentId,
          input: {
            state: search.state,
            involvement: search.involvement,
            limit,
            ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
            ...(sentQuery ? { query: sentQuery } : {}),
          },
        })
      : null,
  );
  const [retained, setRetained] = useState<{
    environmentId: string;
    scope: string;
    data: NonNullable<typeof listQuery.data>;
  } | null>(null);

  useEffect(() => {
    if (environmentId === null) return;
    const snapshot = readPullRequestListSnapshot(window.localStorage, environmentId);
    setRetained(snapshot?.scope === scope ? { environmentId, scope, data: snapshot.data } : null);
  }, [environmentId, scope]);

  useEffect(() => {
    if (environmentId === null || listQuery.data === null) return;
    setRetained({ environmentId, scope, data: listQuery.data });
    writePullRequestListSnapshot(window.localStorage, environmentId, {
      scope,
      data: listQuery.data,
    });
  }, [environmentId, listQuery.data, scope]);

  const data =
    listQuery.data ??
    (retained?.environmentId === environmentId && retained.scope === scope ? retained.data : null);
  const locallyFilteredEntries = useMemo(
    () =>
      data?.entries.filter((entry) =>
        typedQuery === sentQuery ? true : matchesPullRequestQuery(entry, typedQuery),
      ) ?? [],
    [data?.entries, sentQuery, typedQuery],
  );
  const statsQuery = useEnvironmentQuery(
    supported && environmentId !== null && locallyFilteredEntries.length > 0
      ? pullRequestEnvironment.listStats({
          environmentId,
          input: {
            refs: locallyFilteredEntries.map((entry) => ({
              projectId: entry.projectId,
              repository: entry.repository,
              number: entry.number,
            })),
          },
        })
      : null,
  );
  const statsByEntry = useMemo(
    () =>
      new Map(
        statsQuery.data?.stats.map((stat) => [
          `${stat.projectId}:${stat.repository}#${stat.number}`,
          stat,
        ]) ?? [],
      ),
    [statsQuery.data],
  );
  const entries = useMemo(
    () =>
      locallyFilteredEntries.map((entry) => {
        const stat = statsByEntry.get(`${entry.projectId}:${entry.repository}#${entry.number}`);
        return stat
          ? withDiffStat(entry, new Map([[`${entry.projectId} ${entry.number}`, stat]]))
          : entry;
      }),
    [locallyFilteredEntries, statsByEntry],
  );
  const groups = useMemo(
    () =>
      search.involvement === "all" && data
        ? groupPullRequestsByInvolvement(entries, data.viewers)
        : [{ key: "others" as const, label: null, entries }],
    [data, entries, search.involvement],
  );

  const selectedReference: PullRequestRef | null =
    search.selectedProjectId && search.repository && search.number
      ? {
          projectId: search.selectedProjectId,
          repository: search.repository,
          number: search.number,
        }
      : null;
  const selectedKey = selectedReference
    ? `${selectedReference.projectId}:${selectedReference.repository}#${selectedReference.number}`
    : null;
  const updateSearch = useCallback(
    (patch: PullRequestsSearchPatch) =>
      void navigate({
        replace: true,
        search: (previous: PullRequestsSearch): PullRequestsSearch => {
          const next = { ...previous, ...patch };
          return {
            involvement: next.involvement ?? "all",
            state: next.state ?? "open",
            ...(next.projectId ? { projectId: next.projectId } : {}),
            ...(next.selectedProjectId ? { selectedProjectId: next.selectedProjectId } : {}),
            ...(next.repository ? { repository: next.repository } : {}),
            ...(next.number ? { number: next.number } : {}),
            ...(next.q ? { q: next.q } : {}),
          };
        },
      }),
    [navigate],
  );
  const clearSelection = useCallback(
    () => updateSearch({ selectedProjectId: undefined, repository: undefined, number: undefined }),
    [updateSearch],
  );
  const selectEntry = useCallback(
    (entry: PullRequestListEntry) =>
      updateSearch({
        selectedProjectId: entry.projectId,
        repository: entry.repository,
        number: entry.number,
      }),
    [updateSearch],
  );
  const invalidate = useAtomCommand(pullRequestEnvironment.invalidate, { reportFailure: false });
  const [refreshing, setRefreshing] = useState(false);
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);
  const refresh = useCallback(async () => {
    if (environmentId === null) return;
    setRefreshing(true);
    try {
      await invalidate({ environmentId, input: {} });
      listQuery.refresh();
      statsQuery.refresh();
      setDetailRefreshToken((token) => token + 1);
    } finally {
      setRefreshing(false);
    }
  }, [environmentId, invalidate, listQuery.refresh, statsQuery.refresh]);

  if (primaryEnvironment === null || !capabilityKnown) {
    return (
      <PullRequestsPageShell>
        <PullRequestListGhost />
      </PullRequestsPageShell>
    );
  }
  if (!supported || environmentId === null) {
    return (
      <PullRequestsPageShell>
        <PullRequestsUnavailableState
          title="Pull requests are unavailable"
          error="Update and reconnect this environment to use the pull request browser."
        />
      </PullRequestsPageShell>
    );
  }

  const canLoadMore =
    limit < MAX_PAGE_SIZE &&
    Boolean(data?.truncated || Object.keys(data?.nextCursors ?? {}).length > 0);

  return (
    <SidebarInset className="relative h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-48 left-[10%] size-[34rem] rounded-full bg-primary/[0.055] blur-3xl dark:bg-primary/[0.075]" />
        <div className="absolute -right-48 bottom-[-16rem] size-[38rem] rounded-full bg-violet-500/[0.045] blur-3xl dark:bg-violet-400/[0.065]" />
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          className={cn(
            "flex h-[var(--workspace-topbar-height)] shrink-0 items-center justify-between border-b border-border/55 bg-background/72 px-3 backdrop-blur-xl transition-[padding-left] duration-200 motion-reduce:transition-none sm:px-5",
            "wco:pr-[var(--workspace-native-controls-inset)]",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg border border-border/60 bg-card/70 shadow-sm">
              <GitPullRequestIcon className="size-3.5 text-muted-foreground" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">Pull requests</h1>
              <p className="hidden text-[10px] text-muted-foreground sm:block">
                Read-only workspace review
              </p>
            </div>
          </div>
          <Button size="sm" variant="ghost" disabled={refreshing} onClick={() => void refresh()}>
            <RefreshCwIcon className={cn("size-3.5", refreshing && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(22rem,27rem)_minmax(0,1fr)]">
          <section
            className={cn(
              "min-h-0 flex-col border-r border-border/55 bg-card/28 backdrop-blur-xl",
              selectedReference ? "hidden lg:flex" : "flex",
            )}
          >
            <div className="shrink-0 space-y-2 border-b border-border/50 p-3">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={typedQuery}
                  onChange={(event) => updateSearch({ q: event.currentTarget.value || undefined })}
                  placeholder="Search pull requests"
                  aria-label="Search pull requests"
                  className="h-9 w-full rounded-xl border border-input bg-background/68 pl-9 pr-3 text-sm shadow-xs outline-none backdrop-blur-md placeholder:text-muted-foreground/65 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
                />
              </div>
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <FilterSelect
                  ariaLabel="Pull request state"
                  value={search.state}
                  onChange={(value) =>
                    updateSearch({
                      state: value as PullRequestListState,
                      selectedProjectId: undefined,
                      repository: undefined,
                      number: undefined,
                    })
                  }
                  options={["open", "all", "merged", "closed"]}
                />
                <FilterSelect
                  ariaLabel="Pull request involvement"
                  value={search.involvement}
                  onChange={(value) =>
                    updateSearch({
                      involvement: value as PullRequestInvolvement,
                      selectedProjectId: undefined,
                      repository: undefined,
                      number: undefined,
                    })
                  }
                  options={["all", "reviewing", "authored"]}
                />
                <label className="relative flex min-w-0 items-center">
                  <SlidersHorizontalIcon className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
                  <select
                    aria-label="Project"
                    value={scopedProjectId ?? ""}
                    onChange={(event) =>
                      updateSearch({
                        projectId: (event.currentTarget.value || undefined) as
                          | ProjectId
                          | undefined,
                        selectedProjectId: undefined,
                        repository: undefined,
                        number: undefined,
                      })
                    }
                    className="h-8 max-w-40 appearance-none rounded-lg border border-input bg-background/60 pl-8 pr-3 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
                  >
                    <option value="">All projects</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {data?.errors.length ? (
              <div className="m-3 mb-0 flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {data.errors.length} {data.errors.length === 1 ? "project is" : "projects are"}{" "}
                  unavailable.
                </span>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-gutter:stable]">
              {data === null && listQuery.error ? (
                <PullRequestsUnavailableState error={listQuery.error} onRetry={listQuery.refresh} />
              ) : data === null ? (
                <PullRequestListGhost />
              ) : entries.length === 0 ? (
                <PullRequestListEmptyState
                  query={typedQuery}
                  filtered={Boolean(
                    typedQuery ||
                    scopedProjectId ||
                    search.state !== "open" ||
                    search.involvement !== "all",
                  )}
                  searching={typedQuery !== sentQuery}
                  hasProjects={projects.length > 0}
                  canLoadMore={canLoadMore}
                  loadingMore={listQuery.isPending}
                  refreshing={refreshing}
                  onClearQuery={() => updateSearch({ q: undefined })}
                  onLoadMore={() =>
                    setLimit((current) => Math.min(MAX_PAGE_SIZE, current + PAGE_SIZE))
                  }
                  onRefresh={() => {
                    void refresh();
                  }}
                />
              ) : (
                <div className="space-y-4">
                  {groups.map((group) => (
                    <section key={group.key}>
                      {group.label ? (
                        <div className="mb-1 flex items-center gap-2 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">
                          <span>{group.label}</span>
                          <span className="rounded-full bg-muted/65 px-1.5 py-0.5 tabular-nums">
                            {group.entries.length}
                          </span>
                        </div>
                      ) : null}
                      <div className="space-y-0.5">
                        {group.entries.map((entry) => (
                          <PullRequestRow
                            key={`${entry.host}:${entry.repository}#${entry.number}`}
                            entry={entry}
                            selected={
                              selectedKey ===
                              `${entry.projectId}:${entry.repository}#${entry.number}`
                            }
                            showProjectTitle={!scopedProjectId}
                            showProvider={(data?.providers.length ?? 0) > 1}
                            onSelect={selectEntry}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                  {canLoadMore ? (
                    <div className="flex justify-center pb-3">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={listQuery.isPending}
                        onClick={() =>
                          setLimit((current) => Math.min(MAX_PAGE_SIZE, current + PAGE_SIZE))
                        }
                      >
                        {listQuery.isPending ? "Loading…" : "Load more"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          <section
            className={cn(
              "min-h-0 bg-background/28",
              selectedReference ? "block" : "hidden lg:block",
            )}
          >
            {selectedReference ? (
              <PullRequestDetailPanel
                environmentId={environmentId}
                reference={selectedReference}
                refreshToken={detailRefreshToken}
                onBack={clearSelection}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-center">
                <div className="max-w-sm rounded-3xl border border-border/50 bg-card/42 px-8 py-10 shadow-sm/5 backdrop-blur-xl">
                  <span className="mx-auto flex size-11 items-center justify-center rounded-2xl border border-border/60 bg-background/60">
                    <LayersIcon className="size-5 text-muted-foreground" />
                  </span>
                  <h2 className="mt-4 text-sm font-semibold">Pick a pull request</h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Read its summary, conversation, checks, and code without leaving your workspace.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </SidebarInset>
  );
}

function PullRequestsPageShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col">
        <header
          className={cn(
            "flex h-[var(--workspace-topbar-height)] items-center border-b border-border px-5",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <GitPullRequestIcon className="mr-2 size-4" />
          <span className="text-sm font-semibold">Pull requests</span>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </SidebarInset>
  );
}

function FilterSelect({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  options: ReadonlyArray<string>;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      className="h-8 min-w-0 appearance-none rounded-lg border border-input bg-background/60 px-2.5 text-xs capitalize text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
