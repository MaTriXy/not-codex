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
} from "@notcodex/shared/hostProcess";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ProcessRunner from "../processRunner.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { clearServiceRestartHandoff, markServiceRestartHandoff } from "./serviceLifecycle.ts";

/**
 * Installs Not Codex as a per-user boot service so a connected machine stays
 * reachable through Not Codex Connect after the SSH session ends. Linux-only for
 * now: systemd user unit + loginctl enable-linger. The service runs a pinned
 * runtime installed under <baseDir>/runtime — never `npx notcodex`, whose cache is
 * ephemeral and whose registry fetch at boot would make startup depend on
 * the network.
 */

const BOOT_SERVICE_NAME = "notcodex";
const BOOT_RUNTIME_DIR = "runtime";

const BOOT_SERVICE_UNIT_FILE = `${BOOT_SERVICE_NAME}.service`;
const PINNED_RUNTIME_INSTALL_TIMEOUT = Duration.minutes(10);

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

/**
 * The systemd unit name is intentionally global per user, while callers can
 * select different Not Codex data directories. Only the profile recorded in
 * NOT_CODEX_HOME owns that unit; another --base-dir must leave it untouched.
 * Compare the rendered directive instead of the whole unit so logout can
 * still remove an older unit for the same profile after a CLI upgrade.
 */
export function bootServiceUnitBelongsToBaseDir(unit: string, baseDir: string): boolean {
  const homeDirective = `Environment=${quoteSystemdValue(`NOT_CODEX_HOME=${baseDir}`)}`;
  return unit.split(/\r?\n/).includes(homeDirective);
}

