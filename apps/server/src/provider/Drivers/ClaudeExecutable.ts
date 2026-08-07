// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { HostProcessPlatform } from "@notcodex/shared/hostProcess";
import { SpawnExecutableResolution } from "@notcodex/shared/shell";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/**
 * Windows launcher scripts cannot be spawned directly by the Claude Agent SDK.
 */
const WINDOWS_SHIM_EXTENSIONS: ReadonlySet<string> = new Set([".cmd", ".bat", ".ps1"]);

/**
 * Known npm package entry points, relative to the directory containing the
 * global npm launcher shim. Prefer the native binary when it is available.
 */
const NPM_PACKAGE_ENTRY_CANDIDATES = [
  ["node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"],
  ["node_modules", "@anthropic-ai", "claude-code", "cli.js"],
] as const;

export type ExecutableFileCheck = (filePath: string) => boolean;

function isExistingFile(filePath: string): boolean {
  try {
    return NodeFS.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** Injectable file check so Windows resolution can be tested on every host. */
export const ClaudeExecutableFileCheck = Context.Reference<ExecutableFileCheck>(
  "server/provider/Drivers/ClaudeExecutableFileCheck",
  { defaultValue: () => isExistingFile },
);

/**
 * Resolve the configured Claude command to a path the Agent SDK can spawn.
 * On Windows, bare commands are resolved through PATH/PATHEXT and npm shims
 * are followed to the package's native executable or JavaScript entry point.
 */
export const resolveClaudeSdkExecutablePath = Effect.fn("resolveClaudeSdkExecutablePath")(
  function* (binaryPath: string, environment: NodeJS.ProcessEnv): Effect.fn.Return<string> {
    const platform = yield* HostProcessPlatform;
    if (platform !== "win32") {
      return binaryPath;
    }

    const resolveExecutable = yield* SpawnExecutableResolution;
    const isFile = yield* ClaudeExecutableFileCheck;
    const resolved = resolveExecutable(binaryPath, platform, environment) ?? binaryPath;
    const extension = NodePath.win32.extname(resolved).toLowerCase();
    if (!WINDOWS_SHIM_EXTENSIONS.has(extension)) {
      return resolved;
    }

    const shimDirectory = NodePath.win32.dirname(resolved);
    for (const entrySegments of NPM_PACKAGE_ENTRY_CANDIDATES) {
      const candidate = NodePath.win32.join(shimDirectory, ...entrySegments);
      if (isFile(candidate)) {
        return candidate;
      }
    }

    yield* Effect.logWarning(
      "Claude launcher shim resolved but no known package entry was found next to it; the Claude Agent SDK cannot spawn launcher scripts directly.",
      { binaryPath, resolvedShimPath: resolved },
    );
    return binaryPath;
  },
);
