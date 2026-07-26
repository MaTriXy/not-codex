import * as NodeOS from "node:os";

import type { ClaudeSettings } from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { expandHomePath } from "../../pathExpansion.ts";

export const resolveClaudeHomePath = Effect.fn("resolveClaudeHomePath")(function* (
  config: Pick<ClaudeSettings, "homePath">,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const homePath = config.homePath.trim();
  return path.resolve(homePath.length > 0 ? expandHomePath(homePath) : NodeOS.homedir());
});

const migrateLegacyClaudeState = Effect.fn("migrateLegacyClaudeState")(
  function* (legacyHomePath: string, configDir: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const legacyStatePath = path.join(legacyHomePath, ".claude.json");
    const configStatePath = path.join(configDir, ".claude.json");
    const [legacyStateExists, configStateExists] = yield* Effect.all([
      fs.exists(legacyStatePath),
      fs.exists(configStatePath),
    ]);

    if (!legacyStateExists || configStateExists) return;

    yield* fs.makeDirectory(configDir, { recursive: true });
    yield* fs.copyFile(legacyStatePath, configStatePath);
  },
  Effect.catch((cause) =>
    Effect.logWarning("Could not migrate legacy Claude instance state", { cause }),
  ),
);

export const makeClaudeEnvironment = Effect.fn("makeClaudeEnvironment")(function* (
  config: Pick<ClaudeSettings, "homePath">,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<NodeJS.ProcessEnv, never, FileSystem.FileSystem | Path.Path> {
  const resolvedBaseEnv = baseEnv ?? process.env;
  const homePath = config.homePath.trim();
  if (homePath.length === 0) return resolvedBaseEnv;
  const resolvedHomePath = yield* resolveClaudeHomePath(config);
  const path = yield* Path.Path;
  const configDir = path.join(resolvedHomePath, ".claude");
  yield* migrateLegacyClaudeState(resolvedHomePath, configDir);
  return {
    ...resolvedBaseEnv,
    // Isolate this instance's config via CLAUDE_CONFIG_DIR rather than HOME.
    // Overriding HOME also relocates the macOS login keychain lookup
    // ($HOME/Library/Keychains), so the spawned CLI cannot find its stored
    // OAuth credentials. Keep HOME intact while preserving the historical
    // homePath layout, where Claude data lives under the root's .claude dir.
    CLAUDE_CONFIG_DIR: configDir,
  };
});

export const makeClaudeContinuationGroupKey = Effect.fn("makeClaudeContinuationGroupKey")(
  function* (config: Pick<ClaudeSettings, "homePath">): Effect.fn.Return<string, never, Path.Path> {
    const resolvedHomePath = yield* resolveClaudeHomePath(config);
    return `claude:home:${resolvedHomePath}`;
  },
);

export const makeClaudeCapabilitiesCacheKey = Effect.fn("makeClaudeCapabilitiesCacheKey")(
  function* (
    config: Pick<ClaudeSettings, "binaryPath" | "homePath">,
  ): Effect.fn.Return<string, never, Path.Path> {
    const resolvedHomePath = yield* resolveClaudeHomePath(config);
    return `${config.binaryPath}\0${resolvedHomePath}`;
  },
);
