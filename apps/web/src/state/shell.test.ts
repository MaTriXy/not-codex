import {
  AVAILABLE_CONNECTION_STATE,
  type SupervisorConnectionState,
} from "@notcodex/client-runtime/connection";
import type { EnvironmentShellState } from "@notcodex/client-runtime/state/shell";
import type { EnvironmentCatalogState } from "@notcodex/client-runtime/state/connections";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import { isEnvironmentCatalogBootstrapReady, isEnvironmentShellBootstrapSettled } from "./shell";

function shellState(overrides: Partial<EnvironmentShellState> = {}): EnvironmentShellState {
  return {
    snapshot: Option.none(),
    status: "empty",
    error: Option.none(),
    ...overrides,
  };
}

function connectionState(
  overrides: Partial<SupervisorConnectionState> = {},
): SupervisorConnectionState {
  return {
    ...AVAILABLE_CONNECTION_STATE,
    desired: true,
    network: "online",
    phase: "connected",
    generation: 1,
    ...overrides,
  };
}

describe("environment shell bootstrap", () => {
  it("waits until the environment catalog has published its initial entries", () => {
    const catalog = (isReady: boolean): EnvironmentCatalogState => ({
      isReady,
      entries: new Map(),
    });

    expect(isEnvironmentCatalogBootstrapReady(catalog(false))).toBe(false);
    expect(isEnvironmentCatalogBootstrapReady(catalog(true))).toBe(true);
  });

  it("keeps waiting while a connected environment has no snapshot or terminal error", () => {
    expect(isEnvironmentShellBootstrapSettled(shellState(), connectionState())).toBe(false);
  });

  it("settles a connected environment after shell synchronization fails", () => {
    expect(
      isEnvironmentShellBootstrapSettled(
        shellState({ error: Option.some("Could not synchronize environment data.") }),
        connectionState(),
      ),
    ).toBe(true);
  });

  it("keeps waiting through early reconnect attempts but settles a terminal disconnect", () => {
    expect(
      isEnvironmentShellBootstrapSettled(
        shellState(),
        connectionState({ phase: "backoff", attempt: 2 }),
      ),
    ).toBe(false);
    expect(
      isEnvironmentShellBootstrapSettled(
        shellState(),
        connectionState({ phase: "backoff", attempt: 3 }),
      ),
    ).toBe(true);
  });
});
