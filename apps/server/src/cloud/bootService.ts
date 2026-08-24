import * as Context from "effect/Context";
import * as Config from "effect/Config";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  HostProcessArguments,
  HostProcessExecutablePath,
  HostProcessPlatform,
  HostProcessUserId,
} from "@notcodex/shared/hostProcess";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ProcessRunner from "../processRunner.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import {
  ensurePinnedRuntimeInstalled,
  pinnedRuntimePaths,
  PinnedRuntimeInstallError,
} from "./pinnedRuntime.ts";
import { clearServiceRestartHandoff, markServiceRestartHandoff } from "./serviceLifecycle.ts";

/**
 * Installs Not Codex as a per-user boot service so a connected machine stays
 * reachable through Not Codex Connect. Linux uses a systemd user unit with
 * linger; macOS uses a per-user LaunchAgent. The service runs a pinned
 * runtime installed under <baseDir>/runtime — never `npx notcodex`, whose cache is
 * ephemeral and whose registry fetch at boot would make startup depend on
 * the network.
 */

const BOOT_SERVICE_NAME = "notcodex";

export const BOOT_SERVICE_UNIT_FILE = `${BOOT_SERVICE_NAME}.service`;
export const BOOT_SERVICE_LAUNCHD_LABEL = "com.notcodex.notcodex.service";
export const BOOT_SERVICE_PLIST_FILE = `${BOOT_SERVICE_LAUNCHD_LABEL}.plist`;

const EPHEMERAL_CACHE_SEGMENTS = [
  "/_npx/", // npx
  "\\_npx\\",
  "/pnpm/dlx/", // pnpm dlx (~/.cache/pnpm/dlx and $PNPM_HOME/.pnpm/dlx)
  "/.pnpm/dlx/",
  "/.bun/install/cache/", // bunx
];

/**
 * `npx notcodex` (and pnpm dlx / bunx) run out of ephemeral package-manager
 * caches that can be evicted at any time — a boot service must never point
 * there. Global installs, repo checkouts, and the pinned runtime below are
 * all stable.
 */
export function isEphemeralCacheEntry(entryPath: string): boolean {
  return EPHEMERAL_CACHE_SEGMENTS.some((segment) => entryPath.includes(segment));
}

/**
 * systemd expands `%` specifiers in most directive values, including the
 * `append:` file paths, which take the rest of the line literally and must
 * NOT be quoted.
 */
export function escapeSystemdSpecifiers(value: string): string {
  return value.replaceAll("%", "%%");
}

/**
 * systemd word-splits ExecStart and Environment values and expands `%`
 * specifiers, so paths with spaces or percents must be quoted and escaped.
 */
