import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@notcodex/contracts";

import {
  isCurrentLoopSpecExecutionReady,
  isCurrentLoopSpecRequest,
  LOOPY_RUNTIME_MODE_OPTIONS,
  parseRunInputsJson,
  resolveRunEnvironmentSelection,
} from "./IntegrationsRun.logic";

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
      factoryVersion: "0.8.0",
      executionVersion: "0.8.0",
      diagnostics: [],
    } as const;
    expect(
      isCurrentLoopSpecExecutionReady({ yaml: "spec-a", validatedYaml: "spec-a", validation }),
    ).toBe(true);
    expect(
      isCurrentLoopSpecExecutionReady({ yaml: "spec-b", validatedYaml: "spec-a", validation }),
    ).toBe(false);
  });

  it("offers only permission modes that do not require an interactive approval flow", () => {
    expect(LOOPY_RUNTIME_MODE_OPTIONS.map((option) => option.value)).toEqual([
      "auto-accept-edits",
      "full-access",
    ]);
  });

  it("detects an automatic fallback after the selected environment disappears", () => {
    const removed = EnvironmentId.make("removed");
    const fallback = EnvironmentId.make("fallback");

    expect(
      resolveRunEnvironmentSelection({
        currentEnvironmentId: removed,
        primaryEnvironmentId: fallback,
        availableEnvironmentIds: [fallback],
      }),
    ).toEqual({ environmentId: fallback, changed: true });
    expect(
      resolveRunEnvironmentSelection({
        currentEnvironmentId: fallback,
        primaryEnvironmentId: fallback,
        availableEnvironmentIds: [fallback],
      }),
    ).toEqual({ environmentId: fallback, changed: false });
  });

  it("ignores validation responses superseded by an environment or YAML change", () => {
    expect(isCurrentLoopSpecRequest({ requestSequence: 4, currentRequestSequence: 4 })).toBe(true);
    expect(isCurrentLoopSpecRequest({ requestSequence: 4, currentRequestSequence: 5 })).toBe(false);
  });
});
