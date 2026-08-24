import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import {
  HostProcessArguments,
  HostProcessExecutablePath,
  HostProcessPlatform,
  HostProcessUserId,
} from "@notcodex/shared/hostProcess";

import * as ProcessRunner from "../processRunner.ts";
import * as BootService from "./bootService.ts";
import { clearServiceRestartHandoff, serviceRestartHandoffExists } from "./serviceLifecycle.ts";

const isUnsupportedError = Schema.is(BootService.BootServiceUnsupportedError);
const isCommandError = Schema.is(BootService.BootServiceCommandError);
const isInstallError = Schema.is(BootService.BootServiceInstallError);
const isRuntimeBusyError = Schema.is(BootService.BootServiceRuntimeBusyError);
const isProfileConflictError = Schema.is(BootService.BootServiceProfileConflictError);

interface RecordedCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

const makeRecordingRunnerLayer = (
  commands: Array<RecordedCommand>,
  options?: {
    readonly failCommand?: string;
    readonly failWhen?: (command: string, args: ReadonlyArray<string>) => boolean;
    readonly stdoutWhen?: (command: string, args: ReadonlyArray<string>) => string | undefined;
    readonly pinnedRuntime?: {
      readonly fs: FileSystem.FileSystem;
      readonly path: Path.Path;
      readonly version: string;
    };
  },
) =>
  Layer.succeed(
    ProcessRunner.ProcessRunner,
    ProcessRunner.ProcessRunner.of({
      run: (input) =>
        Effect.gen(function* () {
          assert.isUndefined(input.env);
          commands.push({ command: input.command, args: input.args });
          if (input.command === "npm" && options?.pinnedRuntime) {
            const prefixIndex = input.args.indexOf("--prefix");
            const stagingDir = input.args[prefixIndex + 1];
            if (stagingDir === undefined) {
              return yield* Effect.die("missing npm --prefix");
            }
            const entryPath = options.pinnedRuntime.path.join(
              stagingDir,
              "node_modules",
              "notcodex",
              "dist",
              "bin.mjs",
            );
            yield* options.pinnedRuntime.fs
              .makeDirectory(options.pinnedRuntime.path.dirname(entryPath), { recursive: true })
              .pipe(Effect.orDie);
            yield* options.pinnedRuntime.fs
              .writeFileString(entryPath, "export {};\n")
              .pipe(Effect.orDie);
          }
          const failed =
            input.command === options?.failCommand ||
            options?.failWhen?.(input.command, input.args) === true;
          const defaultStdout =
            options?.pinnedRuntime &&
            input.command === "/usr/local/bin/node" &&
            input.args.at(-1) === "--version"
              ? `notcodex v${options.pinnedRuntime.version}\n`
              : input.command === "id" && input.args.join(" ") === "-u"
                ? "1000\n"
                : input.command === "ps" && input.args[0] === "-o"
                  ? "315360000\n"
                  : input.command === "loginctl" && input.args[0] === "show-user"
                    ? "yes\n"
                    : "";
          return {
            stdout: options?.stdoutWhen?.(input.command, input.args) ?? defaultStdout,
            stderr: failed ? `${input.command} exploded` : "",
            code: ChildProcessSpawner.ExitCode(failed ? 1 : 0),
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
          };
        }),
    }),
  );

const makeHost = (
  entry: string,
  isProcessRunning?: (pid: number) => boolean,
): BootService.BootServiceHost => ({
  execPath: "/usr/local/bin/node",
  cliEntryPath: entry,
  ...(isProcessRunning ? { isProcessRunning } : {}),
});

const provideHostRefs = (
  home: string,
  platform: NodeJS.Platform = "linux",
  uid: number | undefined = 501,
) =>
  Effect.provide(
    Layer.mergeAll(
      Layer.succeed(HostProcessPlatform, platform),
      Layer.succeed(HostProcessUserId, uid),
      ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: home } })),
    ),
  );

const makeTestContext = Effect.fn("test.makeTestContext")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "notcodex-boot-service-test-" });
  // A real file for the stable-entry cases so status can confirm the entry
  // point exists.
  const stableEntry = path.join(root, "bin.mjs");
  yield* fs.writeFileString(stableEntry, "#!/usr/bin/env node\n");
  return {
    fs,
    path,
    dirs: {
      home: root,
      baseDir: path.join(root, ".notcodex"),
      logsDir: path.join(root, ".notcodex", "userdata", "logs"),
      stableEntry,
    },
  };
});

type TestContext = Effect.Success<ReturnType<typeof makeTestContext>>;

const writeLiveRuntimeFixture = Effect.fn("test.writeLiveRuntimeFixture")(function* (
  context: TestContext,
  options?: { readonly withUnit?: boolean },
) {
  const { dirs, fs, path } = context;
  yield* TestClock.setTime(Date.parse("2026-07-27T00:00:00.000Z"));
  const runtimeStatePath = path.join(dirs.baseDir, "userdata", "server-runtime.json");
  yield* fs.makeDirectory(path.dirname(runtimeStatePath), { recursive: true });
  yield* fs.writeFileString(
    runtimeStatePath,
    '{"version":1,"pid":4242,"host":"127.0.0.1","port":3773,"origin":"http://127.0.0.1:3773","startedAt":"2026-07-26T00:00:00.000Z"}\n',
  );
  if (options?.withUnit) {
    const unitPath = path.join(dirs.home, ".config", "systemd", "user", "notcodex.service");
    yield* fs.makeDirectory(path.dirname(unitPath), { recursive: true });
    yield* fs.writeFileString(
      unitPath,
      `[Service]\nEnvironment=NOT_CODEX_HOME=${dirs.baseDir}\nExecStart=/old/notcodex serve\n`,
    );
  }
  return runtimeStatePath;
});

