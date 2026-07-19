import { describe, expect, it } from "vite-plus/test";

import {
  INTEGRATION_RUN_RETENTION_DAYS,
  integrationRunRetentionCutoff,
  sanitizeIntegrationRunText,
} from "./integrationRun.ts";

describe("integration run summaries", () => {
  it("redacts common credential forms and enforces the persistence bound", () => {
    const sanitized = sanitizeIntegrationRunText(
      "Bearer abc.def token=secret-value password: hunter2 " +
        "OPENAI_API_KEY=sk-openai GITHUB_TOKEN=ghp_github " +
        "AWS_SECRET_ACCESS_KEY=aws-secret harmless=value " +
        '{"OPENAI_API_KEY":"sk-json","token":"json-token","harmless":"json-value"} ' +
        "{'password':'json-password'} " +
        "x".repeat(100),
      300,
    );

    expect(sanitized).not.toContain("abc.def");
    expect(sanitized).not.toContain("secret-value");
    expect(sanitized).not.toContain("hunter2");
    expect(sanitized).not.toContain("sk-openai");
    expect(sanitized).not.toContain("ghp_github");
    expect(sanitized).not.toContain("aws-secret");
    expect(sanitized).not.toContain("sk-json");
    expect(sanitized).not.toContain("json-token");
    expect(sanitized).not.toContain("json-password");
    expect(sanitized).toContain("harmless=value");
    expect(sanitized).toContain('"harmless":"json-value"');
    expect(sanitized.length).toBeLessThanOrEqual(300);
  });

  it("uses a stable bounded retention window", () => {
    expect(INTEGRATION_RUN_RETENTION_DAYS).toBe(90);
    expect(integrationRunRetentionCutoff("2026-07-19T00:00:00.000Z")).toBe(
      "2026-04-20T00:00:00.000Z",
    );
  });
});
