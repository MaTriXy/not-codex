import { describe, expect, it } from "vite-plus/test";

import {
  mapOpenKrittStatus,
  nextOpenKrittPollDelayMs,
  nextOpenKrittPollFailureCount,
  OPEN_KRITT_MAX_POLL_FAILURE_STREAK,
  openKrittPollKey,
  shouldPollOpenKrittScan,
} from "./openKrittStatus.ts";

describe("Open Kritt lifecycle and server-owned polling", () => {
  it.each([
    ["pending", "queued"],
    ["prewarming_cache", "queued"],
    ["queued", "queued"],
    ["running", "running"],
    ["post_processing", "running"],
    ["paused", "waiting"],
    ["rate_limited", "waiting"],
    ["completed", "succeeded"],
    ["stopped", "cancelled"],
    ["failed", "failed"],
  ] as const)("maps upstream %s to durable state %s while preserving phase", (status, state) => {
    expect(mapOpenKrittStatus({ status, phase: "synthetic-phase" })).toMatchObject({
      state,
      upstreamStatus: status,
      upstreamPhase: "synthetic-phase",
    });
  });

  it("does not guess state for unknown or missing upstream status", () => {
    expect(() => mapOpenKrittStatus({ status: "unknown-status", phase: null })).toThrow();
    expect(() => mapOpenKrittStatus({ status: null, phase: null })).toThrow();
  });

  it("coalesces observers to one poller per environment and external scan id", () => {
    expect(openKrittPollKey("environment-1", "scan-1")).toBe(
      openKrittPollKey("environment-1", "scan-1"),
    );
    expect(openKrittPollKey("environment-1", "scan-1")).not.toBe(
      openKrittPollKey("environment-2", "scan-1"),
    );
    expect(openKrittPollKey("environment-1", "scan-1")).not.toContain("scan-1");
  });

  it("polls only nonterminal runs, backs off after failures, and stops after terminal state", () => {
    expect(shouldPollOpenKrittScan({ durableState: "queued", freshness: "fresh" })).toBe(true);
    expect(shouldPollOpenKrittScan({ durableState: "running", freshness: "stale" })).toBe(true);
    expect(shouldPollOpenKrittScan({ durableState: "succeeded", freshness: "fresh" })).toBe(false);
    expect(shouldPollOpenKrittScan({ durableState: "failed", freshness: "stale" })).toBe(false);
    expect(nextOpenKrittPollDelayMs({ consecutiveFailures: 0, baseIntervalMs: 5_000 })).toBe(5_000);
    expect(
      nextOpenKrittPollDelayMs({ consecutiveFailures: 3, baseIntervalMs: 5_000 }),
    ).toBeGreaterThan(5_000);
    expect(
      nextOpenKrittPollDelayMs({ consecutiveFailures: 99, baseIntervalMs: 5_000 }),
    ).toBeLessThanOrEqual(300_000);
  });

  it("grows the delay across consecutive failing ticks and resets after a success", () => {
    const base = 5_000;
    let failures = 0;
    const delays: Array<number> = [];
    for (let tick = 0; tick < 3; tick += 1) {
      failures = nextOpenKrittPollFailureCount(failures, { failed: true });
      delays.push(
        nextOpenKrittPollDelayMs({ consecutiveFailures: failures, baseIntervalMs: base }),
      );
    }
    expect(failures).toBe(3);
    expect(delays).toEqual([10_000, 20_000, 40_000]);

    // A single successful observation returns the loop to the configured interval.
    failures = nextOpenKrittPollFailureCount(failures, { failed: false });
    expect(failures).toBe(0);
    expect(nextOpenKrittPollDelayMs({ consecutiveFailures: failures, baseIntervalMs: base })).toBe(
      base,
    );
  });

  it("caps the tracked failure streak so the delay stays bounded", () => {
    let failures = 0;
    for (let tick = 0; tick < 100; tick += 1) {
      failures = nextOpenKrittPollFailureCount(failures, { failed: true });
    }
    expect(failures).toBe(OPEN_KRITT_MAX_POLL_FAILURE_STREAK);
    expect(
      nextOpenKrittPollDelayMs({ consecutiveFailures: failures, baseIntervalMs: 5_000 }),
    ).toBeLessThanOrEqual(300_000);
  });
});
