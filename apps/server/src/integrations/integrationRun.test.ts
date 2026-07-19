import { describe, expect, it } from "vite-plus/test";

import {
  buildInterruptedIntegrationRun,
  INTEGRATION_RUN_RETENTION_DAYS,
  INTERRUPTED_INTEGRATION_RUN_FAILURE,
  integrationRunRetentionCutoff,
  sanitizeIntegrationRunText,
} from "./integrationRun.ts";
import { IntegrationRun } from "@notcodex/contracts";

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

  it("builds a terminal cancellation record for interrupted work", () => {
    const running = IntegrationRun.make({
      id: "interrupted-run",
      source: "loopany",
      state: "running",
      projectId: null,
      parentRunId: null,
      attempt: 0,
      threadIds: [],
      journalRef: null,
      outputSummary: null,
      failure: null,
      createdAt: "2026-07-19T10:00:00.000Z",
      startedAt: "2026-07-19T10:01:00.000Z",
      completedAt: null,
      updatedAt: "2026-07-19T10:01:00.000Z",
    });

    expect(buildInterruptedIntegrationRun(running, "2026-07-19T10:02:00.000Z")).toMatchObject({
      state: "cancelled",
      failure: INTERRUPTED_INTEGRATION_RUN_FAILURE,
      completedAt: "2026-07-19T10:02:00.000Z",
      updatedAt: "2026-07-19T10:02:00.000Z",
    });
  });
});
