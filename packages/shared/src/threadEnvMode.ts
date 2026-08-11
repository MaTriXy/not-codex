import type { ThreadEnvMode } from "@notcodex/contracts";

/**
 * Resolve the default for a new thread. An explicit composer selection is
 * applied by callers before this function; project settings override the
 * environment-wide fallback.
 */
export function resolveDefaultThreadEnvMode(sources: {
  readonly projectSetting: ThreadEnvMode | null | undefined;
  readonly globalDefault: ThreadEnvMode;
}): ThreadEnvMode {
  return sources.projectSetting ?? sources.globalDefault;
}
