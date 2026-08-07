import * as NodeCrypto from "node:crypto";

export type OpenKrittUpstreamStatus =
  | "pending"
  | "prewarming_cache"
  | "queued"
  | "running"
  | "post_processing"
  | "paused"
  | "rate_limited"
  | "completed"
  | "stopped"
  | "failed";

export function mapOpenKrittStatus(input: {
  readonly status: string | null;
  readonly phase: string | null;
}): {
  readonly state: "queued" | "running" | "waiting" | "succeeded" | "cancelled" | "failed";
  readonly upstreamStatus: OpenKrittUpstreamStatus;
  readonly upstreamPhase: string | null;
} {
  if (input.status === null) throw new Error("Missing Open Kritt scan status.");
  const state = (() => {
    switch (input.status) {
      case "pending":
      case "prewarming_cache":
      case "queued":
        return "queued" as const;
      case "running":
      case "post_processing":
        return "running" as const;
      case "paused":
      case "rate_limited":
        return "waiting" as const;
      case "completed":
        return "succeeded" as const;
      case "stopped":
        return "cancelled" as const;
      case "failed":
        return "failed" as const;
      default:
        throw new Error("Unknown Open Kritt scan status.");
    }
  })();
  return { state, upstreamStatus: input.status, upstreamPhase: input.phase };
}

export function openKrittPollKey(environmentId: string, externalScanId: string): string {
  return NodeCrypto.createHash("sha256")
    .update(`${environmentId}\u0000${externalScanId}`)
    .digest("hex");
}

export function shouldPollOpenKrittScan(input: {
  readonly durableState: "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  readonly freshness: "fresh" | "stale";
}): boolean {
  return (
    input.durableState === "queued" ||
    input.durableState === "running" ||
    input.durableState === "waiting"
  );
}

/** Upper bound on the tracked failure streak; the delay is capped anyway. */
export const OPEN_KRITT_MAX_POLL_FAILURE_STREAK = 16;

/**
 * Advances the consecutive-failure counter the runtime poll loop feeds into
 * {@link nextOpenKrittPollDelayMs}. Any successful tick resets the streak, so a
 * recovered upstream immediately returns to the configured interval.
 */
export function nextOpenKrittPollFailureCount(
  previous: number,
  tick: { readonly failed: boolean },
): number {
  if (!tick.failed) return 0;
  return Math.min(OPEN_KRITT_MAX_POLL_FAILURE_STREAK, Math.max(0, Math.floor(previous)) + 1);
}

export function nextOpenKrittPollDelayMs(input: {
  readonly consecutiveFailures: number;
  readonly baseIntervalMs: number;
}): number {
  const failures = Math.max(0, Math.min(99, Math.floor(input.consecutiveFailures)));
  return Math.min(300_000, Math.max(0, input.baseIntervalMs) * 2 ** failures);
}
