import { describe, expect, it } from "vite-plus/test";

import { CLAUDE_PROVIDER_CAPABILITY_SETTING_SOURCES } from "./ClaudeProvider.ts";

describe("Claude provider capability scope", () => {
  it("publishes only user-scoped commands in the provider-wide snapshot", () => {
    expect(CLAUDE_PROVIDER_CAPABILITY_SETTING_SOURCES).toEqual(["user"]);
  });
});
