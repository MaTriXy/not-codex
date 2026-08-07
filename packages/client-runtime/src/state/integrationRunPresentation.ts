/** Shared source labels used by every integration-run client. */
export function integrationRunSourceLabel(source: string, upstreamStatus?: string): string {
  if (source === "open-kritt") {
    return upstreamStatus === "prewarming_cache" || upstreamStatus === "pending"
      ? "Open Kritt — queued/preparing"
      : "Open Kritt";
  }
  return source === "loopany" ? "LoopAny" : "Monkey.D.Loopy";
}
