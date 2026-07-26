import { describe, expect, it } from "@effect/vitest";

import {
  isRequestedProjectCatalogLoading,
  shouldReleaseMissingProjectReservation,
  shouldReturnMissingProjectToPicker,
} from "./project-catalog-loading";

describe("requested project catalog loading", () => {
  it("waits for the target environment rather than another environment's catalog", () => {
    expect(
      isRequestedProjectCatalogLoading({
        catalogIsLoadingConnections: false,
        environment: { connectionState: "connected", connectionError: null },
        shellStatus: "synchronizing",
        hasShellSnapshot: false,
        shellError: false,
      }),
    ).toBe(true);
  });

  it("waits while the connection catalog is still locating the target environment", () => {
    expect(
      isRequestedProjectCatalogLoading({
        catalogIsLoadingConnections: true,
        environment: null,
        shellStatus: "empty",
        hasShellSnapshot: false,
        shellError: false,
      }),
    ).toBe(true);
  });

  it("returns a missing target after its environment snapshot has settled", () => {
    expect(
      shouldReturnMissingProjectToPicker({
        catalogState: {
          catalogIsLoadingConnections: false,
          environment: { connectionState: "connected", connectionError: null },
          shellStatus: "live",
          hasShellSnapshot: true,
          shellError: false,
        },
      }),
    ).toBe(true);
  });

  it("returns a missing target when its own environment cannot load", () => {
    expect(
      shouldReturnMissingProjectToPicker({
        catalogState: {
          catalogIsLoadingConnections: false,
          environment: { connectionState: "error", connectionError: "unavailable" },
          shellStatus: "empty",
          hasShellSnapshot: false,
          shellError: true,
        },
      }),
    ).toBe(true);
  });

  it("preserves a missing project reservation while its environment is hydrating", () => {
    expect(
      shouldReleaseMissingProjectReservation({
        catalogState: {
          catalogIsLoadingConnections: false,
          environment: { connectionState: "connected", connectionError: null },
          shellStatus: "synchronizing",
          hasShellSnapshot: false,
          shellError: false,
        },
      }),
    ).toBe(false);
  });

  it("releases a missing project reservation after its catalog settles", () => {
    expect(
      shouldReleaseMissingProjectReservation({
        catalogState: {
          catalogIsLoadingConnections: false,
          environment: { connectionState: "connected", connectionError: null },
          shellStatus: "live",
          hasShellSnapshot: true,
          shellError: false,
        },
      }),
    ).toBe(true);
  });
});
