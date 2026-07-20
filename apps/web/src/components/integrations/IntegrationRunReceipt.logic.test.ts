import { describe, expect, it } from "@effect/vitest";
import type { IntegrationInspectRunResult, IntegrationRun } from "@notcodex/contracts";

import {
  deriveIntegrationRunControls,
  getOrCreateIntegrationRetryRequest,
  integrationRunOperationConfirmation,
  makeIntegrationRetryRequestId,
  shouldAutoRefreshIntegrationRunReceipt,
} from "./IntegrationRunReceipt.logic";

const run = {
  id: "monkey-run-1",
  source: "monkey-d-loopy",
  state: "waiting",
  projectId: null,
  parentRunId: null,
  attempt: 0,
  threadIds: [],
  journalRef: "journal-1",
  outputSummary: null,
  failure: null,
  verification: null,
  timeline: [],
  createdAt: "2026-07-19T10:00:00.000Z",
  startedAt: "2026-07-19T10:00:01.000Z",
  completedAt: null,
  updatedAt: "2026-07-19T10:00:02.000Z",
} satisfies IntegrationRun;

const inspection = {
  run,
  runtime: {
    live: true,
    phase: "waiting",
    recoverable: true,
    progress: {
      agentCallsStarted: 1,
      agentCallsCompleted: 1,
      activeStep: null,
      activeThreadId: null,
      linkedThreadIds: [],
    },
    caps: null,
    diagnostics: [],
  },
  operations: {
    cancel: { allowed: true, reason: null },
    resume: { allowed: true, reason: null },
    retry: { allowed: false, reason: "Only failed or cancelled runs can be retried." },
  },
} satisfies IntegrationInspectRunResult;

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

describe("IntegrationRunReceipt logic", () => {
  it("shows only server-authorized operations", () => {
    expect(
      deriveIntegrationRunControls({
        inspection,
        connected: true,
        queryPending: false,
        pendingOperation: null,
      }),
    ).toEqual([
      { operation: "cancel", disabled: false, disabledReason: null },
      { operation: "resume", disabled: false, disabledReason: null },
    ]);
  });

  it("never enables stale, offline, or competing controls", () => {
    const offline = deriveIntegrationRunControls({
      inspection,
      connected: false,
      queryPending: false,
      pendingOperation: null,
    });
    const stale = deriveIntegrationRunControls({
      inspection,
      connected: true,
      queryPending: true,
      pendingOperation: null,
    });
    const submitting = deriveIntegrationRunControls({
      inspection,
      connected: true,
      queryPending: false,
      pendingOperation: "resume",
    });

    expect(offline.every((control) => control.disabled)).toBe(true);
    expect(stale.every((control) => control.disabled)).toBe(true);
    expect(submitting.every((control) => control.disabled)).toBe(true);
  });

  it("explains same-journal resume and linked retry consequences", () => {
    expect(integrationRunOperationConfirmation("resume", run).description).toContain(
      "approve the current cap breakpoint",
    );
    expect(
      integrationRunOperationConfirmation("retry", { ...run, state: "failed" }).consequence,
    ).toContain("explicit parent link");
  });

  it("creates a contract-safe idempotency key for retry", () => {
    expect(makeIntegrationRetryRequestId("123e4567-e89b-12d3-a456-426614174000")).toBe(
      "retry-123e4567e89b12d3a456426614174000",
    );
  });

  it("reuses a retry idempotency key until the source run changes", () => {
    const first = getOrCreateIntegrationRetryRequest(
      null,
      "source-1",
      "123e4567-e89b-12d3-a456-426614174000",
    );
    const repeated = getOrCreateIntegrationRetryRequest(
      first,
      "source-1",
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    const nextSource = getOrCreateIntegrationRetryRequest(
      repeated,
      "source-2",
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );

    expect(repeated).toBe(first);
    expect(nextSource).not.toBe(first);
    expect(nextSource.sourceRunId).toBe("source-2");
    expect(nextSource.requestId).not.toBe(first.requestId);
  });
});
