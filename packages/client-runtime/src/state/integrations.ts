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
    configureOpenKritt: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:open-kritt:configure",
      tag: INTEGRATION_WS_METHODS.configureOpenKritt,
    }),
    testOpenKritt: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:open-kritt:test",
      tag: INTEGRATION_WS_METHODS.testOpenKritt,
    }),
    refreshOpenKrittCatalog: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:open-kritt:catalog-refresh",
      tag: INTEGRATION_WS_METHODS.refreshOpenKrittCatalog,
    }),
    launchOpenKrittScan: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:open-kritt:scan-launch",
      tag: INTEGRATION_WS_METHODS.launchOpenKrittScan,
    }),
    pauseOpenKrittScan: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:open-kritt:scan-pause",
      tag: INTEGRATION_WS_METHODS.pauseOpenKrittScan,
    }),
    stopOpenKrittScan: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:open-kritt:scan-stop",
      tag: INTEGRATION_WS_METHODS.stopOpenKrittScan,
    }),
    resumeOpenKrittScan: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:open-kritt:scan-resume",
      tag: INTEGRATION_WS_METHODS.resumeOpenKrittScan,
    }),
    listOpenKrittRuns: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:integrations:open-kritt:runs:list",
      tag: INTEGRATION_WS_METHODS.listOpenKrittRuns,
      staleTimeMs: 1_000,
    }),
    listOpenKrittFindings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:integrations:open-kritt:findings:list",
      tag: INTEGRATION_WS_METHODS.listOpenKrittFindings,
      staleTimeMs: 1_000,
    }),
    getOpenKrittFinding: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:integrations:open-kritt:finding:get",
      tag: INTEGRATION_WS_METHODS.getOpenKrittFinding,
      staleTimeMs: 1_000,
    }),
    launchOpenKrittRemediation: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:open-kritt:remediation-launch",
      tag: INTEGRATION_WS_METHODS.launchOpenKrittRemediation,
    }),
    rescanOpenKritt: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:open-kritt:rescan",
      tag: INTEGRATION_WS_METHODS.rescanOpenKritt,
    }),
    compareOpenKrittScans: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:integrations:open-kritt:scans:compare",
      tag: INTEGRATION_WS_METHODS.compareOpenKrittScans,
      staleTimeMs: 1_000,
    }),
    previewOpenKrittSnapshot: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:open-kritt:snapshot-preview",
      tag: INTEGRATION_WS_METHODS.previewOpenKrittSnapshot,
    }),
    createOpenKrittSnapshot: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:open-kritt:snapshot-create",
      tag: INTEGRATION_WS_METHODS.createOpenKrittSnapshot,
    }),
    getMonkeyLoopyAuthoringContext: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:integrations:monkey-loopy:authoring-context",
      tag: INTEGRATION_WS_METHODS.getMonkeyLoopyAuthoringContext,
      staleTimeMs: 60_000,
    }),
    scaffoldMonkeyLoopy: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:monkey-loopy:scaffold",
      tag: INTEGRATION_WS_METHODS.scaffoldMonkeyLoopy,
    }),
    inferMonkeyLoopy: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:monkey-loopy:infer",
      tag: INTEGRATION_WS_METHODS.inferMonkeyLoopy,
    }),
    validateMonkeyLoopy: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:monkey-loopy:validate",
      tag: INTEGRATION_WS_METHODS.validateMonkeyLoopy,
    }),
    runMonkeyLoopy: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:monkey-loopy:run",
      tag: INTEGRATION_WS_METHODS.runMonkeyLoopy,
    }),
    listRuns: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:integrations:runs:list",
      tag: INTEGRATION_WS_METHODS.listRuns,
      staleTimeMs: 1_000,
      refreshIntervalMs: 2_000,
    }),
    getRun: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:integrations:runs:get",
      tag: INTEGRATION_WS_METHODS.getRun,
      staleTimeMs: 500,
    }),
    inspectRun: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:integrations:runs:inspect",
      tag: INTEGRATION_WS_METHODS.inspectRun,
      staleTimeMs: 500,
    }),
    cancelRun: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:runs:cancel",
      tag: INTEGRATION_WS_METHODS.cancelRun,
    }),
    resumeRun: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:runs:resume",
      tag: INTEGRATION_WS_METHODS.resumeRun,
    }),
    retryRun: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:integrations:runs:retry",
      tag: INTEGRATION_WS_METHODS.retryRun,
    }),
  } as const;
}
