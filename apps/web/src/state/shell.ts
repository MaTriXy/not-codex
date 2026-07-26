import {
  AVAILABLE_CONNECTION_STATE,
  connectionProjectionPhase,
  type SupervisorConnectionState,
} from "@notcodex/client-runtime/connection";
import {
  createEnvironmentShellAtoms,
  createEnvironmentShellSummaryAtom,
  createEnvironmentSnapshotAtom,
  createShellEnvironmentAtoms,
  type EnvironmentShellState,
} from "@notcodex/client-runtime/state/shell";
import type { EnvironmentCatalogState } from "@notcodex/client-runtime/state/connections";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";

export const shellEnvironment = createShellEnvironmentAtoms(connectionAtomRuntime);
export const environmentShell = createEnvironmentShellAtoms(connectionAtomRuntime);
export const environmentSnapshotAtom = createEnvironmentSnapshotAtom(environmentShell.stateAtom);
export const environmentShellSummaryAtom = createEnvironmentShellSummaryAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  shellStateValueAtom: environmentShell.stateValueAtom,
});

export function isEnvironmentShellBootstrapSettled(
  shell: EnvironmentShellState,
  connection: SupervisorConnectionState,
): boolean {
  if (Option.isSome(shell.snapshot) || Option.isSome(shell.error)) {
    return true;
  }
  if (connectionProjectionPhase(connection) !== "disconnected") {
    return false;
  }
  // A retrying environment is only transiently disconnected; give it its
  // first retries before letting the landing settle without its snapshot.
  return !(connection.phase === "backoff" && connection.desired && connection.attempt <= 2);
}

export function isEnvironmentCatalogBootstrapReady(catalog: EnvironmentCatalogState): boolean {
  return catalog.isReady;
}

export const allEnvironmentShellsBootstrappedAtom = Atom.make((get) => {
  const catalog = AsyncResult.value(get(environmentCatalog.catalogAtom));
  if (Option.isNone(catalog) || !isEnvironmentCatalogBootstrapReady(catalog.value)) {
    return false;
  }
  for (const environmentId of catalog.value.entries.keys()) {
    const shell = get(environmentShell.stateValueAtom(environmentId));
    const connection = Option.getOrElse(
      AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
      () => AVAILABLE_CONNECTION_STATE,
    );
    if (!isEnvironmentShellBootstrapSettled(shell, connection)) {
      return false;
    }
  }
  return true;
}).pipe(Atom.withLabel("web-all-environment-shells-bootstrapped"));
