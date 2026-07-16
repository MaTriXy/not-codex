import { AUTOMATION_WS_METHODS } from "@notcodex/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createAutomationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    definitions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:automations:definitions",
      tag: AUTOMATION_WS_METHODS.listDefinitions,
      staleTimeMs: 2_000,
      refreshIntervalMs: 5_000,
    }),
    runs: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:automations:runs",
      tag: AUTOMATION_WS_METHODS.listRuns,
      staleTimeMs: 1_000,
      refreshIntervalMs: 3_000,
    }),
    run: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:automations:run",
      tag: AUTOMATION_WS_METHODS.getRun,
      staleTimeMs: 1_000,
      refreshIntervalMs: 2_000,
    }),
    templates: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:automations:templates",
      tag: AUTOMATION_WS_METHODS.listTemplates,
      staleTimeMs: 60_000,
    }),
    changes: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:automations:changes",
      tag: AUTOMATION_WS_METHODS.subscribe,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:automations:create",
      tag: AUTOMATION_WS_METHODS.createDefinition,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:automations:update",
      tag: AUTOMATION_WS_METHODS.updateDefinition,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:automations:delete",
      tag: AUTOMATION_WS_METHODS.deleteDefinition,
    }),
    runNow: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:automations:run-now",
      tag: AUTOMATION_WS_METHODS.runNow,
    }),
    cancelRun: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:automations:cancel-run",
      tag: AUTOMATION_WS_METHODS.cancelRun,
    }),
    retryRun: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:automations:retry-run",
      tag: AUTOMATION_WS_METHODS.retryRun,
    }),
  } as const;
}
