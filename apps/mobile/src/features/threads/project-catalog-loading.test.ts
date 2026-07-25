import { describe, expect, it } from "@effect/vitest";

import {
  isProjectCatalogLoading,
  shouldReturnMissingProjectToPicker,
} from "./project-catalog-loading";

describe("project catalog loading", () => {
  it("waits while saved connections or their first shell snapshot are loading", () => {
    expect(
      isProjectCatalogLoading({
        isLoadingConnections: true,
        hasConnectingEnvironment: false,
        hasLoadedShellSnapshot: false,
        connectionError: null,
      }),
    ).toBe(true);
    expect(
      isProjectCatalogLoading({
        isLoadingConnections: false,
        hasConnectingEnvironment: true,
        hasLoadedShellSnapshot: false,
        connectionError: null,
      }),
    ).toBe(true);
  });

  it("treats a loaded empty or failed catalog as settled", () => {
    expect(
      isProjectCatalogLoading({
        isLoadingConnections: false,
        hasConnectingEnvironment: false,
        hasLoadedShellSnapshot: true,
        connectionError: null,
      }),
    ).toBe(false);
    expect(
      isProjectCatalogLoading({
        isLoadingConnections: false,
        hasConnectingEnvironment: true,
        hasLoadedShellSnapshot: false,
        connectionError: "unavailable",
      }),
    ).toBe(false);
  });

  it("returns a missing target to setup once an empty catalog has settled", () => {
    expect(
      shouldReturnMissingProjectToPicker({
        projectCount: 0,
        catalogState: {
          isLoadingConnections: false,
          hasConnectingEnvironment: false,
          hasLoadedShellSnapshot: true,
          connectionError: null,
        },
      }),
    ).toBe(true);
    expect(
      shouldReturnMissingProjectToPicker({
        projectCount: 0,
        catalogState: {
          isLoadingConnections: true,
          hasConnectingEnvironment: false,
          hasLoadedShellSnapshot: false,
          connectionError: null,
        },
      }),
    ).toBe(false);
  });
});