export function quoteSystemdValue(value: string): string {
  const escaped = escapeSystemdSpecifiers(value);
  return /[\s"'\\]/.test(escaped)
    ? `"${escaped.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
    : escaped;
}

export interface BootServicePlan {
  /** Absolute path of the node binary running this CLI. */
  readonly nodePath: string;
  /** Absolute path of the pinned Not Codex entry point the unit will run. */
  readonly notCodexEntryPath: string;
  readonly baseDir: string;
  readonly logPath: string;
  readonly unitPath: string;
  readonly connectEnvironment?: Readonly<Record<string, string>>;
}

/**
 * Pure so it is testable byte-for-byte. systemd user units run with a
 * minimal environment: every path must be absolute, and the service must
 * not rely on PATH, nvm shims, or shell profiles. Failures land in
 * `logPath` because `systemctl --user` failures are otherwise invisible.
 */
export function renderBootServiceUnit(plan: BootServicePlan): string {
  // No After=network-online.target: it does not exist in the systemd *user*
  // manager, so ordering on it is silently ignored. The server retries its
  // relay connection, and Restart=always covers early-boot failures.
  const environment = {
    NOT_CODEX_HOME: plan.baseDir,
    ...plan.connectEnvironment,
  };
  return [
    "[Unit]",
    "Description=Not Codex server (Not Codex Connect)",
    // Give up after 5 crashes in 5 minutes so a persistently broken install
    // (deleted runtime, broken workspace) stops instead of restarting every
    // 5s forever and growing the unrotated append log without bound.
    "StartLimitIntervalSec=300",
    "StartLimitBurst=5",
    "",
    "[Service]",
    "Type=simple",
    "WorkingDirectory=%h",
    // The append log can contain a live pairing token during startup. Keep
    // every file the service creates private even if the user has a broad
    // default umask.
    "UMask=0077",
    ...Object.entries(environment).map(
      ([name, value]) => `Environment=${quoteSystemdValue(`${name}=${value}`)}`,
    ),
    `ExecStart=${quoteSystemdValue(plan.nodePath)} ${quoteSystemdValue(plan.notCodexEntryPath)} serve`,
    // Provider tool calls share the service cgroup. If the kernel kills one
    // memory-hungry child, keep the Not Codex server and other sessions alive;
    // Restart=always still covers the main process itself.
    "OOMPolicy=continue",
    "Restart=always",
    "RestartSec=5",
    `StandardOutput=append:${escapeSystemdSpecifiers(plan.logPath)}`,
    `StandardError=append:${escapeSystemdSpecifiers(plan.logPath)}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

/** Plist values are emitted as XML text nodes. */
export function escapeXmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Pure renderer: launch agents cannot depend on the user's shell or PATH. */
export function renderBootServicePlist(
  plan: BootServicePlan,
  options: { readonly homeDir: string },
): string {
  const environment = {
    NOT_CODEX_HOME: plan.baseDir,
    ...plan.connectEnvironment,
  };
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  <string>${BOOT_SERVICE_LAUNCHD_LABEL}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    `    <string>${escapeXmlText(plan.nodePath)}</string>`,
    `    <string>${escapeXmlText(plan.notCodexEntryPath)}</string>`,
    `    <string>serve</string>`,
    `  </array>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    ...Object.entries(environment).flatMap(([name, value]) => [
      `    <key>${escapeXmlText(name)}</key>`,
      `    <string>${escapeXmlText(value)}</string>`,
    ]),
    `  </dict>`,
    `  <key>WorkingDirectory</key>`,
    `  <string>${escapeXmlText(options.homeDir)}</string>`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>KeepAlive</key>`,
    `  <true/>`,
    `  <key>ThrottleInterval</key>`,
    `  <integer>5</integer>`,
    `  <key>ExitTimeOut</key>`,
    `  <integer>90</integer>`,
    `  <key>ProcessType</key>`,
    `  <string>Interactive</string>`,
    `  <key>StandardOutPath</key>`,
    `  <string>${escapeXmlText(plan.logPath)}</string>`,
    `  <key>StandardErrorPath</key>`,
    `  <string>${escapeXmlText(plan.logPath)}</string>`,
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n");
}

export interface BootServiceStep {
  readonly step: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly optional?: boolean;
  readonly timeout?: Duration.Input;
}

const STOP_STEP_TIMEOUT = Duration.seconds(120);

export interface BootServiceManager {
  readonly kind: "systemd" | "launchd";
  readonly unitPath: string;
  readonly render: (plan: BootServicePlan) => string;
  readonly stop: ReadonlyArray<BootServiceStep>;
  readonly activate: ReadonlyArray<BootServiceStep>;
  readonly restart: ReadonlyArray<BootServiceStep>;
  readonly deactivate: ReadonlyArray<BootServiceStep>;
  readonly finalize: ReadonlyArray<BootServiceStep>;
  readonly availabilityCheck: { readonly command: string; readonly args: ReadonlyArray<string> };
  readonly activeCheck: { readonly command: string; readonly args: ReadonlyArray<string> };
  readonly pidCheck: (pid: number) => {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly validate: (stdout: string) => boolean;
  };
}

export function systemdManager(input: {
  readonly path: Path.Path;
  readonly homeDir: string;
}): BootServiceManager {
  const unitPath = input.path.join(
    input.homeDir,
    ".config",
    "systemd",
    "user",
    BOOT_SERVICE_UNIT_FILE,
  );
  return {
    kind: "systemd",
    unitPath,
    render: renderBootServiceUnit,
    stop: [
      {
        step: "stopping the installed service",
        command: "systemctl",
        args: ["--user", "stop", BOOT_SERVICE_UNIT_FILE],
        timeout: STOP_STEP_TIMEOUT,
      },
    ],
    activate: [
      {
        step: "reloading systemd user units",
        command: "systemctl",
        args: ["--user", "daemon-reload"],
      },
      {
        step: "enabling the service",
        command: "systemctl",
        args: ["--user", "enable", BOOT_SERVICE_UNIT_FILE],
      },
      { step: "enabling lingering for this user", command: "loginctl", args: ["enable-linger"] },
      {
        step: "resetting the service failure state",
        command: "systemctl",
        args: ["--user", "reset-failed", BOOT_SERVICE_UNIT_FILE],
      },
      {
        step: "starting the service",
        command: "systemctl",
        args: ["--user", "restart", BOOT_SERVICE_UNIT_FILE],
      },
    ],
    restart: [
      {
        step: "resetting the service failure state",
        command: "systemctl",
        args: ["--user", "reset-failed", BOOT_SERVICE_UNIT_FILE],
      },
      {
        step: "restarting the service",
        command: "systemctl",
        args: ["--user", "restart", BOOT_SERVICE_UNIT_FILE],
      },
    ],
    deactivate: [
      {
        step: "stopping the service",
        command: "systemctl",
        args: ["--user", "disable", "--now", BOOT_SERVICE_UNIT_FILE],
        timeout: STOP_STEP_TIMEOUT,
      },
    ],
    finalize: [
      {
        step: "reloading systemd user units",
        command: "systemctl",
        args: ["--user", "daemon-reload"],
      },
    ],
    availabilityCheck: { command: "systemctl", args: ["--user", "show-environment"] },
    activeCheck: { command: "systemctl", args: ["--user", "is-active", BOOT_SERVICE_UNIT_FILE] },
    pidCheck: (pid) => ({
      command: "systemctl",
      args: ["--user", "show", BOOT_SERVICE_UNIT_FILE, "--property=MainPID", "--value"],
      validate: (stdout) => stdout.trim() === String(pid),
    }),
  };
}

export function launchdManager(input: {
  readonly path: Path.Path;
  readonly homeDir: string;
  readonly uid: number;
}): BootServiceManager {
  const unitPath = input.path.join(
    input.homeDir,
    "Library",
    "LaunchAgents",
    BOOT_SERVICE_PLIST_FILE,
  );
  const domainTarget = `gui/${input.uid}`;
  const serviceTarget = `${domainTarget}/${BOOT_SERVICE_LAUNCHD_LABEL}`;
  const stop = {
    step: "stopping the launch agent",
    command: "launchctl",
    args: ["bootout", "--wait", serviceTarget],
    optional: true,
    timeout: STOP_STEP_TIMEOUT,
  } as const;
  return {
    kind: "launchd",
    unitPath,
    render: (plan) => renderBootServicePlist(plan, { homeDir: input.homeDir }),
    stop: [stop],
    activate: [
      {
        step: "enabling the launch agent",
        command: "launchctl",
        args: ["enable", serviceTarget],
        optional: true,
      },
      {
        step: "starting the launch agent",
        command: "launchctl",
        args: ["bootstrap", domainTarget, unitPath],
      },
    ],
    restart: [
      stop,
      {
        step: "restarting the launch agent",
        command: "launchctl",
        args: ["bootstrap", domainTarget, unitPath],
      },
    ],
    deactivate: [stop],
    finalize: [],
    availabilityCheck: { command: "launchctl", args: ["print", domainTarget] },
    activeCheck: { command: "launchctl", args: ["print", serviceTarget] },
    pidCheck: (pid) => ({
      command: "launchctl",
      args: ["print", serviceTarget],
      validate: (stdout) => new RegExp(`\\bpid\\s*=\\s*${pid}\\b`).test(stdout),
    }),
  };
}

export function selectBootServiceManager(input: {
  readonly platform: NodeJS.Platform;
  readonly homeDir: string;
  readonly uid: number | undefined;
  readonly path: Path.Path;
}): BootServiceManager | undefined {
  if (input.homeDir === "") {
    return undefined;
  }
  if (input.platform === "linux") {
    return systemdManager({ path: input.path, homeDir: input.homeDir });
  }
  if (input.platform === "darwin" && input.uid !== undefined) {
    return launchdManager({ path: input.path, homeDir: input.homeDir, uid: input.uid });
  }
  return undefined;
}

/**
 * The systemd unit name is intentionally global per user, while callers can
 * select different Not Codex data directories. Only the profile recorded in
 * NOT_CODEX_HOME owns that unit; another --base-dir must leave it untouched.
 * Compare the rendered directive instead of the whole unit so logout can
 * still remove an older unit for the same profile after a CLI upgrade.
 */
export function bootServiceUnitBelongsToBaseDir(unit: string, baseDir: string): boolean {
  const homeDirective = `Environment=${quoteSystemdValue(`NOT_CODEX_HOME=${baseDir}`)}`;
  if (unit.split(/\r?\n/).includes(homeDirective)) {
    return true;
  }
  const lines = unit.split(/\r?\n/).map((line) => line.trim());
  const keyIndex = lines.indexOf("<key>NOT_CODEX_HOME</key>");
  return keyIndex >= 0 && lines[keyIndex + 1] === `<string>${escapeXmlText(baseDir)}</string>`;
}

export class BootServiceUnsupportedError extends Schema.TaggedErrorClass<BootServiceUnsupportedError>()(
  "BootServiceUnsupportedError",
  { platform: Schema.String },
) {
  override get message(): string {
    return `Background setup supports Linux with systemd and macOS with launchd; this machine reports '${this.platform}'.`;
  }
}

export class BootServiceCommandError extends Schema.TaggedErrorClass<BootServiceCommandError>()(
  "BootServiceCommandError",
  {
    step: Schema.String,
    exitCode: Schema.optional(Schema.Number),
    stdoutLength: Schema.optional(Schema.Number),
    stderrLength: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.exitCode === undefined
      ? `Background setup failed while ${this.step}.`
      : `Background setup failed while ${this.step} (exit code ${this.exitCode}).`;
  }
}

export class BootServiceInstallError extends Schema.TaggedErrorClass<BootServiceInstallError>()(
  "BootServiceInstallError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not set up the Not Codex background service.";
  }
}

export class BootServiceRuntimeBusyError extends Schema.TaggedErrorClass<BootServiceRuntimeBusyError>()(
  "BootServiceRuntimeBusyError",
  { pid: Schema.Int, origin: Schema.String },
) {
  override get message(): string {
    return `Not Codex is already running for this data directory (pid ${this.pid}, ${this.origin}). Stop it before enabling the background service.`;
  }
}

export class BootServiceProfileConflictError extends Schema.TaggedErrorClass<BootServiceProfileConflictError>()(
  "BootServiceProfileConflictError",
  { requestedBaseDir: Schema.String, unitPath: Schema.String },
) {
  override get message(): string {
    return `The existing Not Codex background service belongs to a different data directory. Remove it from its owning profile before enabling background setup for '${this.requestedBaseDir}'.`;
  }
}

export type BootServiceError =
  | BootServiceUnsupportedError
  | BootServiceCommandError
  | BootServiceInstallError
  | BootServiceRuntimeBusyError
  | BootServiceProfileConflictError;

export interface BootServiceStatus {
  readonly supported: boolean;
  readonly installed: boolean;
  /** False when the installed unit no longer matches what install would write. */
  readonly current: boolean;
  readonly unitPath: string;
  readonly logPath: string;
}

export class BootService extends Context.Service<
  BootService,
  {
    /** Installs the pinned runtime + unit, enables linger, starts the service. */
    readonly install: Effect.Effect<BootServicePlan, BootServiceError>;
    /** Restarts an installed unit so durable configuration changes take effect. */
    readonly restart: Effect.Effect<void, BootServiceError>;
    /**
     * Stops and removes the unit; leaves the pinned runtime for reuse.
     * Returns whether a unit was actually removed.
     */
    readonly uninstall: Effect.Effect<boolean, BootServiceError>;
    readonly status: Effect.Effect<BootServiceStatus, BootServiceError>;
  }
>()("notcodex/cloud/bootService") {}

export interface BootServiceHost {
  readonly execPath: string;
  readonly cliEntryPath: string;
  readonly isProcessRunning?: (pid: number) => boolean;
}

const PROCESS_AGE_ROUNDING_TOLERANCE_MS = 2_000;

/**
 * A persisted runtime state is written shortly after its process starts. A
 * PID that still belongs to that process must therefore be at least as old as
 * the state record. Linux `ps etimes` is rounded to whole seconds, hence the
 * small allowance. A recycled PID starts after the stale record and fails
 * this check instead of blocking background setup indefinitely.
 */
export function isRuntimeProcessAgeConsistent(input: {
  readonly runtimeStartedAt: string;
  readonly nowEpochMs: number;
  readonly processElapsedSeconds: string;
}): boolean {
  const runtimeStartedAtMs = Date.parse(input.runtimeStartedAt);
  const elapsedText = input.processElapsedSeconds.trim();
  const processElapsedSeconds = Number(elapsedText);
  if (
    !Number.isFinite(runtimeStartedAtMs) ||
    !Number.isFinite(input.nowEpochMs) ||
    runtimeStartedAtMs > input.nowEpochMs + PROCESS_AGE_ROUNDING_TOLERANCE_MS ||
    !/^\d+$/.test(elapsedText) ||
    !Number.isInteger(processElapsedSeconds) ||
    processElapsedSeconds < 0
  ) {
    return false;
  }
  const runtimeAgeMs = Math.max(0, input.nowEpochMs - runtimeStartedAtMs);
  return processElapsedSeconds * 1_000 + PROCESS_AGE_ROUNDING_TOLERANCE_MS >= runtimeAgeMs;
}

export const make = Effect.fn("cloud.boot_service.make")(function* (input: {
  readonly baseDir: string;
  readonly logsDir: string;
  readonly cliVersion: string;
  readonly connectEnvironment?: Readonly<Record<string, string>>;
  readonly serverRuntimeStatePath?: string;
  readonly host?: BootServiceHost;
}) {
  const hostExecPath = yield* HostProcessExecutablePath;
  const hostArguments = yield* HostProcessArguments;
  const host = input.host ?? {
    execPath: hostExecPath,
    // When running the packed CLI this is dist/bin.mjs; when stable (global
    // install, repo checkout) the boot service runs this same artifact.
    cliEntryPath: hostArguments[1] ?? "",
  };
  const isProcessRunning =
    host.isProcessRunning ??
    ((pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (cause) {
        return !(cause instanceof Error && "code" in cause && cause.code === "ESRCH");
      }
    });
  const platform = yield* HostProcessPlatform;
  const uid = yield* HostProcessUserId;
  const homeDir = yield* Config.string("HOME").pipe(Config.withDefault(""));
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const markRestartHandoff = markServiceRestartHandoff(input.baseDir).pipe(
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Path.Path, path),
    Effect.mapError((cause) => new BootServiceInstallError({ cause })),
  );
  const clearRestartHandoff = clearServiceRestartHandoff(input.baseDir).pipe(
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Path.Path, path),
    Effect.mapError((cause) => new BootServiceInstallError({ cause })),
  );

  const detectedManager = selectBootServiceManager({ platform, homeDir, uid, path });
  const unitPath = detectedManager?.unitPath ?? "";
  const logPath = path.join(input.logsDir, "boot-service.log");
  const runtimePaths = pinnedRuntimePaths(path, input.baseDir, input.cliVersion);

  const requireManager = Effect.suspend(() =>
    detectedManager === undefined
      ? new BootServiceUnsupportedError({ platform })
      : Effect.succeed(detectedManager),
  );

  const runStep = Effect.fn("cloud.boot_service.run_step")(function* (
    step: string,
    command: string,
    args: ReadonlyArray<string>,
    options?: { readonly timeout?: Duration.Input },
  ) {
    return yield* runner.run({ command, args, timeout: options?.timeout }).pipe(
      Effect.mapError((cause) => new BootServiceCommandError({ step, cause })),
      Effect.filterOrFail(
        (result) => result.code === 0,
        (result) =>
          new BootServiceCommandError({
            step,
            exitCode: Number(result.code),
            stdoutLength: result.stdout.length,
            stderrLength: result.stderr.length,
          }),
      ),
      Effect.tapError((error) =>
        DateTime.now.pipe(
          Effect.flatMap((now) =>
            fs.writeFileString(logPath, `${DateTime.formatIso(now)} ${error.message}\n`, {
              flag: "a",
            }),
          ),
          Effect.ignore,
        ),
      ),
    );
  });

  const runSteps = (steps: ReadonlyArray<BootServiceStep>) =>
    Effect.forEach(
      steps,
      (entry) => {
        const run = runStep(
          entry.step,
          entry.command,
          entry.args,
          entry.timeout === undefined ? undefined : { timeout: entry.timeout },
        );
        return entry.optional === true ? run.pipe(Effect.ignore) : run.pipe(Effect.asVoid);
      },
      { discard: true },
    );

  const runStatusCheck = Effect.fn("cloud.boot_service.run_status_check")(function* (
    command: string,
    args: ReadonlyArray<string>,
    validate: (stdout: string) => boolean = () => true,
  ) {
    return yield* runner.run({ command, args }).pipe(
      Effect.map((result) => result.code === 0 && validate(result.stdout)),
      // A missing command, unavailable user manager, or failed query means
      // the service cannot be proven healthy. Report it stale so connect
      // offers repair instead of promising background reachability.
      Effect.orElseSucceed(() => false),
    );
  });

  const ensurePinnedRuntime = Effect.suspend(() => {
    if (!isEphemeralCacheEntry(host.cliEntryPath)) {
      return Effect.void;
    }
    return ensurePinnedRuntimeInstalled({
      baseDir: input.baseDir,
      version: input.cliVersion,
      fs,
      path,
      runner,
      validate: (runtime) =>
        runner
          .run({
            command: host.execPath,
            args: [runtime.entryPath, "--version"],
            timeout: Duration.seconds(30),
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new PinnedRuntimeInstallError({
                  step: "verifying the pinned Not Codex runtime",
                  cause,
                }),
            ),
            Effect.flatMap((result) => {
              const reportedVersion = /\bv(\S+)\s*$/.exec(result.stdout)?.[1];
              return result.code === 0 && reportedVersion === input.cliVersion
                ? Effect.void
                : Effect.fail(
                    new PinnedRuntimeInstallError({
                      step: "verifying the pinned Not Codex runtime",
                      exitCode: Number(result.code),
                      stdoutLength: result.stdout.length,
                      stderrLength: result.stderr.length,
                    }),
                  );
            }),
          ),
    }).pipe(
      Effect.mapError((error) =>
        error._tag === "PinnedRuntimeInstallError"
          ? new BootServiceCommandError({
              step: error.step,
              exitCode: error.exitCode,
              stdoutLength: error.stdoutLength,
              stderrLength: error.stderrLength,
              cause: error,
            })
          : new BootServiceInstallError({ cause: error }),
      ),
      Effect.asVoid,
    );
  });

  // Where the unit will point: derivable without touching the network, so
  // status can compare units purely; install materializes it first.
  const plannedEntryPath = isEphemeralCacheEntry(host.cliEntryPath)
    ? runtimePaths.entryPath
    : host.cliEntryPath;
  const plan: BootServicePlan = {
    nodePath: host.execPath,
    notCodexEntryPath: plannedEntryPath,
    baseDir: input.baseDir,
    logPath,
    unitPath,
    ...(input.connectEnvironment ? { connectEnvironment: input.connectEnvironment } : {}),
  };

  const ensureNoCompetingRuntime = Effect.fn("cloud.boot_service.ensure_no_competing_runtime")(
    function* (manager: BootServiceManager) {
      if (!input.serverRuntimeStatePath) {
        return;
      }
      const runtimeState = yield* readPersistedServerRuntimeState(
        input.serverRuntimeStatePath,
      ).pipe(Effect.provideService(FileSystem.FileSystem, fs));
      if (Option.isNone(runtimeState)) {
        return;
      }
      // Repairing an already-active systemd service replaces that same managed
      // runtime. Any other live pid would become a second server sharing the
      // same SQLite database and schedulers, so fail before writing or starting
      // the unit and let the user stop the foreground/desktop instance first.
      const unitExists = yield* fs
        .exists(unitPath)
        .pipe(Effect.mapError((cause) => new BootServiceInstallError({ cause })));
      const managedServiceActive =
        unitExists &&
        (yield* runStatusCheck(manager.activeCheck.command, manager.activeCheck.args));
      const pidCheck = manager.pidCheck(runtimeState.value.pid);
      const managedServiceOwnsRuntime =
        managedServiceActive &&
        (yield* runStatusCheck(pidCheck.command, pidCheck.args, pidCheck.validate));
      const processIsRunning = isProcessRunning(runtimeState.value.pid);
      const nowEpochMs = yield* Clock.currentTimeMillis;
      const processMatchesRuntimeState =
        processIsRunning &&
        (yield* runStatusCheck(
          "ps",
          ["-o", "etimes=", "-p", String(runtimeState.value.pid)],
          (stdout) =>
            isRuntimeProcessAgeConsistent({
              runtimeStartedAt: runtimeState.value.startedAt,
              nowEpochMs,
              processElapsedSeconds: stdout,
            }),
        ));
      if (!managedServiceOwnsRuntime && processMatchesRuntimeState) {
        return yield* new BootServiceRuntimeBusyError({
          pid: runtimeState.value.pid,
          origin: runtimeState.value.origin,
        });
      }
    },
  );

  const restartUnit = Effect.fn("cloud.boot_service.restart_unit")(function* (
    manager: BootServiceManager,
  ) {
    // The outgoing server keeps its managed tunnel while this marker exists.
    // systemctl restart does not complete until the old process has finalized,
    // so clearing afterward covers success, failure, and interruption without
    // racing the shutdown decision.
    yield* markRestartHandoff;
    // A service that previously crash-looped may still be blocked by
    // systemd's start-rate limiter. Clear that state before every deliberate
    // restart so repaired configuration is applied immediately.
    yield* runSteps(manager.restart).pipe(Effect.ensuring(clearRestartHandoff.pipe(Effect.ignore)));
  });

  const restart: BootService["Service"]["restart"] = Effect.gen(function* () {
    const manager = yield* requireManager;
    yield* restartUnit(manager);
  }).pipe(Effect.withSpan("cloud.boot_service.restart"));

  const install: BootService["Service"]["install"] = Effect.gen(function* () {
    const manager = yield* requireManager;
    const previousUnit = yield* fs.exists(unitPath).pipe(
      Effect.flatMap((exists) =>
        exists
          ? fs.readFileString(unitPath).pipe(Effect.map(Option.some))
          : Effect.succeed(Option.none<string>()),
      ),
      Effect.mapError((cause) => new BootServiceInstallError({ cause })),
    );
    if (
      Option.isSome(previousUnit) &&
      !bootServiceUnitBelongsToBaseDir(previousUnit.value, input.baseDir)
    ) {
      return yield* new BootServiceProfileConflictError({
        requestedBaseDir: input.baseDir,
        unitPath,
      });
    }

    yield* ensureNoCompetingRuntime(manager);
    yield* fs
      .makeDirectory(input.logsDir, { recursive: true })
      .pipe(Effect.mapError((cause) => new BootServiceInstallError({ cause })));
    yield* fs.writeFileString(logPath, "", { flag: "a", mode: 0o600 }).pipe(
      Effect.andThen(fs.chmod(logPath, 0o600)),
      Effect.mapError((cause) => new BootServiceInstallError({ cause })),
    );

    yield* ensurePinnedRuntime;

    if (Option.isSome(previousUnit)) {
      yield* markRestartHandoff;
      yield* runSteps(manager.stop).pipe(
        Effect.tapError(() => clearRestartHandoff.pipe(Effect.ignore)),
      );
    }

    yield* Effect.gen(function* () {
      yield* writeFileStringAtomically({
        filePath: unitPath,
        contents: manager.render(plan),
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.mapError((cause) => new BootServiceInstallError({ cause })),
      );
      yield* runSteps(manager.activate);
    }).pipe(
      Effect.tapError(() => rollbackFailedInstall(manager, previousUnit)),
      Effect.ensuring(clearRestartHandoff.pipe(Effect.ignore)),
    );

    return plan;
  }).pipe(Effect.withSpan("cloud.boot_service.install"));

  // If activation fails partway (e.g. enable succeeds but restart/linger
  // fails), leave nothing behind: disable removes the enable symlink, remove
  // deletes the file, daemon-reload clears the stale definition — otherwise a
  // dangling wants/ symlink logs "Failed to load unit" at every boot and the
  // next connect misreports the state.
  const rollbackFailedInstall = Effect.fn("cloud.boot_service.rollback_failed_install")(function* (
    manager: BootServiceManager,
    previousUnit: Option.Option<string>,
  ) {
    // A failed activation is no longer a guaranteed handoff. Clear its marker
    // before stopping a partial fresh install; restoring a previous unit below
    // creates a new marker immediately through restartUnit.
    yield* clearRestartHandoff.pipe(Effect.ignore);
    if (Option.isSome(previousUnit)) {
      yield* fs.writeFileString(unitPath, previousUnit.value).pipe(Effect.ignore);
    } else {
      yield* runSteps(manager.deactivate).pipe(Effect.ignore);
      yield* fs.remove(unitPath).pipe(Effect.ignore);
    }
    yield* runSteps(manager.finalize).pipe(Effect.ignore);
    if (Option.isSome(previousUnit)) {
      yield* runSteps(manager.restart).pipe(Effect.ignore);
    }
  });

  const uninstall: BootService["Service"]["uninstall"] = Effect.gen(function* () {
    const manager = yield* requireManager;
    const exists = yield* fs
      .exists(unitPath)
      .pipe(Effect.mapError((cause) => new BootServiceInstallError({ cause })));
    if (!exists) {
      return false;
    }
    const installedUnit = yield* fs
      .readFileString(unitPath)
      .pipe(Effect.mapError((cause) => new BootServiceInstallError({ cause })));
    if (!bootServiceUnitBelongsToBaseDir(installedUnit, input.baseDir)) {
      return false;
    }
    // Uninstall is an explicit stop, never a replacement handoff. Removing a
    // stale failed-restart marker lets the server release its managed tunnel.
    yield* clearRestartHandoff;
    yield* runSteps(manager.deactivate);
    yield* fs
      .remove(unitPath)
      .pipe(Effect.mapError((cause) => new BootServiceInstallError({ cause })));
    yield* runSteps(manager.finalize);
    return true;
  }).pipe(Effect.withSpan("cloud.boot_service.uninstall"));

  const status: BootService["Service"]["status"] = Effect.gen(function* () {
    if (detectedManager === undefined) {
      return { supported: false, installed: false, current: false, unitPath, logPath };
    }
    const manager = detectedManager;
    const managerAvailable = yield* runStatusCheck(
      manager.availabilityCheck.command,
      manager.availabilityCheck.args,
    );
    let lingerResult: string | undefined;
    if (manager.kind === "systemd") {
      const uidResult = yield* runner.run({ command: "id", args: ["-u"] }).pipe(
        Effect.map((result) => (result.code === 0 ? result.stdout.trim() : "")),
        Effect.orElseSucceed(() => ""),
      );
      lingerResult =
        uidResult === ""
          ? ""
          : yield* runner
              .run({
                command: "loginctl",
                args: ["show-user", uidResult, "--property=Linger", "--value"],
              })
              .pipe(
                Effect.map((result) => (result.code === 0 ? result.stdout.trim() : "")),
                Effect.orElseSucceed(() => ""),
              );
    }
    const lingerAvailable =
      manager.kind === "launchd" || lingerResult === "yes" || lingerResult === "no";
    if (!managerAvailable || !lingerAvailable) {
      return { supported: false, installed: false, current: false, unitPath, logPath };
    }
    const unitExists = yield* fs.exists(unitPath);
    if (!unitExists) {
      return { supported: true, installed: false, current: false, unitPath, logPath };
    }
    const unit = yield* fs.readFileString(unitPath);
    // A unit is current only if it matches what install would write now (an
    // older CLI wrote a different runtime/node path), its entry point still
    // exists, systemd has it enabled and active, and linger remains enabled
    // for the current uid. Any mismatch makes connect offer a repair.
    const entryExists = yield* fs.exists(plannedEntryPath);
    let current = unit === manager.render(plan) && entryExists;
    if (current && manager.kind === "systemd") {
      current = yield* runStatusCheck("systemctl", [
        "--user",
        "is-enabled",
        BOOT_SERVICE_UNIT_FILE,
      ]);
    }
    if (current) {
      current = yield* runStatusCheck(manager.activeCheck.command, manager.activeCheck.args);
    }
    if (current && manager.kind === "systemd") {
      current = lingerResult === "yes";
    }
    return { supported: true, installed: true, current, unitPath, logPath };
  }).pipe(
    Effect.mapError((cause) => new BootServiceInstallError({ cause })),
    Effect.withSpan("cloud.boot_service.status"),
  );

  return BootService.of({ install, restart, uninstall, status });
});

export const layer = (input: {
  readonly baseDir: string;
  readonly logsDir: string;
  readonly cliVersion: string;
  readonly connectEnvironment?: Readonly<Record<string, string>>;
  readonly serverRuntimeStatePath?: string;
  readonly host?: BootServiceHost;
}) => Layer.effect(BootService, make(input));
