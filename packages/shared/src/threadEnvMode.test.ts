import { describe, expect, it } from "vite-plus/test";

import { resolveDefaultThreadEnvMode } from "./threadEnvMode.ts";

describe("resolveDefaultThreadEnvMode", () => {
  it("prefers the project setting over the environment default", () => {
    expect(
      resolveDefaultThreadEnvMode({ projectSetting: "local", globalDefault: "worktree" }),
    ).toBe("local");
    expect(
      resolveDefaultThreadEnvMode({ projectSetting: "worktree", globalDefault: "local" }),
    ).toBe("worktree");
  });

  it("uses the environment default when the project has no override", () => {
    expect(resolveDefaultThreadEnvMode({ projectSetting: null, globalDefault: "worktree" })).toBe(
      "worktree",
    );
    expect(resolveDefaultThreadEnvMode({ projectSetting: undefined, globalDefault: "local" })).toBe(
      "local",
    );
  });
});
