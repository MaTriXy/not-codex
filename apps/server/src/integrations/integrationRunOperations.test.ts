import { describe, expect, it } from "@effect/vitest";

import type { IntegrationRun } from "@notcodex/contracts";

import { INTERRUPTED_INTEGRATION_RUN_FAILURE } from "./integrationRun.ts";
import {
  integrationRunOperations,
  limitIntegrationRunOperationsToScope,
} from "./integrationRunOperations.ts";

const run = {
  id: "monkey-run-1",
  source: "monkey-d-loopy",
  state: "cancelled",
  projectId: null,
  parentRunId: null,
  attempt: 0,
  threadIds: [],
  journalRef: "journal-1",
  outputSummary: null,
  failure: INTERRUPTED_INTEGRATION_RUN_FAILURE,
  verification: null,
  timeline: [],
  createdAt: "2026-07-20T10:00:00.000Z",
  startedAt: "2026-07-20T10:00:01.000Z",
  completedAt: "2026-07-20T10:00:02.000Z",
  updatedAt: "2026-07-20T10:00:02.000Z",
} satisfies IntegrationRun;

describe("integration run operations", () => {
  it("allows resume for the persisted restart-interrupted state", () => {
    const operations = integrationRunOperations(run);

    expect(operations.resume.allowed).toBe(true);
    expect(operations.retry.allowed).toBe(true);
  });

  it("does not advertise resume for an unrelated failure", () => {
    const operations = integrationRunOperations({
      ...run,
      state: "failed",
      failure: "The live runtime was unavailable after a server restart.",
    });

    expect(operations.resume.allowed).toBe(false);
  });
});

describe("integration run operation scopes", () => {
  const operations = {
    cancel: { allowed: true, reason: null },
    resume: { allowed: true, reason: null },
    retry: { allowed: false, reason: "Only failed or cancelled runs can be retried." },
  } as const;

  it("preserves state-aware operations for operate sessions", () => {
    expect(limitIntegrationRunOperationsToScope(operations, true)).toBe(operations);
  });

  it("removes every mutation from read-only inspect responses", () => {
    const limited = limitIntegrationRunOperationsToScope(operations, false);
    expect(Object.values(limited).every((operation) => !operation.allowed)).toBe(true);
    expect(limited.cancel.reason).toBe("This connection has read-only orchestration access.");
  });
});
