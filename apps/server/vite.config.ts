import "vite-plus/test/config";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";
import { loadRepoEnv } from "../../scripts/lib/public-config.ts";

const bundledPackagePrefixes = [
  "@pierre/diffs",
  "@notcodex/",
  "effect-acp",
  "effect-codex-app-server",
];

export function shouldBundleCliDependency(id: string): boolean {
  return bundledPackagePrefixes.some((prefix) => id.startsWith(prefix));
}

const repoEnv = loadRepoEnv();
const buildSourcemap =
  process.env.NOT_CODEX_SERVER_SOURCEMAP?.trim() === "hidden" ? "hidden" : false;

export default mergeConfig(
  baseConfig,
  defineConfig({
    run: {
      tasks: {
        build: {
          command: "node scripts/cli.ts build",
          dependsOn: ["@notcodex/web#build"],
          cache: false,
        },
      },
    },
    pack: {
      entry: ["src/bin.ts"],
      outDir: "dist",
      sourcemap: buildSourcemap,
      clean: true,
      deps: {
        alwaysBundle: shouldBundleCliDependency,
        onlyBundle: false,
      },
      banner: {
        js: "#!/usr/bin/env node\n",
      },
      define: {
        __NOT_CODEX_BUILD_RELAY_URL__: JSON.stringify(repoEnv.NOT_CODEX_RELAY_URL?.trim() ?? ""),
        __NOT_CODEX_BUILD_CLERK_PUBLISHABLE_KEY__: JSON.stringify(
          repoEnv.NOT_CODEX_CLERK_PUBLISHABLE_KEY?.trim() ?? "",
        ),
        __NOT_CODEX_BUILD_CLERK_CLI_OAUTH_CLIENT_ID__: JSON.stringify(
          repoEnv.NOT_CODEX_CLERK_CLI_OAUTH_CLIENT_ID?.trim() ?? "",
        ),
        __NOT_CODEX_BUILD_RELAY_CLIENT_OTLP_TRACES_URL__: JSON.stringify(
          repoEnv.NOT_CODEX_RELAY_CLIENT_OTLP_TRACES_URL?.trim() ?? "",
        ),
        __NOT_CODEX_BUILD_RELAY_CLIENT_OTLP_TRACES_DATASET__: JSON.stringify(
          repoEnv.NOT_CODEX_RELAY_CLIENT_OTLP_TRACES_DATASET?.trim() ?? "",
        ),
        __NOT_CODEX_BUILD_RELAY_CLIENT_OTLP_TRACES_TOKEN__: JSON.stringify(
          repoEnv.NOT_CODEX_RELAY_CLIENT_OTLP_TRACES_TOKEN?.trim() ?? "",
        ),
      },
    },
    test: {
      // The server suite exercises sqlite, git, temp worktrees, and orchestration
      // runtimes heavily. Running files in parallel introduces load-sensitive flakes.
      fileParallelism: false,
      // Server integration tests exercise sqlite, git, and orchestration together.
      // Under package-wide runs they can exceed the default budget on loaded CI hosts.
      hookTimeout: 120_000,
      testTimeout: 120_000,
    },
  }),
);
