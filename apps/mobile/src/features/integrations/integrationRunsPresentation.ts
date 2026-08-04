import type {
  EnvironmentId,
  IntegrationRun,
  IntegrationRunCursor,
  IntegrationRunRuntimeSnapshot,
  ThreadId,
} from "@notcodex/contracts";

export const openKrittMobileOperations: ReadonlyArray<never> = [];

export function integrationRunSourceLabel(source: string, upstreamStatus?: string): string {
  if (source === "open-kritt") {
    return upstreamStatus === "prewarming_cache" || upstreamStatus === "pending"
      ? "Open Kritt — queued/preparing"
      : "Open Kritt";
  }
  return source === "loopany" ? "LoopAny" : "Monkey.D.Loopy";
}

/**
 * Observation-only view of an Open Kritt durable run. Mobile renders the
 * server-owned summary; it never derives or mutates upstream scan state.
 */
export function openKrittRunObservation(run: {
  readonly source: string;
  readonly outputSummary: string | null;
  readonly projectId: string | null;
}): {
  readonly isOpenKritt: boolean;
  readonly upstreamDetail: string | null;
  readonly findingCount: number | null;
  readonly duplicateCount: number | null;
} {
  if (run.source !== "open-kritt")
    return { isOpenKritt: false, upstreamDetail: null, findingCount: null, duplicateCount: null };
  const lines = (run.outputSummary ?? "").split("\n");
  const detail = lines.find((line) => line.startsWith("Open Kritt status:")) ?? null;
  const count = (label: string): number | null => {
    const match = detail?.match(new RegExp(`(\\d+) ${label}`));
    return match?.[1] === undefined ? null : Number(match[1]);
  };
  return {
    isOpenKritt: true,
    upstreamDetail: detail,
    findingCount: count("findings"),
    duplicateCount: count("duplicates"),
  };
}

export function openKrittObservationPresentation(input: {
  readonly state: IntegrationRun["state"];
  readonly connectionPhase: string;
  readonly findingCount: number;
}) {
  return {
    stale: input.connectionPhase !== "connected",
    readOnly: true,
    findingCount: Math.max(0, input.findingCount),
    stateLabel: input.state,
  } as const;
}

export type IntegrationRunTone = "success" | "danger" | "warning" | "neutral";

export function integrationRunTone(state: IntegrationRun["state"]): IntegrationRunTone {
  if (state === "succeeded") return "success";
  if (state === "failed" || state === "cancelled") return "danger";
  if (state === "waiting") return "warning";
  return "neutral";
}

export function integrationRunIsActive(state: IntegrationRun["state"]): boolean {
  return state === "queued" || state === "running" || state === "waiting";
}

export function integrationRunHasRefreshWarning(
  error: string | null,
  hasCachedData: boolean,
): boolean {
  return error !== null && hasCachedData;
}

export function integrationRunDetailIsLoading(
  isPending: boolean,
  hasRun: boolean,
  isStale: boolean,
): boolean {
  return isPending && !hasRun && !isStale;
}

export function selectIntegrationRunDetailRun(input: {
  readonly inspectedRun: IntegrationRun | null;
  readonly durableRun: IntegrationRun | null;
  readonly inspectionError: string | null;
}): IntegrationRun | null {
  if (input.inspectionError !== null) return input.durableRun;
  return input.inspectedRun ?? input.durableRun;
}

export function selectIntegrationRunRuntimeInspection(input: {
  readonly runtime: IntegrationRunRuntimeSnapshot | null;
  readonly inspectionError: string | null;
}): IntegrationRunRuntimeSnapshot | null {
  return input.inspectionError === null ? input.runtime : null;
}

export function integrationRunHistoryIsLoading(isPending: boolean, isStale: boolean): boolean {
  return isPending && !isStale;
}

export function integrationRunHistoryIsUnavailableOffline(
  isStale: boolean,
  runCount: number,
): boolean {
  return isStale && runCount === 0;
}

export function integrationRunDurationLabel(run: IntegrationRun, nowMs: number): string {
  const startedAt = Date.parse(run.startedAt ?? run.createdAt);
  const completedAt = Date.parse(run.completedAt ?? run.updatedAt);
  const end =
    run.completedAt === null && ["queued", "running", "waiting"].includes(run.state)
      ? nowMs
      : completedAt;
  if (!Number.isFinite(startedAt) || !Number.isFinite(end)) return "Unknown";
  const seconds = Math.max(0, Math.round((end - startedAt) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function integrationRunIsStale(connectionPhase: string): boolean {
  return connectionPhase !== "connected";
}

export function integrationRunProjectLabel(
  run: IntegrationRun,
  projects: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: string;
    readonly title: string;
  }>,
  environmentId: EnvironmentId,
): string {
  if (run.projectId === null) return "Unresolved project";
  return (
    projects.find(
      (project) => project.environmentId === environmentId && project.id === run.projectId,
    )?.title ?? run.projectId
  );
}

export function integrationRunThreadLinks(
  run: IntegrationRun,
  environmentId: EnvironmentId,
  threads: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly id: ThreadId }>,
): ReadonlyArray<{ readonly threadId: ThreadId; readonly available: boolean }> {
  return run.threadIds.map((threadId) => ({
    threadId,
    available: threads.some(
      (thread) => thread.environmentId === environmentId && thread.id === threadId,
    ),
  }));
}

export function pushIntegrationRunPage(
  cursors: ReadonlyArray<IntegrationRunCursor | null>,
  nextCursor: IntegrationRunCursor | null,
): ReadonlyArray<IntegrationRunCursor | null> {
  if (nextCursor === null) return cursors;
  const current = cursors.at(-1);
  if (current?.createdAt === nextCursor.createdAt && current.id === nextCursor.id) return cursors;
  return [...cursors, nextCursor];
}

export function popIntegrationRunPage(
  cursors: ReadonlyArray<IntegrationRunCursor | null>,
): ReadonlyArray<IntegrationRunCursor | null> {
  return cursors.length <= 1 ? cursors : cursors.slice(0, -1);
}
