import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  LoopAnyConfigureInput,
  LoopAnySettings,
  MonkeyLoopyRunInput,
  MonkeyLoopyValidateInput,
} from "./integrations.ts";
import { ProjectId, ProviderInstanceId } from "./index.ts";

const decodeLoopAnySettings = Schema.decodeUnknownSync(LoopAnySettings);
const decodeLoopAnyConfigureInput = Schema.decodeUnknownSync(LoopAnyConfigureInput);
const decodeMonkeyLoopyValidateInput = Schema.decodeUnknownSync(MonkeyLoopyValidateInput);
const decodeMonkeyLoopyRunInput = Schema.decodeUnknownSync(MonkeyLoopyRunInput);

describe("integration contracts", () => {
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
      projectId: ProjectId.make("project-1"),
      yaml: "name: sample",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    });
    expect(run.runtimeMode).toBe("approval-required");
    expect(run.timeoutMinutes).toBe(30);
    expect(run.inputs).toEqual({});
  });
});
