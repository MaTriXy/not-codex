import type { EnvironmentConnectionPhase } from "@notcodex/client-runtime/connection";
import type { EnvironmentShellStatus } from "@notcodex/client-runtime/state/shell";

export interface RequestedEnvironmentCatalogState {
  readonly catalogIsLoadingConnections: boolean;
  readonly environment: {
    readonly connectionState: EnvironmentConnectionPhase;
    readonly connectionError: string | null;
  } | null;
  readonly shellStatus: EnvironmentShellStatus;
  readonly hasShellSnapshot: boolean;
  readonly shellError: boolean;
}

export function isRequestedProjectCatalogLoading(state: RequestedEnvironmentCatalogState): boolean {
  if (state.environment === null) {
    return state.catalogIsLoadingConnections;
  }
  if (state.hasShellSnapshot || state.environment.connectionError !== null || state.shellError) {
    return false;
  }
  return (
    state.shellStatus === "synchronizing" ||
    state.environment.connectionState === "connecting" ||
    state.environment.connectionState === "reconnecting" ||
    state.environment.connectionState === "connected"
  );
}

export function shouldReturnMissingProjectToPicker(input: {
  readonly catalogState: RequestedEnvironmentCatalogState;
}): boolean {
  return !isRequestedProjectCatalogLoading(input.catalogState);
}