export class BootServiceUnsupportedError extends Schema.TaggedErrorClass<BootServiceUnsupportedError>()(
  "BootServiceUnsupportedError",
  { platform: Schema.String },
) {
  override get message(): string {
    return `Background setup currently supports Linux with systemd; this machine reports '${this.platform}'.`;
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

  const unitDir = path.join(homeDir, ".config", "systemd", "user");
  const unitPath = path.join(unitDir, BOOT_SERVICE_UNIT_FILE);
  const logPath = path.join(input.logsDir, "boot-service.log");
  const runtimeVersionDir = path.join(
    input.baseDir,
    BOOT_RUNTIME_DIR,
    "versions",
    input.cliVersion,
  );
  const runtimeEntryPath = path.join(
    runtimeVersionDir,
    "node_modules",
    "notcodex",
    "dist",
    "bin.mjs",
  );
  const runtimeSentinelPath = path.join(runtimeVersionDir, ".install-complete");

  const requireSystemdLinux = Effect.gen(function* () {
    if (platform !== "linux" || homeDir === "") {
      return yield* new BootServiceUnsupportedError({ platform });
    }
  });

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

  /**
   * Ensures plannedEntryPath exists before the unit points at it. A stable
   * install (global bin, repo checkout) is used as-is; an ephemeral cache
   * entry is replaced by `npm install --prefix`-ing the exact running
   * version into <baseDir>/runtime/versions/<v>. A real install (not a copy
   * of bin.mjs) because Not Codex ships native deps like node-pty.
   */
  const ensurePinnedRuntime = Effect.gen(function* () {
    if (!isEphemeralCacheEntry(host.cliEntryPath)) {
      return;
    }
    // The sentinel is written only after npm exits 0. Checking the entry
    // file alone is not enough: npm extracts files before running native
    // builds (node-pty), so a killed install leaves a plausible-looking but
    // broken tree behind.
    const alreadyPinned = yield* Effect.all([
      fs.exists(runtimeSentinelPath),
      fs.exists(runtimeEntryPath),
    ]).pipe(
      Effect.map(([sentinelExists, entryExists]) => sentinelExists && entryExists),
      Effect.mapError((cause) => new BootServiceInstallError({ cause })),
    );
    if (alreadyPinned) {
      return;
    }
    yield* fs.remove(runtimeVersionDir, { recursive: true, force: true }).pipe(
      Effect.andThen(fs.makeDirectory(runtimeVersionDir, { recursive: true })),
      Effect.mapError((cause) => new BootServiceInstallError({ cause })),
    );
    yield* runStep(
      "installing the pinned Not Codex runtime (this can take a few minutes)",
      "npm",
      [
        "install",
        "--prefix",
        runtimeVersionDir,
        "--no-fund",
        "--no-audit",
        `notcodex@${input.cliVersion}`,
      ],
      // Native deps (node-pty) can compile from source on slow boxes; the
      // ProcessRunner default of 60s would kill a healthy install.
      { timeout: PINNED_RUNTIME_INSTALL_TIMEOUT },
    ).pipe(
      Effect.tapError(() =>
        fs.remove(runtimeVersionDir, { recursive: true, force: true }).pipe(Effect.ignore),
      ),
    );
    yield* fs
      .writeFileString(runtimeSentinelPath, `${input.cliVersion}\n`)
      .pipe(Effect.mapError((cause) => new BootServiceInstallError({ cause })));
  });

  // Where the unit will point: derivable without touching the network, so
  // status can compare units purely; install materializes it first.
  const plannedEntryPath = isEphemeralCacheEntry(host.cliEntryPath)
    ? runtimeEntryPath
    : host.cliEntryPath;
  const plan: BootServicePlan = {
    nodePath: host.execPath,
    notCodexEntryPath: plannedEntryPath,
    baseDir: input.baseDir,
    logPath,
    unitPath,
    ...(input.connectEnvironment ? { connectEnvironment: input.connectEnvironment } : {}),
  };

  const ensureNoCompetingRuntime = Effect.gen(function* () {
    if (!input.serverRuntimeStatePath) {
      return;
    }
    const runtimeState = yield* readPersistedServerRuntimeState(input.serverRuntimeStatePath).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
    );
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
      (yield* runStatusCheck("systemctl", ["--user", "is-active", BOOT_SERVICE_UNIT_FILE]));
    const managedServiceOwnsRuntime =
      managedServiceActive &&
      (yield* runStatusCheck(
        "systemctl",
        ["--user", "show", BOOT_SERVICE_UNIT_FILE, "--property=MainPID", "--value"],
        (stdout) => stdout.trim() === String(runtimeState.value.pid),
      ));
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
  });

  const restartUnit = Effect.fn("cloud.boot_service.restart_unit")(function* (restartStep: string) {
    // The outgoing server keeps its managed tunnel while this marker exists.
    // systemctl restart does not complete until the old process has finalized,
    // so clearing afterward covers success, failure, and interruption without
    // racing the shutdown decision.
    yield* markRestartHandoff;
    // A service that previously crash-looped may still be blocked by
    // systemd's start-rate limiter. Clear that state before every deliberate
    // restart so repaired configuration is applied immediately.
    yield* Effect.gen(function* () {
      yield* runStep("resetting the service failure state", "systemctl", [
        "--user",
        "reset-failed",
        BOOT_SERVICE_UNIT_FILE,
      ]);
      yield* runStep(restartStep, "systemctl", ["--user", "restart", BOOT_SERVICE_UNIT_FILE]);
    }).pipe(Effect.ensuring(clearRestartHandoff.pipe(Effect.ignore)));
  });

  const restart: BootService["Service"]["restart"] = Effect.gen(function* () {
    yield* requireSystemdLinux;
    yield* restartUnit("restarting the service");
  }).pipe(Effect.withSpan("cloud.boot_service.restart"));

  const install: BootService["Service"]["install"] = Effect.gen(function* () {
    yield* requireSystemdLinux;
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

    yield* ensureNoCompetingRuntime;
    yield* fs
      .makeDirectory(input.logsDir, { recursive: true })
      .pipe(Effect.mapError((cause) => new BootServiceInstallError({ cause })));
    yield* fs.writeFileString(logPath, "", { flag: "a", mode: 0o600 }).pipe(
      Effect.andThen(fs.chmod(logPath, 0o600)),
      Effect.mapError((cause) => new BootServiceInstallError({ cause })),
    );

    yield* ensurePinnedRuntime;

    yield* writeFileStringAtomically({
      filePath: unitPath,
      contents: renderBootServiceUnit(plan),
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError((cause) => new BootServiceInstallError({ cause })),
    );

    // If any activation step fails, remove the unit again: a leftover file
    // would make the next `notcodex connect` report the service as already set up
    // even though it was never enabled or lingered.
    yield* Effect.gen(function* () {
      yield* runStep("reloading systemd user units", "systemctl", ["--user", "daemon-reload"]);
      yield* runStep("enabling the service", "systemctl", [
        "--user",
        "enable",
        BOOT_SERVICE_UNIT_FILE,
      ]);
      // restart rather than enable --now: --now does not replace an already
      // running process, so repairing a stale unit would leave the old
      // server running until reboot. restart also starts a stopped service.
      yield* restartUnit("starting the service");
      // Linger keeps the user manager (and this service) running without an
      // open session — the whole point on a box reached over SSH. No
      // username argument: loginctl defaults to the calling user, which is
      // always right, while $USER can be stale (su without -l) or unset.
      yield* runStep("enabling lingering for this user", "loginctl", ["enable-linger"]);
    }).pipe(Effect.tapError(() => rollbackFailedInstall(previousUnit)));

    return plan;
  }).pipe(Effect.withSpan("cloud.boot_service.install"));

  // If activation fails partway (e.g. enable succeeds but restart/linger
  // fails), leave nothing behind: disable removes the enable symlink, remove
  // deletes the file, daemon-reload clears the stale definition — otherwise a
  // dangling wants/ symlink logs "Failed to load unit" at every boot and the
  // next connect misreports the state.
  const rollbackFailedInstall = Effect.fn("cloud.boot_service.rollback_failed_install")(function* (
    previousUnit: Option.Option<string>,
  ) {
    // A failed activation is no longer a guaranteed handoff. Clear its marker
    // before stopping a partial fresh install; restoring a previous unit below
    // creates a new marker immediately through restartUnit.
    yield* clearRestartHandoff.pipe(Effect.ignore);
    if (Option.isSome(previousUnit)) {
      yield* fs.writeFileString(unitPath, previousUnit.value).pipe(Effect.ignore);
    } else {
      yield* runStep("cleaning up the service", "systemctl", [
        "--user",
        "disable",
        "--now",
        BOOT_SERVICE_UNIT_FILE,
      ]).pipe(Effect.ignore);
      yield* fs.remove(unitPath).pipe(Effect.ignore);
    }
    yield* runStep("reloading systemd user units", "systemctl", ["--user", "daemon-reload"]).pipe(
      Effect.ignore,
    );
    if (Option.isSome(previousUnit)) {
      yield* runStep("resetting the previous service failure state", "systemctl", [
        "--user",
        "reset-failed",
        BOOT_SERVICE_UNIT_FILE,
      ]).pipe(Effect.ignore);
      yield* runStep("restoring the previous service", "systemctl", [
        "--user",
        "restart",
        BOOT_SERVICE_UNIT_FILE,
      ]).pipe(Effect.ignore);
    }
  });

  const uninstall: BootService["Service"]["uninstall"] = Effect.gen(function* () {
    yield* requireSystemdLinux;
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
    yield* runStep("stopping the service", "systemctl", [
      "--user",
      "disable",
      "--now",
      BOOT_SERVICE_UNIT_FILE,
    ]);
    yield* fs
      .remove(unitPath)
      .pipe(Effect.mapError((cause) => new BootServiceInstallError({ cause })));
    yield* runStep("reloading systemd user units", "systemctl", ["--user", "daemon-reload"]);
    return true;
  }).pipe(Effect.withSpan("cloud.boot_service.uninstall"));

  const status: BootService["Service"]["status"] = Effect.gen(function* () {
    if (platform !== "linux" || homeDir === "") {
      return { supported: false, installed: false, current: false, unitPath, logPath };
    }
    // Linux alone does not imply a usable systemd user manager (notably in
    // containers and WSL without systemd). Probe both activation and linger
    // capabilities before offering setup, so connect cannot perform the
    // pinned npm install only to fail at daemon-reload or loginctl later.
    const userManagerAvailable = yield* runStatusCheck("systemctl", ["--user", "show-environment"]);
    const uidResult = yield* runner.run({ command: "id", args: ["-u"] }).pipe(
      Effect.map((result) => (result.code === 0 ? result.stdout.trim() : "")),
      Effect.orElseSucceed(() => ""),
    );
    const lingerResult =
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
    const lingerAvailable = lingerResult === "yes" || lingerResult === "no";
    if (!userManagerAvailable || !lingerAvailable) {
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
    let current = unit === renderBootServiceUnit(plan) && entryExists;
    if (current) {
      current = yield* runStatusCheck("systemctl", [
        "--user",
        "is-enabled",
        BOOT_SERVICE_UNIT_FILE,
      ]);
    }
    if (current) {
      current = yield* runStatusCheck("systemctl", ["--user", "is-active", BOOT_SERVICE_UNIT_FILE]);
    }
    if (current) {
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
