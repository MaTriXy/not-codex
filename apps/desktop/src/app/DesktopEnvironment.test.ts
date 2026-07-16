import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/Not Codex.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/Not Codex.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const makeEnvironmentLayer = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest(env))));

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(makeEnvironmentLayer(overrides, env)));

describe("DesktopEnvironment", () => {
  it.effect("derives state paths and development identity inside Effect", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          NOT_CODEX_HOME: " /tmp/notcodex ",
          NOT_CODEX_COMMIT_HASH: " 0123456789abcdef ",
          NOT_CODEX_PORT: "4949",
          VITE_DEV_SERVER_URL: "http://localhost:5173",
          NOT_CODEX_DEV_REMOTE_NOT_CODEX_SERVER_ENTRY_PATH: " /remote/server.mjs ",
          NOT_CODEX_OTLP_TRACES_URL: " http://127.0.0.1:4318/v1/traces ",
          NOT_CODEX_OTLP_EXPORT_INTERVAL_MS: "2500",
        },
      );

      assert.equal(environment.isDevelopment, true);
      assert.equal(environment.appDataDirectory, "/Users/alice/Library/Application Support");
      assert.equal(environment.baseDir, "/tmp/notcodex");
      assert.equal(environment.stateDir, "/tmp/notcodex/dev");
      assert.equal(environment.desktopSettingsPath, "/tmp/notcodex/dev/desktop-settings.json");
      assert.equal(environment.clientSettingsPath, "/tmp/notcodex/dev/client-settings.json");
      assert.equal(
        environment.savedEnvironmentRegistryPath,
        "/tmp/notcodex/dev/saved-environments.json",
      );
      assert.equal(environment.serverSettingsPath, "/tmp/notcodex/dev/settings.json");
      assert.equal(environment.logDir, "/tmp/notcodex/dev/logs");
      assert.equal(environment.browserArtifactsDir, "/tmp/notcodex/dev/browser-artifacts");
      assert.equal(environment.rootDir, "/repo");
      assert.equal(environment.appRoot, "/repo");
      assert.equal(environment.backendEntryPath, "/repo/apps/server/dist/bin.mjs");
      assert.equal(environment.backendCwd, "/repo");
      assert.equal(environment.appUserModelId, "com.notcodex.notcodex.dev");
      assert.equal(environment.linuxWmClass, "notcodex-dev");
      assert.deepEqual(
        Option.map(environment.devServerUrl, (url) => url.href),
        Option.some("http://localhost:5173/"),
      );
      assert.deepEqual(
        environment.devRemoteNotCodexServerEntryPath,
        Option.some("/remote/server.mjs"),
      );
      assert.deepEqual(environment.configuredBackendPort, Option.some(4949));
      assert.deepEqual(environment.commitHashOverride, Option.some("0123456789abcdef"));
      assert.deepEqual(environment.otlpTracesUrl, Option.some("http://127.0.0.1:4318/v1/traces"));
      assert.equal(environment.otlpExportIntervalMs, 2500);
    }),
  );

  it.effect("derives production state paths under userdata", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          NOT_CODEX_HOME: "/tmp/notcodex",
        },
      );

      assert.equal(environment.isDevelopment, false);
      assert.equal(environment.stateDir, "/tmp/notcodex/userdata");
      assert.equal(environment.logDir, "/tmp/notcodex/userdata/logs");
      assert.equal(environment.browserArtifactsDir, "/tmp/notcodex/userdata/browser-artifacts");
      assert.equal(environment.serverSettingsPath, "/tmp/notcodex/userdata/settings.json");
    }),
  );

  it.effect("uses a configured app user model id override", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          NOT_CODEX_DESKTOP_APP_USER_MODEL_ID: " com.notcodex.notcodex.dev.local ",
          VITE_DEV_SERVER_URL: "http://localhost:5173",
        },
      );

      assert.equal(environment.appUserModelId, "com.notcodex.notcodex.dev.local");
    }),
  );

  it.effect("resolves picker defaults without nullish sentinels", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment();

      assert.deepEqual(environment.resolvePickFolderDefaultPath(null), Option.none());
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: " " }),
        Option.none(),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~" }),
        Option.some("/Users/alice"),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~/project" }),
        Option.some("/Users/alice/project"),
      );
    }),
  );
});
