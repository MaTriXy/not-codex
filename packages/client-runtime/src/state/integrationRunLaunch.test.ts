import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_MONKEY_LOOPY_SPEC,
  isCurrentLoopSpecExecutionReady,
  isCurrentLoopSpecRequest,
  LOOPY_RUNTIME_MODE_OPTIONS,
  normalizeIntegrationRunTimeout,
  parseRunInputsJson,
} from "./integrationRunLaunch.ts";

describe("integration run launch", () => {
  it("provides one bounded Not Codex starter spec to every client", () => {
    expect(DEFAULT_MONKEY_LOOPY_SPEC).toContain("harness: not-codex");
    expect(DEFAULT_MONKEY_LOOPY_SPEC).toContain("max_iterations: 2");
  });

  it("offers only Loopy modes that can run without interactive approvals", () => {
    expect(LOOPY_RUNTIME_MODE_OPTIONS.map((option) => option.value)).toEqual([
      "auto-accept-edits",
      "full-access",
    ]);
  });

  it("accepts only JSON object inputs", () => {
    expect(parseRunInputsJson("")).toEqual({ ok: true, value: {} });
    expect(parseRunInputsJson('{"branch":"main","attempts":2}')).toEqual({
      ok: true,
      value: { branch: "main", attempts: 2 },
    });
    expect(parseRunInputsJson("[]")).toEqual({
      ok: false,
      message: "Inputs must be a JSON object keyed by input name.",
    });
    expect(parseRunInputsJson("{").ok).toBe(false);
  });

  it("invalidates readiness when YAML changes after validation", () => {
    const validation = {
      valid: true,
      verified: true,
      executionReady: true,
      score: 100,
      name: "Review",
      factoryVersion: "0.5.0",
      executionVersion: "0.5.0",
      diagnostics: [],
    } as const;
    expect(
      isCurrentLoopSpecExecutionReady({ yaml: "spec-a", validatedYaml: "spec-a", validation }),
    ).toBe(true);
    expect(
      isCurrentLoopSpecExecutionReady({ yaml: "spec-b", validatedYaml: "spec-a", validation }),
    ).toBe(false);
  });

  it("rejects validation results after their request generation is invalidated", () => {
    expect(isCurrentLoopSpecRequest({ requestSequence: 4, currentRequestSequence: 4 })).toBe(true);
    expect(isCurrentLoopSpecRequest({ requestSequence: 4, currentRequestSequence: 5 })).toBe(false);
  });

  it("normalizes timeout limits before sending the request", () => {
    expect(normalizeIntegrationRunTimeout(Number.NaN)).toBe(30);
    expect(normalizeIntegrationRunTimeout(0)).toBe(1);
    expect(normalizeIntegrationRunTimeout(12.6)).toBe(13);
    expect(normalizeIntegrationRunTimeout(500)).toBe(240);
  });
});
