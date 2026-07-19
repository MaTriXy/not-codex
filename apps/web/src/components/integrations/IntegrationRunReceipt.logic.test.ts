import { describe, expect, it } from "vite-plus/test";

import { shouldAutoRefreshIntegrationRunReceipt } from "./IntegrationRunReceipt.logic";

describe("Integration run receipt refresh policy", () => {
  it.each(["queued", "running", "waiting"] as const)("refreshes an active %s run", (state) => {
    expect(shouldAutoRefreshIntegrationRunReceipt({ state, isPending: false, error: null })).toBe(
      true,
    );
  });

  it.each(["succeeded", "failed", "cancelled"] as const)(
    "stops refreshing a settled %s run",
    (state) => {
      expect(shouldAutoRefreshIntegrationRunReceipt({ state, isPending: false, error: null })).toBe(
        false,
      );
    },
  );

  it("stops refreshing missing, pending, and failed queries", () => {
    expect(
      shouldAutoRefreshIntegrationRunReceipt({ state: null, isPending: false, error: null }),
    ).toBe(false);
    expect(
      shouldAutoRefreshIntegrationRunReceipt({ state: "running", isPending: true, error: null }),
    ).toBe(false);
    expect(
      shouldAutoRefreshIntegrationRunReceipt({
        state: "running",
        isPending: false,
        error: "offline",
      }),
    ).toBe(false);
  });
});
