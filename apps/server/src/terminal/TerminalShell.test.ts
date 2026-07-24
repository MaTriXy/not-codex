import { describe, expect, it } from "vite-plus/test";

import { PtySpawnError } from "./PtyAdapter.ts";
import {
  createTerminalSpawnEnv,
  defaultShellResolver,
  formatShellCandidate,
  isRetryableShellSpawnError,
  normalizeTerminalRuntimeEnv,
  resolveShellCandidates,
} from "./TerminalShell.ts";

describe("resolveShellCandidates", () => {
  it("prefers the requested POSIX shell and de-duplicates fallbacks", () => {
    expect(
      resolveShellCandidates(() => "'/bin/zsh' --login", "darwin", { SHELL: "/bin/zsh" }),
    ).toEqual([
      { shell: "/bin/zsh", args: ["-o", "nopromptsp"] },
      { shell: "/bin/bash" },
      { shell: "/bin/sh" },
      { shell: "zsh", args: ["-o", "nopromptsp"] },
      { shell: "bash" },
      { shell: "sh" },
    ]);
  });

  it("includes absolute Windows fallbacks from the configured system root", () => {
    expect(
      resolveShellCandidates(() => "pwsh.exe", "win32", {
        SystemRoot: "D:\\Windows",
        ComSpec: "D:\\Windows\\System32\\cmd.exe",
      }),
    ).toEqual([
      { shell: "pwsh.exe", args: ["-NoLogo"] },
      {
        shell: "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        args: ["-NoLogo"],
      },
      { shell: "powershell.exe", args: ["-NoLogo"] },
      { shell: "D:\\Windows\\System32\\cmd.exe" },
      { shell: "cmd.exe" },
    ]);
  });
});

describe("terminal shell environment", () => {
  it("uses platform defaults when no shell is configured", () => {
    expect(defaultShellResolver("linux", {})).toBe("bash");
    expect(defaultShellResolver("win32", {})).toBe("pwsh.exe");
  });

  it("removes application-only variables before applying explicit runtime variables", () => {
    expect(
      createTerminalSpawnEnv(
        {
          HOME: "/tmp/home",
          PORT: "3000",
          NOT_CODEX_SECRET: "hidden",
          VITE_API_URL: "hidden",
        },
        { PORT: "4100", CUSTOM: "visible" },
      ),
    ).toEqual({ HOME: "/tmp/home", PORT: "4100", CUSTOM: "visible" });
  });

  it("normalizes runtime variables for stable equality checks", () => {
    expect(normalizeTerminalRuntimeEnv(undefined)).toBeNull();
    expect(normalizeTerminalRuntimeEnv({})).toBeNull();
    expect(normalizeTerminalRuntimeEnv({ ZED: "2", ALPHA: "1" })).toEqual({
      ALPHA: "1",
      ZED: "2",
    });
  });
});

describe("shell spawn failures", () => {
  it("recognizes retryable nested executable lookup failures", () => {
    expect(
      isRetryableShellSpawnError(
        new PtySpawnError({
          adapter: "test",
          cause: new Error("wrapper", { cause: new Error("spawn ENOENT") }),
        }),
      ),
    ).toBe(true);
    expect(
      isRetryableShellSpawnError(
        new PtySpawnError({ adapter: "test", cause: new Error("permission denied") }),
      ),
    ).toBe(false);
  });

  it("formats candidates for diagnostics", () => {
    expect(formatShellCandidate({ shell: "/bin/zsh", args: ["-o", "nopromptsp"] })).toBe(
      "/bin/zsh -o nopromptsp",
    );
  });
});
