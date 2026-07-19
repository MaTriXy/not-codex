import { describe, expect, it } from "@effect/vitest";

import { limitIntegrationRunOperationsToScope } from "./integrationRunOperations.ts";

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
