import {
  ProviderDriverKind,
  type ModelCapabilities,
  type PiSettings,
  type ServerProviderModel,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@notcodex/contracts";
import { createModelCapabilities } from "@notcodex/shared/model";
import { compareSemverVersions } from "@notcodex/shared/semver";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { PiRuntime } from "../piRuntime.ts";
import {
  buildSelectOptionDescriptor,
  buildServerProvider,
  parseGenericCliVersion,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const PROVIDER = ProviderDriverKind.make("pi");
const MINIMUM_PI_VERSION = "0.80.4";
const PI_PRESENTATION = {
  displayName: "Pi",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: false,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function titleCase(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function parseModels(
  value: unknown,
  currentModel: { provider: string; id: string; thinkingLevel?: string } | undefined,
) {
  if (!isRecord(value) || !Array.isArray(value.models)) return [];
  const models: ServerProviderModel[] = [];
  for (const candidate of value.models) {
    if (!isRecord(candidate)) continue;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const provider = typeof candidate.provider === "string" ? candidate.provider.trim() : "";
    if (!id || !provider) continue;
    const thinkingLevelMap = isRecord(candidate.thinkingLevelMap)
      ? candidate.thinkingLevelMap
      : undefined;
    const thinkingLevels =
      candidate.reasoning === true
        ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"].filter((level) => {
            const mapped = thinkingLevelMap?.[level];
            if (mapped === null) return false;
            return level === "xhigh" || level === "max" ? mapped !== undefined : true;
          })
        : [];
    const capabilities = createModelCapabilities({
      optionDescriptors:
        thinkingLevels.length === 0
          ? []
          : [
              buildSelectOptionDescriptor({
                id: "thinking",
                label: "Thinking",
                options: thinkingLevels.map((level) => ({
                  value: level,
                  label: titleCase(level),
                  isDefault:
                    level ===
                    (currentModel?.provider === provider && currentModel.id === id
                      ? currentModel.thinkingLevel
                      : "medium"),
                })),
              }),
            ],
    });
    const slug = `${provider}/${id}`;
    models.push({
      slug,
      name:
        typeof candidate.name === "string" && candidate.name.trim().length > 0
          ? candidate.name.trim()
          : id,
      shortName: id,
      subProvider: provider,
      isCustom: false,
      ...(currentModel?.provider === provider && currentModel.id === id ? { isDefault: true } : {}),
      capabilities,
    });
  }
  return models.sort((left, right) => {
    if (left.isDefault) return -1;
    if (right.isDefault) return 1;
    return `${left.subProvider}/${left.slug}`.localeCompare(`${right.subProvider}/${right.slug}`);
  });
}

function parseState(
  value: unknown,
): { readonly provider: string; readonly id: string; readonly thinkingLevel?: string } | undefined {
  if (!isRecord(value) || !isRecord(value.model)) return undefined;
  const provider = typeof value.model.provider === "string" ? value.model.provider.trim() : "";
  const id = typeof value.model.id === "string" ? value.model.id.trim() : "";
  return provider && id
    ? {
        provider,
        id,
        ...(typeof value.thinkingLevel === "string" ? { thinkingLevel: value.thinkingLevel } : {}),
      }
    : undefined;
}

function parseCommands(value: unknown): {
  readonly slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
} {
  if (!isRecord(value) || !Array.isArray(value.commands)) {
    return { slashCommands: [], skills: [] };
  }
  const slashCommands: ServerProviderSlashCommand[] = [];
  const skills: ServerProviderSkill[] = [];
  for (const candidate of value.commands) {
    if (!isRecord(candidate) || typeof candidate.name !== "string" || !candidate.name.trim()) {
      continue;
    }
    const name = candidate.name.trim();
    const description =
      typeof candidate.description === "string" && candidate.description.trim()
        ? candidate.description.trim()
        : undefined;
    slashCommands.push({ name, ...(description ? { description } : {}) });
    if (candidate.source === "skill") {
      const sourceInfo = isRecord(candidate.sourceInfo) ? candidate.sourceInfo : candidate;
      const path = typeof sourceInfo.path === "string" ? sourceInfo.path.trim() : "";
      if (path) {
        skills.push({
          name: name.replace(/^skill:/, ""),
          ...(description ? { description, shortDescription: description } : {}),
          path,
          scope:
            typeof sourceInfo.scope === "string"
              ? sourceInfo.scope
              : typeof sourceInfo.location === "string"
                ? sourceInfo.location
                : "pi",
          enabled: true,
          displayName: titleCase(name.replace(/^skill:/, "")),
        });
      }
    }
  }
  return { slashCommands, skills };
}

function piEnvironment(settings: PiSettings, environment?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...environment,
    ...(settings.agentDir ? { PI_CODING_AGENT_DIR: settings.agentDir } : {}),
  };
}

export const makePendingPiProvider = Effect.fn("makePendingPiProvider")(function* (
  settings: PiSettings,
): Effect.fn.Return<ServerProviderDraft> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  return buildServerProvider({
    presentation: PI_PRESENTATION,
    enabled: settings.enabled,
    checkedAt,
    models: providerModelsFromSettings([], PROVIDER, settings.customModels, EMPTY_CAPABILITIES),
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: settings.enabled ? "Checking Pi availability…" : "Pi is disabled in settings.",
    },
  });
});

