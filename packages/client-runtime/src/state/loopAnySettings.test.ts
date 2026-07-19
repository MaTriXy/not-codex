import { describe, expect, it } from "vite-plus/test";

import { parseLoopAnyAllowedRoots, validateLoopAnySettingsDraft } from "./loopAnySettings.js";

describe("LoopAny settings", () => {
  it("trims and de-duplicates allowed roots", () => {
    expect(parseLoopAnyAllowedRoots(" /workspace \n/workspace\n C:\\code \n")).toEqual([
      "/workspace",
      "C:\\code",
    ]);
  });

  it("returns safe non-secret settings for a valid enabled draft", () => {
    const result = validateLoopAnySettingsDraft({
      enabled: true,
      serverUrl: " https://loop.example ",
      allowedRootsText: "/workspace",
      pollWaitSecondsText: "25",
      tokenConfigured: false,
      replacementToken: "write-only-secret",
    });

    expect(result).toEqual({
      ok: true,
      settings: {
        enabled: true,
        serverUrl: "https://loop.example",
        allowedRoots: ["/workspace"],
        pollWaitSeconds: 25,
      },
    });
    expect(JSON.stringify(result)).not.toContain("write-only-secret");
  });

  it("requires complete configuration before enabling", () => {
    expect(
      validateLoopAnySettingsDraft({
        enabled: true,
        serverUrl: "",
        allowedRootsText: "relative/path",
        pollWaitSecondsText: "4",
        tokenConfigured: false,
        replacementToken: "",
      }),
    ).toMatchObject({ ok: false });

    expect(
      validateLoopAnySettingsDraft({
        enabled: true,
        serverUrl: "https://loop.example",
        allowedRootsText: "/workspace",
        pollWaitSecondsText: "25",
        tokenConfigured: false,
        replacementToken: "",
      }),
    ).toEqual({ ok: false, message: "Enter a device token before enabling the connector." });
  });

  it("rejects credential-bearing and non-http server URLs", () => {
    const base = {
      enabled: false,
      allowedRootsText: "",
      pollWaitSecondsText: "25",
      tokenConfigured: false,
      replacementToken: "",
    } as const;
    expect(
      validateLoopAnySettingsDraft({ ...base, serverUrl: "https://secret@loop.example" }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("credentials") });
    expect(
      validateLoopAnySettingsDraft({ ...base, serverUrl: "file:///tmp/loopany" }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("HTTPS or HTTP") });
  });
});
