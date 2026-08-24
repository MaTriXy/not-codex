import type { EnvironmentId, ServerConfig, ServerSelfUpdateCapability } from "@notcodex/contracts";
import { compareSemverVersions, parseSemver } from "@notcodex/shared/semver";
import * as Schema from "effect/Schema";

import { APP_VERSION } from "./branding";
import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";

export interface VersionMismatch {
  readonly clientVersion: string;
  readonly serverVersion: string;
  readonly hint: string;
}

export const VERSION_MISMATCH_DISMISSALS_STORAGE_KEY = "notcodex:version-mismatch-dismissals:v1";

const VersionMismatchDismissalsSchema = Schema.Struct({
  keys: Schema.Array(Schema.String),
});

type VersionMismatchDismissals = typeof VersionMismatchDismissalsSchema.Type;

function normalizeVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function resolveVersionMismatch(
  serverVersion: string | null | undefined,
): VersionMismatch | null {
  const normalizedClientVersion = normalizeVersion(APP_VERSION);
  const normalizedServerVersion = normalizeVersion(serverVersion);
  if (!normalizedClientVersion || !normalizedServerVersion) {
    return null;
  }

  const versionCore = (version: string) => version.replace(/[-+].*$/, "");
  const clientCore = versionCore(normalizedClientVersion);
  const serverCore = versionCore(normalizedServerVersion);
  const serverIsBehind =
    parseSemver(clientCore) && parseSemver(serverCore)
      ? compareSemverVersions(serverCore, clientCore) < 0
      : normalizedServerVersion !== normalizedClientVersion;
  if (!serverIsBehind) return null;

  return {
    clientVersion: normalizedClientVersion,
    serverVersion: normalizedServerVersion,
    hint: "Version mismatch. Try syncing the client and server to the same Not Codex version.",
  };
}

export function resolveServerSelfUpdateCapability(
  serverConfig: Pick<ServerConfig, "environment"> | null | undefined,
): ServerSelfUpdateCapability | null {
  return serverConfig?.environment.capabilities.serverSelfUpdate ?? null;
}

export function manualServerUpdateCommand(targetVersion: string): string {
  return `npx notcodex@${targetVersion}`;
}

export function serverUpdateGuidance(
  capability: ServerSelfUpdateCapability | null,
  serverLabel: string,
): string {
  switch (capability) {
    case "boot-service":
    case "respawn":
      return `Update the ${serverLabel} so they stay in sync.`;
    case "desktop-managed":
      return `Update the desktop app that runs the ${serverLabel}.`;
    default:
      return `Relaunch the ${serverLabel} with the copied command to sync them.`;
  }
}

export function resolveServerConfigVersionMismatch(
  serverConfig: Pick<ServerConfig, "environment"> | null | undefined,
): VersionMismatch | null {
  return resolveVersionMismatch(serverConfig?.environment.serverVersion);
}

export function buildVersionMismatchDismissalKey(
  environmentId: EnvironmentId,
  mismatch: Pick<VersionMismatch, "clientVersion" | "serverVersion">,
): string {
  return `${environmentId}:${mismatch.clientVersion}:${mismatch.serverVersion}`;
}

function readVersionMismatchDismissals(): VersionMismatchDismissals {
  try {
    return (
      getLocalStorageItem(
        VERSION_MISMATCH_DISMISSALS_STORAGE_KEY,
        VersionMismatchDismissalsSchema,
      ) ?? { keys: [] }
    );
  } catch (error) {
    console.error("Could not read version-mismatch dismissals.", error);
    return { keys: [] };
  }
}

function writeVersionMismatchDismissals(document: VersionMismatchDismissals): void {
  try {
    setLocalStorageItem(
      VERSION_MISMATCH_DISMISSALS_STORAGE_KEY,
      document,
      VersionMismatchDismissalsSchema,
    );
  } catch (error) {
    console.error("Could not persist version-mismatch dismissals.", error);
  }
}

export function isVersionMismatchDismissed(dismissalKey: string | null | undefined): boolean {
  if (!dismissalKey) {
    return false;
  }
  return readVersionMismatchDismissals().keys.includes(dismissalKey);
}

export function dismissVersionMismatch(dismissalKey: string | null | undefined): void {
  if (!dismissalKey) {
    return;
  }
  const document = readVersionMismatchDismissals();
  if (document.keys.includes(dismissalKey)) {
    return;
  }
  writeVersionMismatchDismissals({
    keys: [...document.keys, dismissalKey],
  });
}

export function appendVersionMismatchHint(
  message: string | null | undefined,
  mismatch: VersionMismatch | null | undefined,
): string | null {
  const normalizedMessage = normalizeVersion(message);
  if (!normalizedMessage) {
    return mismatch?.hint ?? null;
  }
  if (!mismatch) {
    return normalizedMessage;
  }
  return `${normalizedMessage} Hint: ${mismatch.hint}`;
}
