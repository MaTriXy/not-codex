import type { LoopAnySettings } from "@notcodex/contracts";

export interface LoopAnySettingsDraft {
  readonly enabled: boolean;
  readonly serverUrl: string;
  readonly allowedRootsText: string;
  readonly pollWaitSecondsText: string;
  readonly tokenConfigured: boolean;
  readonly replacementToken: string;
}

export type LoopAnySettingsDraftValidation =
  | { readonly ok: true; readonly settings: LoopAnySettings }
  | { readonly ok: false; readonly message: string };

export interface LoopAnySettingsSyncBarrier {
  readonly staleSettings: LoopAnySettings | null;
  readonly appliedSettings: LoopAnySettings;
}

function loopAnySettingsEqual(left: LoopAnySettings, right: LoopAnySettings): boolean {
  return (
    left.enabled === right.enabled &&
    left.serverUrl === right.serverUrl &&
    left.pollWaitSeconds === right.pollWaitSeconds &&
    left.allowedRoots.length === right.allowedRoots.length &&
    left.allowedRoots.every((root, index) => root === right.allowedRoots[index])
  );
}

export function reconcileLoopAnySettingsSnapshot(
  settings: LoopAnySettings,
  barrier: LoopAnySettingsSyncBarrier | null,
): {
  readonly apply: boolean;
  readonly barrier: LoopAnySettingsSyncBarrier | null;
} {
  if (barrier === null) return { apply: true, barrier: null };
  if (loopAnySettingsEqual(settings, barrier.appliedSettings)) {
    return { apply: true, barrier: null };
  }
  if (barrier.staleSettings !== null && loopAnySettingsEqual(settings, barrier.staleSettings)) {
    return { apply: false, barrier };
  }
  return { apply: true, barrier: null };
}

export function parseLoopAnyAllowedRoots(value: string): ReadonlyArray<string> {
  return [
    ...new Set(
      value
        .split("\n")
        .map((root) => root.trim())
        .filter(Boolean),
    ),
  ];
}

function isAbsoluteProjectRoot(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value);
}

function validateServerUrl(value: string): string | null {
  if (value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "LoopAny server URL must use HTTPS or HTTP.";
    }
    if (url.username.length > 0 || url.password.length > 0) {
      return "LoopAny server URL must not contain embedded credentials.";
    }
  } catch {
    return "Enter a valid LoopAny server URL.";
  }
  return null;
}

/**
 * Validates only client-visible configuration. The returned object deliberately
 * excludes the write-only device token; callers send it separately when present.
 */
export function validateLoopAnySettingsDraft(
  draft: LoopAnySettingsDraft,
): LoopAnySettingsDraftValidation {
  const serverUrl = draft.serverUrl.trim();
  const urlError = validateServerUrl(serverUrl);
  if (urlError !== null) return { ok: false, message: urlError };

  const allowedRoots = parseLoopAnyAllowedRoots(draft.allowedRootsText);
  if (allowedRoots.some((root) => !isAbsoluteProjectRoot(root))) {
    return {
      ok: false,
      message: "Each allowed project root must be an absolute macOS, Linux, or Windows path.",
    };
  }

  const pollWaitSeconds = Number(draft.pollWaitSecondsText);
  if (!Number.isInteger(pollWaitSeconds) || pollWaitSeconds < 5 || pollWaitSeconds > 60) {
    return { ok: false, message: "Long-poll wait must be a whole number from 5 to 60 seconds." };
  }

  if (draft.enabled && serverUrl.length === 0) {
    return { ok: false, message: "Enter a LoopAny server URL before enabling the connector." };
  }
  if (draft.enabled && allowedRoots.length === 0) {
    return {
      ok: false,
      message: "Add at least one allowed project root before enabling the connector.",
    };
  }
  if (draft.enabled && !draft.tokenConfigured && draft.replacementToken.trim().length === 0) {
    return {
      ok: false,
      message: "Enter a device token before enabling the connector.",
    };
  }

  return {
    ok: true,
    settings: {
      enabled: draft.enabled,
      serverUrl,
      allowedRoots: [...allowedRoots],
      pollWaitSeconds,
    },
  };
}
