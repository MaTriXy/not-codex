import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  makeClaudeCapabilitiesCacheKey,
  makeClaudeContinuationGroupKey,
  makeClaudeEnvironment,
  resolveClaudeHomePath,
} from "./ClaudeHome.ts";

it.layer(NodeServices.layer)("ClaudeHome", (it) => {
  describe("Claude home resolution", () => {
    it.effect("uses the process home when no Claude home override is configured", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir());

        expect(yield* resolveClaudeHomePath({ homePath: "" })).toBe(resolved);
        expect(yield* makeClaudeEnvironment({ homePath: "" })).toBe(process.env);
      }),
    );

    it.effect("resolves CLAUDE_CONFIG_DIR without replacing HOME", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const homePath = "~/.claude-work";
        const resolved = path.resolve(NodeOS.homedir(), ".claude-work");
        const baseEnv = { HOME: "/Users/notcodex", PATH: "/usr/bin" };

        expect(yield* resolveClaudeHomePath({ homePath })).toBe(resolved);
        expect(yield* makeClaudeEnvironment({ homePath }, baseEnv)).toEqual({
          ...baseEnv,
          CLAUDE_CONFIG_DIR: path.join(resolved, ".claude"),
        });
        expect(yield* makeClaudeContinuationGroupKey({ homePath })).toBe(`claude:home:${resolved}`);
        expect(yield* makeClaudeCapabilitiesCacheKey({ binaryPath: "claude", homePath })).toBe(
          `claude\0${resolved}`,
        );
      }),
    );

    it.effect("keeps continuation compatible across instances with the same Claude config", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir());

        expect(yield* makeClaudeContinuationGroupKey({ homePath: "" })).toBe(
          `claude:home:${resolved}`,
        );
      }),
    );

    it.effect("migrates legacy root state without overwriting config-directory state", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const legacyHomePath = yield* fs.makeTempDirectoryScoped({
          prefix: "notcodex-claude-home-",
        });
        const legacyStatePath = path.join(legacyHomePath, ".claude.json");
        const configStatePath = path.join(legacyHomePath, ".claude", ".claude.json");
        const legacyState = '{"oauthAccount":{"email":"legacy@example.com"}}';

        yield* fs.writeFileString(legacyStatePath, legacyState);
        yield* makeClaudeEnvironment({ homePath: legacyHomePath }, { HOME: "/Users/notcodex" });

        expect(yield* fs.readFileString(configStatePath)).toBe(legacyState);

        yield* fs.writeFileString(legacyStatePath, '{"oauthAccount":{"email":"new@example.com"}}');
        yield* makeClaudeEnvironment({ homePath: legacyHomePath }, { HOME: "/Users/notcodex" });

        expect(yield* fs.readFileString(configStatePath)).toBe(legacyState);
      }).pipe(Effect.scoped),
    );
  });
});