export const checkPiProviderStatus = Effect.fn("checkPiProviderStatus")(function* (
  settings: PiSettings,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<ServerProviderDraft, never, PiRuntime> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (!settings.enabled) return yield* makePendingPiProvider(settings);
  const piRuntime = yield* PiRuntime;
  const resolvedEnvironment = piEnvironment(settings, environment);
  const versionExit = yield* Effect.exit(
    piRuntime
      .runCommand({
        binaryPath: settings.binaryPath,
        args: ["--version"],
        cwd,
        environment: resolvedEnvironment,
      })
      .pipe(Effect.timeout("4 seconds")),
  );
  if (Exit.isFailure(versionExit)) {
    const detail = String(Cause.squash(versionExit.cause));
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: [],
      probe: {
        installed: false,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: detail.toLowerCase().includes("not found")
          ? "Pi CLI (`pi`) is not installed or not on PATH."
          : `Failed to run Pi CLI: ${detail}`,
      },
    });
  }
  const version = parseGenericCliVersion(versionExit.value.stdout);
  if (!version || compareSemverVersions(version, MINIMUM_PI_VERSION) < 0) {
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: [],
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: version
          ? `Pi v${version} is too old. Upgrade to v${MINIMUM_PI_VERSION} or newer.`
          : `Unable to determine Pi version. Not Codex requires v${MINIMUM_PI_VERSION} or newer.`,
      },
    });
  }

  const inventoryExit = yield* Effect.exit(
    Effect.scoped(
      Effect.gen(function* () {
        const process = yield* piRuntime.start({
          binaryPath: settings.binaryPath,
          cwd,
          environment: resolvedEnvironment,
          args: [
            "--mode",
            "rpc",
            "--no-session",
            "--no-tools",
            "--no-extensions",
            "--no-context-files",
            settings.projectTrust === "trust" ? "--approve" : "--no-approve",
            "--offline",
          ],
        });
        const [state, modelResponse, commandResponse] = yield* Effect.all(
          [
            process.client.request({ type: "get_state" }),
            process.client.request({ type: "get_available_models" }),
            process.client.request({ type: "get_commands" }),
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.timeout("8 seconds"));
        return {
          state: state.data,
          models: modelResponse.data,
          commands: commandResponse.data,
        };
      }),
    ),
  );
  if (Exit.isFailure(inventoryExit)) {
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: [],
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: `Pi RPC health check failed: ${String(Cause.squash(inventoryExit.cause))}`,
      },
    });
  }

  const models = providerModelsFromSettings(
    parseModels(inventoryExit.value.models, parseState(inventoryExit.value.state)),
    PROVIDER,
    settings.customModels,
    EMPTY_CAPABILITIES,
  );
  const commands = parseCommands(inventoryExit.value.commands);
  return buildServerProvider({
    presentation: PI_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    slashCommands: commands.slashCommands,
    skills: commands.skills,
    probe: {
      installed: true,
      version,
      status: models.length > 0 ? "ready" : "warning",
      auth: { status: models.length > 0 ? "authenticated" : "unauthenticated", type: "pi" },
      message:
        models.length > 0
          ? `${models.length} configured model${models.length === 1 ? "" : "s"} available through Pi.`
          : "Pi is installed, but no authenticated models are available. Configure a provider with `pi auth login`.",
    },
  });
});

export { MINIMUM_PI_VERSION };