it("renders a systemd unit with absolute paths and append-mode logging", () => {
  const unit = BootService.renderBootServiceUnit({
    nodePath: "/usr/local/bin/node",
    notCodexEntryPath:
      "/home/theo/.notcodex/runtime/versions/0.0.27/node_modules/notcodex/dist/bin.mjs",
    baseDir: "/home/theo/.notcodex",
    logPath: "/home/theo/.notcodex/userdata/logs/boot-service.log",
    unitPath: "/home/theo/.config/systemd/user/notcodex.service",
    connectEnvironment: {
      NOT_CODEX_RELAY_URL: "https://relay.example.test",
      NOT_CODEX_CLERK_PUBLISHABLE_KEY: "pk_test_example",
      NOT_CODEX_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_example",
      NOT_CODEX_HOSTED_APP_URL: "https://app.example.test",
    },
  });

  assert.equal(
    unit,
    [
      "[Unit]",
      "Description=Not Codex server (Not Codex Connect)",
      "StartLimitIntervalSec=300",
      "StartLimitBurst=5",
      "",
      "[Service]",
      "Type=simple",
      "WorkingDirectory=%h",
      "UMask=0077",
      "Environment=NOT_CODEX_HOME=/home/theo/.notcodex",
      "Environment=NOT_CODEX_RELAY_URL=https://relay.example.test",
      "Environment=NOT_CODEX_CLERK_PUBLISHABLE_KEY=pk_test_example",
      "Environment=NOT_CODEX_CLERK_CLI_OAUTH_CLIENT_ID=oauth_example",
      "Environment=NOT_CODEX_HOSTED_APP_URL=https://app.example.test",
      "ExecStart=/usr/local/bin/node /home/theo/.notcodex/runtime/versions/0.0.27/node_modules/notcodex/dist/bin.mjs serve",
      "OOMPolicy=continue",
      "Restart=always",
      "RestartSec=5",
      "StandardOutput=append:/home/theo/.notcodex/userdata/logs/boot-service.log",
      "StandardError=append:/home/theo/.notcodex/userdata/logs/boot-service.log",
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n"),
  );
});

it("renders a launchd plist with escaped paths and connect environment", () => {
  const plan: BootService.BootServicePlan = {
    nodePath: "/Users/me/Node & Tools/node",
    notCodexEntryPath: "/Users/me/Not Codex/bin.mjs",
    baseDir: "/Users/me/Not Codex <data>",
    logPath: "/Users/me/Not Codex <data>/logs/boot.log",
    unitPath: "/Users/me/Library/LaunchAgents/com.notcodex.notcodex.service.plist",
    connectEnvironment: {
      NOT_CODEX_RELAY_URL: "https://relay.example.test/?a=1&b=2",
    },
  };
  const plist = BootService.renderBootServicePlist(plan, { homeDir: "/Users/me" });

  assert.include(plist, "<string>/Users/me/Node &amp; Tools/node</string>");
  assert.include(plist, "<string>/Users/me/Not Codex &lt;data&gt;</string>");
  assert.include(plist, "<key>NOT_CODEX_RELAY_URL</key>");
  assert.include(plist, "<string>https://relay.example.test/?a=1&amp;b=2</string>");
  assert.isTrue(BootService.bootServiceUnitBelongsToBaseDir(plist, plan.baseDir));
  assert.isFalse(BootService.bootServiceUnitBelongsToBaseDir(plist, "/Users/me/other"));
});

it("quotes systemd values containing spaces and escapes percent specifiers", () => {
  assert.equal(BootService.quoteSystemdValue("/plain/path"), "/plain/path");
  assert.equal(
    BootService.quoteSystemdValue("/home/me/Not Codex Data"),
    '"/home/me/Not Codex Data"',
  );
  assert.equal(BootService.quoteSystemdValue("/opt/100%cpu"), "/opt/100%%cpu");

  const unit = BootService.renderBootServiceUnit({
    nodePath: "/home/me/my tools/node",
    notCodexEntryPath: "/home/me/Not Codex Data/bin.mjs",
    baseDir: "/home/me/Not Codex Data",
    logPath: "/home/me/100%logs/boot.log",
    unitPath: "/home/me/.config/systemd/user/notcodex.service",
  });
  assert.include(
    unit,
    'ExecStart="/home/me/my tools/node" "/home/me/Not Codex Data/bin.mjs" serve',
  );
  assert.include(unit, 'Environment="NOT_CODEX_HOME=/home/me/Not Codex Data"');
  // append: paths take the rest of the line literally (spaces are fine,
  // quoting is not), but % still goes through specifier expansion.
  assert.include(unit, "StandardOutput=append:/home/me/100%%logs/boot.log");
  assert.include(unit, "StandardError=append:/home/me/100%%logs/boot.log");
});

it("scopes systemd unit ownership to its NOT_CODEX_HOME profile", () => {
  const ownedBaseDir = "/home/me/Not Codex 100%";
  const unit = BootService.renderBootServiceUnit({
    nodePath: "/usr/local/bin/node",
    notCodexEntryPath: "/usr/local/lib/node_modules/notcodex/dist/bin.mjs",
    baseDir: ownedBaseDir,
    logPath: `${ownedBaseDir}/userdata/logs/boot-service.log`,
    unitPath: "/home/me/.config/systemd/user/notcodex.service",
  });

  assert.isTrue(BootService.bootServiceUnitBelongsToBaseDir(unit, ownedBaseDir));
  assert.isFalse(
    BootService.bootServiceUnitBelongsToBaseDir(unit, "/home/me/Another Not Codex Profile"),
  );
});

it("flags package-manager cache entry points as ephemeral", () => {
  assert.isTrue(
    BootService.isEphemeralCacheEntry(
      "/home/theo/.npm/_npx/abc123/node_modules/notcodex/dist/bin.mjs",
    ),
  );
  assert.isTrue(
    BootService.isEphemeralCacheEntry("C:\\Users\\theo\\AppData\\npm-cache\\_npx\\abc\\bin.mjs"),
  );
  assert.isTrue(
    BootService.isEphemeralCacheEntry(
      "/home/theo/.cache/pnpm/dlx/abc/node_modules/notcodex/dist/bin.mjs",
    ),
  );
  assert.isTrue(
    BootService.isEphemeralCacheEntry("/home/theo/.bun/install/cache/notcodex@0.0.27/dist/bin.mjs"),
  );
  assert.isFalse(
    BootService.isEphemeralCacheEntry("/usr/local/lib/node_modules/notcodex/dist/bin.mjs"),
  );
  assert.isFalse(
    BootService.isEphemeralCacheEntry(
      "/home/theo/dev/pnpm/dlx-tools/notcodex/node_modules/notcodex/dist/bin.mjs",
    ),
  );
  assert.isFalse(
    BootService.isEphemeralCacheEntry(
      "/home/theo/.notcodex/runtime/versions/0.0.27/node_modules/notcodex/dist/bin.mjs",
    ),
  );
});

it("rejects a process whose elapsed lifetime is newer than persisted runtime state", () => {
  const nowEpochMs = Date.parse("2026-07-27T10:00:00.000Z");
  assert.isTrue(
    BootService.isRuntimeProcessAgeConsistent({
      runtimeStartedAt: "2026-07-27T09:59:00.000Z",
      nowEpochMs,
      processElapsedSeconds: "61\n",
    }),
  );
  assert.isFalse(
    BootService.isRuntimeProcessAgeConsistent({
      runtimeStartedAt: "2026-07-27T09:59:00.000Z",
      nowEpochMs,
      processElapsedSeconds: "5\n",
    }),
  );
  assert.isFalse(
    BootService.isRuntimeProcessAgeConsistent({
      runtimeStartedAt: "invalid",
      nowEpochMs,
      processElapsedSeconds: "61\n",
    }),
  );
});

it.layer(NodeServices.layer)("BootService", (it) => {
  it.effect("clears the handoff marker when systemd rejects a restart", () =>
    Effect.gen(function* () {
      const { dirs } = yield* makeTestContext();
      const installCommands: Array<RecordedCommand> = [];
      const installedService = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost(dirs.stableEntry),
      }).pipe(
        Effect.provide(makeRecordingRunnerLayer(installCommands)),
        provideHostRefs(dirs.home),
      );
      yield* installedService.install;
      yield* clearServiceRestartHandoff(dirs.baseDir);

      const restartCommands: Array<RecordedCommand> = [];
      const failingService = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost(dirs.stableEntry),
      }).pipe(
        Effect.provide(
          makeRecordingRunnerLayer(restartCommands, {
            failWhen: (command, args) =>
              command === "systemctl" && args.join(" ") === "--user restart notcodex.service",
          }),
        ),
        provideHostRefs(dirs.home),
      );

      const error = yield* failingService.restart.pipe(Effect.flip);
      assert.isTrue(isCommandError(error));
      assert.isFalse(yield* serviceRestartHandoffExists(dirs.baseDir));
    }),
  );

  it.effect("installs the unit, enables the service, and enables linger", () =>
    Effect.gen(function* () {
      const { dirs, fs, path } = yield* makeTestContext();
      yield* fs.makeDirectory(dirs.logsDir, { recursive: true });
      const logPath = path.join(dirs.logsDir, "boot-service.log");
      yield* fs.writeFileString(logPath, "existing private history\n", { mode: 0o644 });
      const commands: Array<RecordedCommand> = [];
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost(dirs.stableEntry),
      }).pipe(Effect.provide(makeRecordingRunnerLayer(commands)), provideHostRefs(dirs.home));

      const plan = yield* service.install;

      // A stable entry point is reused directly — no npm install.
      assert.equal(plan.notCodexEntryPath, dirs.stableEntry);
      assert.equal(yield* fs.readFileString(logPath), "existing private history\n");
      const logInfo = yield* fs.stat(logPath);
      assert.equal(logInfo.mode & 0o777, 0o600);
      assert.deepEqual(
        commands.map((entry) => [entry.command, ...entry.args].join(" ")),
        [
          "systemctl --user daemon-reload",
          "systemctl --user enable notcodex.service",
          "loginctl enable-linger",
          "systemctl --user reset-failed notcodex.service",
          // restart (not enable --now) so repairing a stale unit replaces a
          // running process instead of leaving the old one until reboot.
          "systemctl --user restart notcodex.service",
        ],
      );

      const unitPath = path.join(dirs.home, ".config", "systemd", "user", "notcodex.service");
      const unit = yield* fs.readFileString(unitPath);
      assert.include(unit, `ExecStart=/usr/local/bin/node ${dirs.stableEntry} serve`);
      assert.include(unit, `Environment=NOT_CODEX_HOME=${dirs.baseDir}`);
      assert.isFalse(yield* serviceRestartHandoffExists(dirs.baseDir));

      commands.length = 0;
      yield* service.restart;
      assert.isFalse(yield* serviceRestartHandoffExists(dirs.baseDir));
      assert.deepEqual(
        commands.map((entry) => [entry.command, ...entry.args].join(" ")),
        [
          "systemctl --user reset-failed notcodex.service",
          "systemctl --user restart notcodex.service",
        ],
      );

      const status = yield* service.status;
      assert.isTrue(status.supported);
      assert.isTrue(status.installed);
      assert.isTrue(status.current);

      const removed = yield* service.uninstall;
      assert.isTrue(removed);
      assert.isFalse(yield* fs.exists(unitPath));
      assert.isFalse(yield* serviceRestartHandoffExists(dirs.baseDir));
      const statusAfter = yield* service.status;
      assert.isFalse(statusAfter.installed);
      const removedAgain = yield* service.uninstall;
      assert.isFalse(removedAgain);
    }),
  );

  it.effect("does not uninstall the global unit owned by another base directory", () =>
    Effect.gen(function* () {
      const { dirs, fs, path } = yield* makeTestContext();
      const ownerCommands: Array<RecordedCommand> = [];
      const ownerService = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost(dirs.stableEntry),
      }).pipe(Effect.provide(makeRecordingRunnerLayer(ownerCommands)), provideHostRefs(dirs.home));
      yield* ownerService.install;

      const otherCommands: Array<RecordedCommand> = [];
      const otherBaseDir = path.join(dirs.home, ".notcodex-other");
      const otherService = yield* BootService.make({
        baseDir: otherBaseDir,
        logsDir: path.join(otherBaseDir, "userdata", "logs"),
        cliVersion: "0.0.27",
        // An ephemeral entry would normally trigger npm installation; the
        // ownership conflict must be detected before that side effect too.
        host: makeHost("/home/theo/.npm/_npx/other/node_modules/notcodex/dist/bin.mjs"),
      }).pipe(Effect.provide(makeRecordingRunnerLayer(otherCommands)), provideHostRefs(dirs.home));

      assert.isFalse(yield* otherService.uninstall);
      assert.deepEqual(otherCommands, []);
      const unitPath = path.join(dirs.home, ".config", "systemd", "user", "notcodex.service");
      assert.isTrue(yield* fs.exists(unitPath));

      assert.isTrue(yield* ownerService.uninstall);
      assert.isFalse(yield* fs.exists(unitPath));
    }),
  );

  it.effect("does not replace the global unit owned by another base directory", () =>
    Effect.gen(function* () {
      const { dirs, fs, path } = yield* makeTestContext();
      const ownerService = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost(dirs.stableEntry),
      }).pipe(Effect.provide(makeRecordingRunnerLayer([])), provideHostRefs(dirs.home));
      yield* ownerService.install;

      const unitPath = path.join(dirs.home, ".config", "systemd", "user", "notcodex.service");
      const ownerUnit = yield* fs.readFileString(unitPath);
      const otherCommands: Array<RecordedCommand> = [];
      const otherBaseDir = path.join(dirs.home, ".notcodex-other");
      const otherService = yield* BootService.make({
        baseDir: otherBaseDir,
        logsDir: path.join(otherBaseDir, "userdata", "logs"),
        cliVersion: "0.0.27",
        host: makeHost(dirs.stableEntry),
      }).pipe(Effect.provide(makeRecordingRunnerLayer(otherCommands)), provideHostRefs(dirs.home));

      const error = yield* otherService.install.pipe(Effect.flip);

      assert.isTrue(isProfileConflictError(error));
      assert.deepEqual(otherCommands, []);
      assert.equal(yield* fs.readFileString(unitPath), ownerUnit);
    }),
  );

  it.effect("preserves an existing unit when atomic replacement fails", () =>
    Effect.gen(function* () {
      const { dirs, fs, path } = yield* makeTestContext();
      const ownerService = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost(dirs.stableEntry),
      }).pipe(Effect.provide(makeRecordingRunnerLayer([])), provideHostRefs(dirs.home));
      yield* ownerService.install;

      const unitPath = path.join(dirs.home, ".config", "systemd", "user", "notcodex.service");
      const previousUnit = yield* fs.readFileString(unitPath);
      const renameError = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "FileSystem",
        method: "rename",
        description: "injected atomic replacement failure",
        pathOrDescriptor: unitPath,
      });
      const failingFileSystem = FileSystem.FileSystem.of({
        ...fs,
        rename: (from, to) => (to === unitPath ? Effect.fail(renameError) : fs.rename(from, to)),
      });
      const commands: Array<RecordedCommand> = [];
      const repairService = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost(dirs.stableEntry),
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, failingFileSystem),
        Effect.provide(makeRecordingRunnerLayer(commands)),
        provideHostRefs(dirs.home),
      );

      const error = yield* repairService.install.pipe(Effect.flip);

      assert.isTrue(isInstallError(error));
      assert.deepEqual(
        commands.map(({ command, args }) => [command, ...args].join(" ")),
        [
          "systemctl --user stop notcodex.service",
          "systemctl --user daemon-reload",
          "systemctl --user reset-failed notcodex.service",
          "systemctl --user restart notcodex.service",
        ],
      );
      assert.equal(yield* fs.readFileString(unitPath), previousUnit);
    }),
  );

  it.effect("pins a runtime via npm install when running from the npx cache", () =>
    Effect.gen(function* () {
      const { dirs, fs, path } = yield* makeTestContext();
      const commands: Array<RecordedCommand> = [];
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost("/home/theo/.npm/_npx/abc/node_modules/notcodex/dist/bin.mjs"),
      }).pipe(
        Effect.provide(
          makeRecordingRunnerLayer(commands, {
            pinnedRuntime: { fs, path, version: "0.0.27" },
          }),
        ),
        provideHostRefs(dirs.home),
      );

      const plan = yield* service.install;

      const runtimeDir = path.join(dirs.baseDir, "runtime", "versions", "0.0.27");
      assert.equal(
        plan.notCodexEntryPath,
        path.join(runtimeDir, "node_modules", "notcodex", "dist", "bin.mjs"),
      );
      assert.equal(commands[0]?.command, "npm");
      assert.deepEqual(commands[0]?.args.slice(0, 2), ["install", "--prefix"]);
      assert.include(
        commands[0]?.args[2] ?? "",
        `${runtimeDir.slice(0, runtimeDir.lastIndexOf("/"))}/.staging-`,
      );
      assert.deepEqual(commands[0]?.args.slice(3), ["--no-fund", "--no-audit", "notcodex@0.0.27"]);
      // Success is recorded via a sentinel so interrupted installs re-run.
      assert.isTrue(yield* fs.exists(path.join(runtimeDir, ".install-complete")));
    }),
  );

  it.effect("reinstalls a pinned runtime when its entry point is missing", () =>
    Effect.gen(function* () {
      const { dirs, fs, path } = yield* makeTestContext();
      const commands: Array<RecordedCommand> = [];
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost("/home/theo/.npm/_npx/abc/node_modules/notcodex/dist/bin.mjs"),
      }).pipe(
        Effect.provide(
          makeRecordingRunnerLayer(commands, {
            pinnedRuntime: { fs, path, version: "0.0.27" },
          }),
        ),
        provideHostRefs(dirs.home),
      );

      const plan = yield* service.install;
      yield* fs.makeDirectory(path.dirname(plan.notCodexEntryPath), { recursive: true });
      yield* fs.writeFileString(plan.notCodexEntryPath, "#!/usr/bin/env node\n");
      yield* fs.remove(plan.notCodexEntryPath);
      commands.length = 0;

      yield* service.install;

      assert.isTrue(commands.some(({ command }) => command === "npm"));
    }),
  );

  it.effect("reads executable metadata from host process references", () =>
    Effect.gen(function* () {
      const { dirs } = yield* makeTestContext();
      const commands: Array<RecordedCommand> = [];
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
      }).pipe(
        Effect.provide(makeRecordingRunnerLayer(commands)),
        provideHostRefs(dirs.home),
        Effect.provideService(HostProcessExecutablePath, "/opt/node/bin/node"),
        Effect.provideService(HostProcessArguments, ["/opt/node/bin/node", dirs.stableEntry]),
      );

      const plan = yield* service.install;
      assert.equal(plan.nodePath, "/opt/node/bin/node");
      assert.equal(plan.notCodexEntryPath, dirs.stableEntry);
    }),
  );

  it.effect("cleans up and fails when the pinned runtime install fails", () =>
    Effect.gen(function* () {
      const { dirs, fs, path } = yield* makeTestContext();
      const commands: Array<RecordedCommand> = [];
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost("/home/theo/.npm/_npx/abc/node_modules/notcodex/dist/bin.mjs"),
      }).pipe(
        Effect.provide(makeRecordingRunnerLayer(commands, { failCommand: "npm" })),
        provideHostRefs(dirs.home),
      );

      const error = yield* service.install.pipe(Effect.flip);
      assert.isTrue(isCommandError(error));
      const runtimeDir = path.join(dirs.baseDir, "runtime", "versions", "0.0.27");
      // The half-installed tree must not be reused by the next attempt.
      assert.isFalse(yield* fs.exists(runtimeDir));
      assert.isFalse(yield* fs.exists(path.join(runtimeDir, ".install-complete")));
    }),
  );

  it.effect("reports an installed-but-stale unit so connect can offer a repair", () =>
    Effect.gen(function* () {
      const { dirs, fs, path } = yield* makeTestContext();
      const commands: Array<RecordedCommand> = [];
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost(dirs.stableEntry),
      }).pipe(Effect.provide(makeRecordingRunnerLayer(commands)), provideHostRefs(dirs.home));

      const unitDir = path.join(dirs.home, ".config", "systemd", "user");
      yield* fs.makeDirectory(unitDir, { recursive: true });
      yield* fs.writeFileString(
        path.join(unitDir, "notcodex.service"),
        "[Service]\nExecStart=/old/node /old/notcodex serve\n",
      );

      const status = yield* service.status;
      assert.isTrue(status.supported);
      assert.isTrue(status.installed);
      assert.isFalse(status.current);
    }),
  );

  it.effect("reports setup unsupported when systemd user or linger management is unavailable", () =>
    Effect.gen(function* () {
      const { dirs } = yield* makeTestContext();
      const scenarios = [
        {
          name: "systemd user manager unavailable",
          failWhen: (command: string, args: ReadonlyArray<string>) =>
            command === "systemctl" && args.includes("show-environment"),
        },
        {
          name: "loginctl unavailable",
          failWhen: (command: string, args: ReadonlyArray<string>) =>
            command === "loginctl" && args[0] === "show-user",
        },
      ] as const;

      yield* Effect.forEach(scenarios, ({ name, failWhen }) =>
        Effect.gen(function* () {
          const commands: Array<RecordedCommand> = [];
          const service = yield* BootService.make({
            baseDir: dirs.baseDir,
            logsDir: dirs.logsDir,
            cliVersion: "0.0.27",
            host: makeHost(dirs.stableEntry),
          }).pipe(
            Effect.provide(makeRecordingRunnerLayer(commands, { failWhen })),
            provideHostRefs(dirs.home),
          );

          const status = yield* service.status;
          assert.isFalse(status.supported, name);
          assert.isFalse(status.installed, name);
          assert.isFalse(status.current, name);
        }),
      );
    }),
  );

  it.effect("reports a current unit as stale when its entry point is gone", () =>
    Effect.gen(function* () {
      const { dirs, fs } = yield* makeTestContext();
      const commands: Array<RecordedCommand> = [];
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost(dirs.stableEntry),
      }).pipe(Effect.provide(makeRecordingRunnerLayer(commands)), provideHostRefs(dirs.home));

      yield* service.install;
      assert.isTrue((yield* service.status).current);

      // The pinned runtime (or global bin) was deleted to reclaim space; the
      // unit still matches byte-for-byte but would crashloop at boot.
      yield* fs.remove(dirs.stableEntry);
      const status = yield* service.status;
      assert.isTrue(status.installed);
      assert.isFalse(status.current);
    }),
  );

  it.effect("reports a matching unit as stale when activation or linger is unhealthy", () =>
    Effect.gen(function* () {
      const { dirs } = yield* makeTestContext();
      const installCommands: Array<RecordedCommand> = [];
      const installedService = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost(dirs.stableEntry),
      }).pipe(
        Effect.provide(makeRecordingRunnerLayer(installCommands)),
        provideHostRefs(dirs.home),
      );
      yield* installedService.install;
      assert.isTrue((yield* installedService.status).current);

      const scenarios = [
        {
          name: "disabled",
          runner: makeRecordingRunnerLayer([], {
            failWhen: (command, args) => command === "systemctl" && args.includes("is-enabled"),
          }),
        },
        {
          name: "inactive",
          runner: makeRecordingRunnerLayer([], {
            failWhen: (command, args) => command === "systemctl" && args.includes("is-active"),
          }),
        },
        {
          name: "linger disabled",
          runner: makeRecordingRunnerLayer([], {
            stdoutWhen: (command, args) =>
              command === "loginctl" && args[0] === "show-user" ? "no\n" : undefined,
          }),
        },
      ] as const;

      yield* Effect.forEach(scenarios, ({ name, runner }) =>
        Effect.gen(function* () {
          const service = yield* BootService.make({
            baseDir: dirs.baseDir,
            logsDir: dirs.logsDir,
            cliVersion: "0.0.27",
            host: makeHost(dirs.stableEntry),
          }).pipe(Effect.provide(runner), provideHostRefs(dirs.home));

          assert.isFalse((yield* service.status).current, name);
        }),
      );
    }),
  );

  it.effect(
    "refuses to start a second server for a live runtime using the same data directory",
    () =>
      Effect.gen(function* () {
        const context = yield* makeTestContext();
        const { dirs, fs, path } = context;
        const commands: Array<RecordedCommand> = [];
        const runtimeStatePath = yield* writeLiveRuntimeFixture(context);
        const service = yield* BootService.make({
          baseDir: dirs.baseDir,
          logsDir: dirs.logsDir,
          cliVersion: "0.0.27",
          serverRuntimeStatePath: runtimeStatePath,
          host: makeHost(dirs.stableEntry, (pid) => pid === 4242),
        }).pipe(Effect.provide(makeRecordingRunnerLayer(commands)), provideHostRefs(dirs.home));

        const error = yield* service.install.pipe(Effect.flip);

        assert.isTrue(isRuntimeBusyError(error));
        assert.isFalse(
          yield* fs.exists(path.join(dirs.home, ".config", "systemd", "user", "notcodex.service")),
        );
        assert.isFalse(
          commands.some(({ command, args }) => command === "systemctl" && args.includes("restart")),
        );
      }),
  );

  it.effect("does not trust an active service that owns a different runtime pid", () =>
    Effect.gen(function* () {
      const context = yield* makeTestContext();
      const { dirs } = context;
      const commands: Array<RecordedCommand> = [];
      const runtimeStatePath = yield* writeLiveRuntimeFixture(context, { withUnit: true });
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        serverRuntimeStatePath: runtimeStatePath,
        host: makeHost(dirs.stableEntry, (pid) => pid === 4242),
      }).pipe(
        Effect.provide(
          makeRecordingRunnerLayer(commands, {
            stdoutWhen: (command, args) =>
              command === "systemctl" && args.includes("--property=MainPID") ? "3131\n" : undefined,
          }),
        ),
        provideHostRefs(dirs.home),
      );

      const error = yield* service.install.pipe(Effect.flip);

      assert.isTrue(isRuntimeBusyError(error));
      assert.isFalse(
        commands.some(({ command, args }) => command === "systemctl" && args.includes("restart")),
      );
    }),
  );

  it.effect("ignores a stale runtime state whose pid has been reused", () =>
    Effect.gen(function* () {
      const context = yield* makeTestContext();
      const { dirs } = context;
      const commands: Array<RecordedCommand> = [];
      const runtimeStatePath = yield* writeLiveRuntimeFixture(context);
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        serverRuntimeStatePath: runtimeStatePath,
        host: makeHost(dirs.stableEntry, (pid) => pid === 4242),
      }).pipe(
        Effect.provide(
          makeRecordingRunnerLayer(commands, {
            stdoutWhen: (command, args) =>
              command === "ps" && args[0] === "-o" ? "0\n" : undefined,
          }),
        ),
        provideHostRefs(dirs.home),
      );

      yield* service.install;

      assert.isTrue(
        commands.some(({ command, args }) => command === "systemctl" && args.includes("restart")),
      );
    }),
  );

  it.effect("allows repair when the active service owns the persisted runtime pid", () =>
    Effect.gen(function* () {
      const context = yield* makeTestContext();
      const { dirs } = context;
      const commands: Array<RecordedCommand> = [];
      const runtimeStatePath = yield* writeLiveRuntimeFixture(context, { withUnit: true });
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        serverRuntimeStatePath: runtimeStatePath,
        host: makeHost(dirs.stableEntry, (pid) => pid === 4242),
      }).pipe(
        Effect.provide(
          makeRecordingRunnerLayer(commands, {
            stdoutWhen: (command, args) =>
              command === "systemctl" && args.includes("--property=MainPID") ? "4242\n" : undefined,
          }),
        ),
        provideHostRefs(dirs.home),
      );

      yield* service.install;

      assert.isTrue(
        commands.some(({ command, args }) => command === "systemctl" && args.includes("restart")),
      );
    }),
  );

  it.effect("installs a launch agent on macOS", () =>
    Effect.gen(function* () {
      const { dirs, fs, path } = yield* makeTestContext();
      const commands: Array<RecordedCommand> = [];
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost(dirs.stableEntry),
      }).pipe(
        Effect.provide(makeRecordingRunnerLayer(commands)),
        provideHostRefs(dirs.home, "darwin"),
      );

      const plan = yield* service.install;
      assert.equal(
        plan.unitPath,
        path.join(dirs.home, "Library", "LaunchAgents", "com.notcodex.notcodex.service.plist"),
      );
      assert.isTrue(yield* fs.exists(plan.unitPath));
      assert.deepEqual(
        commands.map(({ command, args }) => [command, ...args].join(" ")),
        [
          "launchctl enable gui/501/com.notcodex.notcodex.service",
          `launchctl bootstrap gui/501 ${plan.unitPath}`,
        ],
      );

      const status = yield* service.status;
      assert.isTrue(status.supported);
      assert.isTrue(status.installed);
      assert.isTrue(status.current);
    }),
  );

  it.effect("rejects hosts without a supported service manager", () =>
    Effect.gen(function* () {
      const { dirs } = yield* makeTestContext();
      const commands: Array<RecordedCommand> = [];
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost("C:\\notcodex\\dist\\bin.mjs"),
      }).pipe(
        Effect.provide(makeRecordingRunnerLayer(commands)),
        provideHostRefs(dirs.home, "win32", undefined),
      );

      const error = yield* service.install.pipe(Effect.flip);
      assert.isTrue(isUnsupportedError(error));
      assert.lengthOf(commands, 0);
      assert.isFalse((yield* service.status).supported);
    }),
  );

  it.effect("removes the unit file when an activation step fails", () =>
    Effect.gen(function* () {
      const { dirs, fs, path } = yield* makeTestContext();
      const commands: Array<RecordedCommand> = [];
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost("/usr/local/lib/node_modules/notcodex/dist/bin.mjs"),
      }).pipe(
        Effect.provide(makeRecordingRunnerLayer(commands, { failCommand: "loginctl" })),
        provideHostRefs(dirs.home),
      );

      const error = yield* service.install.pipe(Effect.flip);
      assert.isTrue(isCommandError(error));
      // A leftover unit would make the next connect report "already set up"
      // even though linger never happened.
      assert.isFalse(
        yield* fs.exists(path.join(dirs.home, ".config", "systemd", "user", "notcodex.service")),
      );
      const status = yield* service.status;
      assert.isFalse(status.installed);
      assert.isFalse(yield* serviceRestartHandoffExists(dirs.baseDir));
      assert.isTrue(
        commands.some(
          ({ command, args }) =>
            command === "systemctl" && args.join(" ") === "--user disable --now notcodex.service",
        ),
      );
    }),
  );

  it.effect("restores the previous unit when a repair cannot activate", () =>
    Effect.gen(function* () {
      const { dirs, fs, path } = yield* makeTestContext();
      const initialCommands: Array<RecordedCommand> = [];
      const initialService = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost(dirs.stableEntry),
      }).pipe(
        Effect.provide(makeRecordingRunnerLayer(initialCommands)),
        provideHostRefs(dirs.home),
      );
      yield* initialService.install;

      const unitPath = path.join(dirs.home, ".config", "systemd", "user", "notcodex.service");
      const previousUnit = yield* fs.readFileString(unitPath);
      const replacementEntry = path.join(dirs.home, "replacement-bin.mjs");
      yield* fs.writeFileString(replacementEntry, "#!/usr/bin/env node\n");
      const repairCommands: Array<RecordedCommand> = [];
      const repairService = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.28",
        host: makeHost(replacementEntry),
      }).pipe(
        Effect.provide(makeRecordingRunnerLayer(repairCommands, { failCommand: "loginctl" })),
        provideHostRefs(dirs.home),
      );

      const error = yield* repairService.install.pipe(Effect.flip);

      assert.isTrue(isCommandError(error));
      assert.equal(yield* fs.readFileString(unitPath), previousUnit);
      const restartIndexes = repairCommands.flatMap(({ command, args }, index) =>
        command === "systemctl" && args.join(" ") === "--user restart notcodex.service"
          ? [index]
          : [],
      );
      // Activation fails before the replacement starts; rollback must still
      // escape any start-rate limit left by the previous service.
      assert.deepEqual(restartIndexes, [6]);
      assert.isTrue(
        restartIndexes.every(
          (index) =>
            repairCommands[index - 1]?.command === "systemctl" &&
            repairCommands[index - 1]?.args.join(" ") === "--user reset-failed notcodex.service",
        ),
      );
      assert.isFalse(yield* serviceRestartHandoffExists(dirs.baseDir));
    }),
  );

  it.effect("keeps the unit when stopping it during uninstall fails", () =>
    Effect.gen(function* () {
      const { dirs, fs, path } = yield* makeTestContext();
      const installCommands: Array<RecordedCommand> = [];
      const installedService = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost(dirs.stableEntry),
      }).pipe(
        Effect.provide(makeRecordingRunnerLayer(installCommands)),
        provideHostRefs(dirs.home),
      );
      yield* installedService.install;

      const uninstallCommands: Array<RecordedCommand> = [];
      const failingService = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost(dirs.stableEntry),
      }).pipe(
        Effect.provide(
          makeRecordingRunnerLayer(uninstallCommands, {
            failWhen: (command, args) =>
              command === "systemctl" && args.includes("disable") && args.includes("--now"),
          }),
        ),
        provideHostRefs(dirs.home),
      );

      const error = yield* failingService.uninstall.pipe(Effect.flip);

      assert.isTrue(isCommandError(error));
      assert.isTrue(
        yield* fs.exists(path.join(dirs.home, ".config", "systemd", "user", "notcodex.service")),
      );
    }),
  );

  it.effect("appends failed steps to the boot-service log", () =>
    Effect.gen(function* () {
      const { dirs, fs, path } = yield* makeTestContext();
      const commands: Array<RecordedCommand> = [];
      const service = yield* BootService.make({
        baseDir: dirs.baseDir,
        logsDir: dirs.logsDir,
        cliVersion: "0.0.27",
        host: makeHost("/usr/local/lib/node_modules/notcodex/dist/bin.mjs"),
      }).pipe(
        Effect.provide(makeRecordingRunnerLayer(commands, { failCommand: "systemctl" })),
        provideHostRefs(dirs.home),
      );

      const error = yield* service.install.pipe(Effect.flip);
      assert.isTrue(isCommandError(error));
      if (!isCommandError(error)) return;
      assert.equal(error.exitCode, 1);
      assert.equal(error.stderrLength, "systemctl exploded".length);

      const logPath = path.join(dirs.logsDir, "boot-service.log");
      assert.isTrue(yield* fs.exists(logPath));
      assert.include(yield* fs.readFileString(logPath), "exit code 1");
    }),
  );
});
