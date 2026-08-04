import { describe, expect, it } from "vite-plus/test";

import {
  appendOpenKrittDiagnosticEvent,
  redactOpenKrittDiagnostic,
  sanitizeOpenKrittDiagnostics,
} from "./openKrittDiagnostics.ts";
import { OPEN_KRITT_TEST_TOKEN } from "./test/openKrittTestFixtures.ts";

describe("Open Kritt persisted diagnostics", () => {
  it("redacts tokens, response bodies, absolute paths, and arbitrary upstream data", () => {
    const event = redactOpenKrittDiagnostic({
      code: "request-failed",
      message: `Bearer ${OPEN_KRITT_TEST_TOKEN} at /Users/alice/project`,
      responseBody: { secret: "do-not-store" },
      stack: "raw stack",
    });

    expect(JSON.stringify(event)).not.toContain(OPEN_KRITT_TEST_TOKEN);
    expect(JSON.stringify(event)).not.toContain("/Users/alice/project");
    expect(JSON.stringify(event)).not.toContain("do-not-store");
    expect(event).not.toHaveProperty("responseBody");
    expect(event).not.toHaveProperty("stack");
  });

  it("keeps health/freshness diagnostics bounded and safe during connection loss", () => {
    const diagnostics = sanitizeOpenKrittDiagnostics({
      health: "stale",
      lastSuccessfulContact: "2026-08-04T10:00:00.000Z",
      nextRetryAt: "2026-08-04T10:00:03.000Z",
      compatibilityVersion: "open-kritt-v1.2.0",
      serverVersion: null,
      recentEvents: [],
    });
    expect(diagnostics).toMatchObject({ health: "stale", serverVersion: null });
    expect(() =>
      sanitizeOpenKrittDiagnostics({
        ...diagnostics,
        recentEvents: Array.from({ length: 51 }, () => ({})),
      }),
    ).toThrow();
  });

  it("retains only the most recent bounded events and never logs bearer tokens", () => {
    let current = sanitizeOpenKrittDiagnostics({
      health: "healthy",
      lastSuccessfulContact: "2026-08-04T10:00:00.000Z",
      nextRetryAt: null,
      compatibilityVersion: "open-kritt-v1.2.0",
      serverVersion: null,
      recentEvents: [],
    });
    for (let index = 0; index < 75; index += 1) {
      current = appendOpenKrittDiagnosticEvent(current, {
        code: "poll-succeeded",
        summary: `event-${index} ${OPEN_KRITT_TEST_TOKEN}`,
        severity: "info",
      });
    }
    expect(current.recentEvents).toHaveLength(50);
    expect(JSON.stringify(current)).not.toContain(OPEN_KRITT_TEST_TOKEN);
  });
});
