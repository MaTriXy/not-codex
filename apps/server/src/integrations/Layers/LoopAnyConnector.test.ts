import { IntegrationRun, ProjectId, ThreadId } from "@notcodex/contracts";
import { describe, expect, it } from "vite-plus/test";
import { IntegrationRequestError } from "@notcodex/contracts";

import compatibilityFixture from "../fixtures/loopany-machine-2026-07.json" with { type: "json" };
import {
  assertLoopAnyCompatibilityFixture,
  LOOPANY_PROTOCOL_COMPATIBILITY,
} from "../loopanyCompatibility.ts";
import {
  acceptUniqueLoopAnyDeliveries,
  buildLoopAnyDeliveryTask,
  buildLoopAnyIntegrationRunId,
  buildLoopAnyPollBody,
  buildLoopAnyRecoveredTerminalReport,
  buildLoopAnyRunningRun,
  buildLoopAnyWorkflowFallbackTask,
  isPathWithinRoots,
  loopAnyDeliveryFailureDiagnostic,
  LOOPANY_WORKFLOW_DISABLED_REASON,
  shouldRetryLoopAnyReport,
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
  verification: null,
  timeline: [],
  createdAt: "2026-07-19T10:00:00.000Z",
  startedAt: null,
  completedAt: null,
  updatedAt: "2026-07-19T10:00:00.000Z",
});

describe("LoopAny connector safety", () => {
  it("pins the bounded public machine protocol fixture and redacts every auth role", () => {
    assertLoopAnyCompatibilityFixture(compatibilityFixture);
    expect(compatibilityFixture.metadata.authData).toBe("synthetic-and-redacted");
    expect(
      Object.values(compatibilityFixture.endpoints).every(
        (endpoint) => endpoint.authorization === "redacted",
      ),
    ).toBe(true);
    expect(compatibilityFixture.endpoints.status).toMatchObject({ positive: 200, negative: 401 });
    expect(compatibilityFixture.endpoints.poll).toMatchObject({ positive: 200, negative: 401 });
    expect(compatibilityFixture.endpoints.report).toMatchObject({
      positive: 200,
      negative: 403,
      transient: 503,
    });
  });

  it("fails incompatible fixture pins with an upgrade and live-proof diagnostic", () => {
    const incompatible = structuredClone(compatibilityFixture);
    incompatible.metadata.protocolVersion = "changed-without-review";

    expect(() => assertLoopAnyCompatibilityFixture(incompatible)).toThrow(
      "bump the protocol version and source revision together, update fixtures, then rerun live acceptance issue #14",
    );
  });

  it("covers all supported delivery roles, bounded inputs, and non-exec workflow rejection", () => {
    expect(compatibilityFixture.deliveries.exec).toMatchObject({
      positive: "agent-security-fallback",
      negative: "reject-malformed-delivery",
      workflow: "inert-source-context",
      cursor: "never-advanced-locally",
    });
    expect(compatibilityFixture.deliveries.evolve).toMatchObject({ workflow: "not-applicable" });
    expect(compatibilityFixture.deliveries.edit).toMatchObject({ workflow: "not-applicable" });
    expect(compatibilityFixture.deliveries.invalid).toMatchObject({
      negative: "reject-before-execution",
    });
    expect(compatibilityFixture.deliveries.rootEscape).toMatchObject({
      negative: "reject-before-execution",
    });
    expect(compatibilityFixture.limits).toEqual(LOOPANY_PROTOCOL_COMPATIBILITY.limits);
  });

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

  it("preserves the delivery outcome when replaying a recovered success", () => {
    const succeeded = IntegrationRun.make({
      ...queuedRun,
      state: "succeeded",
      threadIds: [ThreadId.make("thread-1")],
      outputSummary: "done",
      completedAt: "2026-07-19T10:02:00.000Z",
      updatedAt: "2026-07-19T10:02:00.000Z",
    });

    expect(buildLoopAnyRecoveredTerminalReport("evolve", succeeded)).toEqual({
      ok: true,
      durationMs: 0,
      outcome: "evolve",
      finalText: "done",
      sessionId: "thread-1",
    });
    expect(buildLoopAnyRecoveredTerminalReport("edit", succeeded)).toMatchObject({
      ok: true,
      outcome: "exec",
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

  it("ignores duplicate delivery ids and retries only transient terminal reports", () => {
    const inFlight = new Set<string>();
    expect(
      acceptUniqueLoopAnyDeliveries(
        [{ runId: "synthetic-run-1" }, { runId: "synthetic-run-1" }, { runId: "synthetic-run-2" }],
        inFlight,
      ),
    ).toEqual([{ runId: "synthetic-run-1" }, { runId: "synthetic-run-2" }]);
    expect(shouldRetryLoopAnyReport("connection-failed")).toBe(true);
    expect(shouldRetryLoopAnyReport("unauthorized")).toBe(false);
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

  it("classifies root-policy failures without exposing the rejected path", () => {
    const rootFailure = new IntegrationRequestError({
      code: "unauthorized",
      message: "LoopAny work directory is outside the locally allowed roots.",
    });
    const executionFailure = new IntegrationRequestError({
      code: "execution-failed",
      message: "Agent turn failed.",
    });

    expect(loopAnyDeliveryFailureDiagnostic(rootFailure)).toBe("root-rejected");
    expect(loopAnyDeliveryFailureDiagnostic(executionFailure)).toBe("execution-failed");
  });
});
