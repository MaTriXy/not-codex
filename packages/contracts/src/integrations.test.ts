import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  IntegrationRpcSchemas,
  IntegrationRunOperations,
  IntegrationRunRuntimeSnapshot,
  LoopAnyConfigureInput,
  LoopAnyConnectorDiagnostics,
  LoopAnySettings,
  MonkeyLoopyRunInput,
  MonkeyLoopyValidateInput,
} from "./integrations.ts";
import { ProjectId, ProviderInstanceId } from "./index.ts";

const decodeLoopAnySettings = Schema.decodeUnknownSync(LoopAnySettings);
const decodeLoopAnyConfigureInput = Schema.decodeUnknownSync(LoopAnyConfigureInput);
const decodeMonkeyLoopyValidateInput = Schema.decodeUnknownSync(MonkeyLoopyValidateInput);
const decodeMonkeyLoopyRunInput = Schema.decodeUnknownSync(MonkeyLoopyRunInput);
const decodeIntegrationListInput = Schema.decodeUnknownSync(IntegrationRpcSchemas.list.input);
const decodeMonkeyLoopyAuthoringContextInput = Schema.decodeUnknownSync(
  IntegrationRpcSchemas.getMonkeyLoopyAuthoringContext.input,
);
const decodeTestLoopAnyInput = Schema.decodeUnknownSync(IntegrationRpcSchemas.testLoopAny.input);
const decodeRuntimeSnapshot = Schema.decodeUnknownSync(IntegrationRunRuntimeSnapshot);
const decodeRunOperations = Schema.decodeUnknownSync(IntegrationRunOperations);
const decodeLoopAnyDiagnostics = Schema.decodeUnknownSync(LoopAnyConnectorDiagnostics);

describe("integration contracts", () => {
  it("uses JSON-safe null payloads for integration reads without input", () => {
    expect(decodeIntegrationListInput(null)).toBeNull();
    expect(decodeMonkeyLoopyAuthoringContextInput(null)).toBeNull();
    expect(decodeTestLoopAnyInput(null)).toBeNull();
  });

  it("decodes safe LoopAny defaults without a credential field", () => {
    const settings = decodeLoopAnySettings({});
    expect(settings).toEqual({
      enabled: false,
      serverUrl: "",
      allowedRoots: [],
      pollWaitSeconds: 25,
    });
    expect("token" in settings).toBe(false);
  });

  it("accepts a write-only token update separately from persisted settings", () => {
    const input = decodeLoopAnyConfigureInput({
      settings: { serverUrl: "https://loop.example", enabled: true },
      token: "device-secret",
    });
    expect(input.token).toBe("device-secret");
    expect("token" in input.settings).toBe(false);
  });

  it("bounds untrusted Loopy specs", () => {
    expect(() => decodeMonkeyLoopyValidateInput({ yaml: "x".repeat(1_000_001) })).toThrow();
  });

  it("bounds LoopAny URLs, roots, and credentials", () => {
    expect(() =>
      decodeLoopAnyConfigureInput({ settings: { serverUrl: "x".repeat(4_097) } }),
    ).toThrow();
    expect(() =>
      decodeLoopAnyConfigureInput({ settings: { allowedRoots: Array(65).fill("/workspace") } }),
    ).toThrow();
    expect(() => decodeLoopAnyConfigureInput({ settings: {}, token: "x".repeat(4_097) })).toThrow();
  });

  it("applies conservative runtime defaults to Loopy runs", () => {
    const run = decodeMonkeyLoopyRunInput({
      requestId: "request-12345678",
      projectId: ProjectId.make("project-1"),
      yaml: "name: sample",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    });
    expect(run.runtimeMode).toBe("approval-required");
    expect(run.timeoutMinutes).toBe(30);
    expect(run.inputs).toEqual({});
  });

  it("requires a bounded retry-safe Loopy launch id", () => {
    expect(() =>
      decodeMonkeyLoopyRunInput({
        requestId: "contains spaces",
        projectId: ProjectId.make("project-1"),
        yaml: "name: sample",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      }),
    ).toThrow();
  });

  it("bounds inspect diagnostics and excludes arbitrary runtime state", () => {
    const snapshot = decodeRuntimeSnapshot({
      live: true,
      phase: "agent",
      recoverable: true,
      progress: {
        agentCallsStarted: 1,
        agentCallsCompleted: 0,
        activeStep: "Not Codex agent turn",
        activeThreadId: "thread-1",
        linkedThreadIds: ["thread-1"],
      },
      caps: {
        maxIterations: 5,
        noProgressMaxRepeats: null,
        tokenBudget: null,
        usdBudget: null,
        wallclockBudget: "10m",
        onCapExceeded: "fail",
      },
      diagnostics: ["Runtime prepared"],
      state: { secret: "must not cross the contract" },
    });

    expect(snapshot).not.toHaveProperty("state");
    expect(() =>
      decodeRuntimeSnapshot({ ...snapshot, diagnostics: Array(21).fill("bounded") }),
    ).toThrow();
  });

  it("bounds state-aware run operation reasons", () => {
    const operations = decodeRunOperations({
      cancel: { allowed: true, reason: null },
      resume: { allowed: false, reason: "Only waiting runs can resume." },
      retry: { allowed: false, reason: "Only failed runs can retry." },
    });
    expect(operations.cancel.allowed).toBe(true);
    expect(() =>
      decodeRunOperations({
        ...operations,
        cancel: { allowed: false, reason: "x".repeat(501) },
      }),
    ).toThrow();
  });

  it("bounds sanitized LoopAny connector diagnostics and recent events", () => {
    const diagnostics = decodeLoopAnyDiagnostics({
      health: "backing-off",
      protocolVersion: "2026-07",
      serverVersion: null,
      lastPollAt: "2026-07-19T10:00:00.000Z",
      lastSuccessAt: null,
      nextRetryAt: "2026-07-19T10:00:03.000Z",
      consecutiveFailures: 1,
      inFlight: 0,
      lastError: {
        code: "poll-failed",
        message: "LoopAny could not be reached; polling will retry.",
        occurredAt: "2026-07-19T10:00:00.000Z",
      },
      recentEvents: [],
      updatedAt: "2026-07-19T10:00:00.000Z",
    });

    expect(diagnostics.health).toBe("backing-off");
    expect(() =>
      decodeLoopAnyDiagnostics({
        ...diagnostics,
        recentEvents: Array.from({ length: 51 }, (_, index) => ({
          id: `event-${index}`,
          severity: "info",
          code: "poll-succeeded",
          summary: "Delivery poll succeeded",
          runId: null,
          occurredAt: "2026-07-19T10:00:00.000Z",
        })),
      }),
    ).toThrow();
  });
});
