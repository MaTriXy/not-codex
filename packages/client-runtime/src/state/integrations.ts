import { INTEGRATION_WS_METHODS } from "@notcodex/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createIntegrationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:integrations:list",
      tag: INTEGRATION_WS_METHODS.list,
      staleTimeMs: 2_000,
      refreshIntervalMs: 5_000,
    }),
    configureLoopAny: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:loopany:configure",
      tag: INTEGRATION_WS_METHODS.configureLoopAny,
    }),
    testLoopAny: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:loopany:test",
      tag: INTEGRATION_WS_METHODS.testLoopAny,
    }),
    validateMonkeyLoopy: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:monkey-loopy:validate",
      tag: INTEGRATION_WS_METHODS.validateMonkeyLoopy,
    }),
    runMonkeyLoopy: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:monkey-loopy:run",
      tag: INTEGRATION_WS_METHODS.runMonkeyLoopy,
    }),
  } as const;
}
