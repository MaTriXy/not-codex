import { describe, expect, it } from "vite-plus/test";

import {
  INTEGRATION_RUN_RETENTION_DAYS,
  integrationRunRetentionCutoff,
  sanitizeIntegrationRunText,
} from "./integrationRun.ts";

describe("integration run summaries", () => {
  it("redacts common credential forms and enforces the persistence bound", () => {
    const sanitized = sanitizeIntegrationRunText(
      "Bearer abc.def token=secret-value password: hunter2 " + "x".repeat(100),
      80,
    );

    expect(sanitized).not.toContain("abc.def");
    expect(sanitized).not.toContain("secret-value");
    expect(sanitized).not.toContain("hunter2");
    expect(sanitized.length).toBeLessThanOrEqual(80);
  });

  it("uses a stable bounded retention window", () => {
    expect(INTEGRATION_RUN_RETENTION_DAYS).toBe(90);
    expect(integrationRunRetentionCutoff("2026-07-19T00:00:00.000Z")).toBe(
      "2026-04-20T00:00:00.000Z",
    );
  });
});
