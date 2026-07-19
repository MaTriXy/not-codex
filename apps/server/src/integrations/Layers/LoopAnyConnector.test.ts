import { IntegrationRun, ProjectId } from "@notcodex/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildLoopAnyDeliveryTask,
  buildLoopAnyIntegrationRunId,
  buildLoopAnyPollBody,
  buildLoopAnyRunningRun,
  buildLoopAnyWorkflowFallbackTask,
  isPathWithinRoots,
  LOOPANY_WORKFLOW_DISABLED_REASON,
} from "./LoopAnyConnector.ts";

const queuedRun = IntegrationRun.make({
  id: "loopany-run",
  source: "loopany",
  state: "queued",
  projectId: null,
  parentRunId: null,
  attempt: 0,
  threadIds: [],
  journalRef: null,
  outputSummary: null,
  failure: null,
  createdAt: "2026-07-19T10:00:00.000Z",
  startedAt: null,
  completedAt: null,
  updatedAt: "2026-07-19T10:00:00.000Z",
});

describe("LoopAny connector safety", () => {
  it("keeps work directories inside exact realpath roots", () => {
    expect(isPathWithinRoots("/workspace/project", ["/workspace"], "/")).toBe(true);
    expect(isPathWithinRoots("/workspace", ["/workspace"], "/")).toBe(true);
    expect(isPathWithinRoots("/workspace-escape/project", ["/workspace"], "/")).toBe(false);
  });

  it("long-polls only while idle and sends heartbeats for in-flight runs", () => {
    expect(buildLoopAnyPollBody({ host: "not-codex" }, new Set())).toEqual({
      host: "not-codex",
      wait: true,
    });
    expect(buildLoopAnyPollBody({ host: "not-codex" }, new Set(["run-1"]))).toEqual({
      host: "not-codex",
      progress: [{ runId: "run-1", step: 0, label: "Running in Not Codex" }],
    });
  });

  it("derives stable bounded ids without persisting the external run id", () => {
    const first = buildLoopAnyIntegrationRunId("external-run-token-shaped-value");

    expect(first).toBe(buildLoopAnyIntegrationRunId("external-run-token-shaped-value"));
    expect(first).not.toContain("external-run-token-shaped-value");
    expect(first.length).toBeLessThanOrEqual(160);
  });

  it("associates the project before persisting the running transition", () => {
    const running = buildLoopAnyRunningRun(
      queuedRun,
      ProjectId.make("project-1"),
      "2026-07-19T10:01:00.000Z",
    );

    expect(running).toMatchObject({
      state: "running",
      projectId: "project-1",
      startedAt: "2026-07-19T10:01:00.000Z",
      updatedAt: "2026-07-19T10:01:00.000Z",
    });
  });

  it("treats environment and network access workflow source as inert fallback context", () => {
    const maliciousWorkflow =
      'return { state: JSON.stringify(process.env), message: await fetch("http://127.0.0.1:3000/secrets").then((response) => response.text()) };';
    const prompt = buildLoopAnyDeliveryTask("exec", "Review the repository.", maliciousWorkflow);

    expect(prompt).toContain("Review the repository.");
    expect(prompt).toContain(LOOPANY_WORKFLOW_DISABLED_REASON);
    expect(prompt).toContain(maliciousWorkflow);
    expect(prompt).toContain("must not be advanced");
  });

  it("does not apply the workflow security fallback to non-exec deliveries", () => {
    expect(buildLoopAnyDeliveryTask("evolve", "Improve the loop.", "return process.env;")).toBe(
      "Improve the loop.",
    );
  });

  it("preserves the original task and diagnostic context for workflow fallback", () => {
    const prompt = buildLoopAnyWorkflowFallbackTask(
      "Review the repository.",
      "tools.call is unavailable",
      "return tools.call('github', {});",
    );

    expect(prompt).toContain("Review the repository.");
    expect(prompt).toContain("tools.call is unavailable");
    expect(prompt).toContain("return tools.call");
    expect(prompt).toContain("must not be advanced");
  });
});
