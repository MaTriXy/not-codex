import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command, GlobalFlag } from "effect/unstable/cli";

import packageJson from "../../package.json" with { type: "json" };
import * as BootService from "../cloud/bootService.ts";
import { resolveConnectRuntimeEnvironment } from "../cloud/publicConfig.ts";
import type * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

export const bootServiceLayer = (config: ServerConfig.ServerConfig["Service"]) =>
  BootService.layer({
    baseDir: config.baseDir,
    logsDir: config.logsDir,
    cliVersion: packageJson.version,
    connectEnvironment: resolveConnectRuntimeEnvironment(),
    serverRuntimeStatePath: config.serverRuntimeStatePath,
  }).pipe(Layer.provide(ProcessRunner.layer));

export type ServiceReconcileResult =
  | {
      readonly changed: false;
      readonly status: BootService.BootServiceStatus;
    }
  | {
      readonly changed: true;
      readonly previouslyInstalled: boolean;
      readonly plan: BootService.BootServicePlan;
    };

/** Install, update, or repair the service using the CLI version running this command. */
export const reconcileService = Effect.fn("cli.service.reconcile")(function* () {
  const service = yield* BootService.BootService;
  const status = yield* service.status;
  if (status.installed && status.current) {
    return { changed: false, status } satisfies ServiceReconcileResult;
  }
  const plan = yield* service.install;
  return {
    changed: true,
    previouslyInstalled: status.installed,
    plan,
  } satisfies ServiceReconcileResult;
});

export function formatServiceStatus(
  status: BootService.BootServiceStatus,
  cliVersion: string,
): string {
  if (!status.supported) {
    return "Not Codex service\n  Status: unavailable on this machine\n  Supported on: Linux with systemd, macOS with launchd";
  }
  if (!status.installed) {
    return "Not Codex service\n  Status: not installed\n  Next: Run `notcodex service install`.";
  }
  return [
    "Not Codex service",
    `  Status: ${status.current ? `installed · notcodex@${cliVersion}` : "needs an update or repair"}`,
    `  Unit: ${status.unitPath}`,
    `  Logs: ${status.logPath}`,
    ...(status.current ? [] : ["  Next: Run `npx notcodex@latest service update`."]),
  ].join("\n");
}

const runServiceCommand = Effect.fn("cli.service.run")(function* <A, E>(
  flags: { readonly baseDir: Parameters<typeof resolveCliAuthConfig>[0]["baseDir"] },
  run: Effect.Effect<A, E, BootService.BootService>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  return yield* run.pipe(Effect.provide(bootServiceLayer(config)));
});

const serviceInstallCommand = Command.make("install", projectLocationFlags).pipe(
  Command.withDescription("Install Not Codex as a background service for this user."),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const result = yield* reconcileService();
        if (!result.changed) {
          yield* Console.log(
            `Not Codex service is already installed with notcodex@${packageJson.version}.`,
          );
          return;
        }
        yield* Console.log(
          `${result.previouslyInstalled ? "Updated" : "Installed"} Not Codex service with notcodex@${packageJson.version}.\nLogs: ${result.plan.logPath}`,
        );
      }),
    ),
  ),
);

const serviceUpdateCommand = Command.make("update", projectLocationFlags).pipe(
  Command.withDescription(
    "Update or repair the background service using this CLI version. Use `npx notcodex@latest service update` for the latest release.",
  ),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const result = yield* reconcileService();
        if (!result.changed) {
          yield* Console.log(`Not Codex service is already using notcodex@${packageJson.version}.`);
          return;
        }
        yield* Console.log(
          `${result.previouslyInstalled ? "Updated" : "Installed"} Not Codex service with notcodex@${packageJson.version}.\nLogs: ${result.plan.logPath}`,
        );
      }),
    ),
  ),
);

const serviceUninstallCommand = Command.make("uninstall", projectLocationFlags).pipe(
  Command.withDescription("Stop and remove the Not Codex background service."),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const service = yield* BootService.BootService;
        const removed = yield* service.uninstall;
        yield* Console.log(
          removed ? "Removed the Not Codex service." : "Not Codex service is not installed.",
        );
      }),
    ),
  ),
);

const serviceStatusCommand = Command.make("status", projectLocationFlags).pipe(
  Command.withDescription("Show whether the Not Codex background service is installed."),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const service = yield* BootService.BootService;
        yield* Console.log(formatServiceStatus(yield* service.status, packageJson.version));
      }),
    ),
  ),
);

export const serviceCommand = Command.make("service").pipe(
  Command.withDescription("Manage the Not Codex background service."),
  Command.withSubcommands([
    serviceInstallCommand,
    serviceUninstallCommand,
    serviceUpdateCommand,
    serviceStatusCommand,
  ]),
);
