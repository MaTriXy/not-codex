import { describe, expect, it } from "vite-plus/test";

import { isCurrentLoopSpecExecutionReady, parseRunInputsJson } from "./IntegrationsRun.logic";

describe("LoopSpec launch form", () => {
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

  it("invalidates readiness when the YAML changes after validation", () => {
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
});
