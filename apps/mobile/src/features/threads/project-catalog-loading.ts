import type { WorkspaceState } from "../../state/workspaceModel";

export function isProjectCatalogLoading(
  state: Pick<
    WorkspaceState,
    | "isLoadingConnections"
    | "hasConnectingEnvironment"
    | "hasLoadedShellSnapshot"
    | "connectionError"
  >,
): boolean {
  return (
    state.isLoadingConnections ||
    (state.hasConnectingEnvironment &&
      !state.hasLoadedShellSnapshot &&
      state.connectionError === null)
  );
}

export function shouldReturnMissingProjectToPicker(input: {
  readonly projectCount: number;
  readonly catalogState: Parameters<typeof isProjectCatalogLoading>[0];
}): boolean {
  return input.projectCount > 0 || !isProjectCatalogLoading(input.catalogState);
}
