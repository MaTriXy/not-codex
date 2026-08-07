import type {
  EnvironmentId,
  IntegrationRun,
  IntegrationRunTimelineEvent,
} from "@notcodex/contracts";
export { integrationRunSourceLabel } from "@notcodex/client-runtime/state/integration-run-presentation";

import { resolveRunEnvironmentSelection } from "../settings/IntegrationsRun.logic";

export type RunTimeRange = "all" | "24h" | "7d" | "30d";

export function filterIntegrationRunsBySource<T extends { readonly source: string }>(
  runs: ReadonlyArray<T>,
  source: string,
): ReadonlyArray<T> {
  return runs.filter((run) => run.source === source);
}

const RANGE_MILLISECONDS: Record<Exclude<RunTimeRange, "all">, number> = {
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

const RELATIVE_RANGE_REFRESH_INTERVAL_MS = 60_000;

export function relativeRangeRefreshInterval(range: RunTimeRange): number | undefined {
  return range === "all" ? undefined : RELATIVE_RANGE_REFRESH_INTERVAL_MS;
}

export function resolveRunTimeRangeChange(
  timeRange: RunTimeRange,
  now: number,
): { readonly timeRange: RunTimeRange; readonly filterAnchor: number } {
  return { timeRange, filterAnchor: now };
}

export function createdAfterForRange(range: RunTimeRange, now: number): string | undefined {
  return range === "all" ? undefined : new Date(now - RANGE_MILLISECONDS[range]).toISOString();
}

export function projectsForEnvironment<T extends { readonly environmentId: string }>(
  projects: ReadonlyArray<T>,
  environmentId: string | null,
): ReadonlyArray<T> {
  return environmentId === null
    ? []
    : projects.filter((project) => project.environmentId === environmentId);
}

export function resolveRunsPageEnvironmentSelection(input: {
  readonly currentEnvironmentId: EnvironmentId | null;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly availableEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly currentProjectId: string;
}): {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: string;
  readonly changed: boolean;
} {
  const selection = resolveRunEnvironmentSelection(input);
  return {
    ...selection,
    projectId: selection.changed ? "all" : input.currentProjectId,
  };
}

export function runDurationLabel(run: IntegrationRun, now: number): string {
  const start = new Date(run.startedAt ?? run.createdAt).getTime();
  const end = new Date(run.completedAt ?? (run.state === "queued" ? run.createdAt : now)).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  const seconds = Math.max(0, Math.round((end - start) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function deriveRunTimeline(run: IntegrationRun): ReadonlyArray<IntegrationRunTimelineEvent> {
  if (run.timeline.length > 0)
    return [...run.timeline].sort((left, right) => {
      if (left.sequence !== right.sequence) return left.sequence - right.sequence;
      return left.occurredAt.localeCompare(right.occurredAt);
    });
  const events: Array<IntegrationRunTimelineEvent> = [
    { sequence: 0, state: "queued", occurredAt: run.createdAt, summary: "Run queued" },
  ];
  if (run.startedAt !== null) {
    events.push({
      sequence: events.length,
      state: "running",
      occurredAt: run.startedAt,
      summary: "Run started",
    });
  }
  if (run.state === "waiting" || ["succeeded", "failed", "cancelled"].includes(run.state)) {
    events.push({
      sequence: events.length,
      state: run.state,
      occurredAt: run.completedAt ?? run.updatedAt,
      summary:
        run.state === "succeeded"
          ? "Run completed successfully"
          : run.state === "failed"
            ? "Run failed"
            : run.state === "cancelled"
              ? "Run cancelled"
              : "Run is waiting",
    });
  }
  return events;
}
