import type { EnvironmentId } from "@notcodex/contracts";

export {
  DEFAULT_MONKEY_LOOPY_SPEC,
  isCurrentLoopSpecExecutionReady,
  isCurrentLoopSpecRequest,
  LOOPY_RUNTIME_MODE_OPTIONS,
  normalizeIntegrationRunTimeout,
  parseRunInputsJson,
  type ParsedRunInputs,
} from "@notcodex/client-runtime/state/integration-run-launch";

export function resolveRunEnvironmentSelection(input: {
  readonly currentEnvironmentId: EnvironmentId | null;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly availableEnvironmentIds: ReadonlyArray<EnvironmentId>;
}): { readonly environmentId: EnvironmentId | null; readonly changed: boolean } {
  const currentIsAvailable =
    input.currentEnvironmentId !== null &&
    input.availableEnvironmentIds.includes(input.currentEnvironmentId);
  const environmentId = currentIsAvailable
    ? input.currentEnvironmentId
    : (input.primaryEnvironmentId ?? input.availableEnvironmentIds[0] ?? null);
  return { environmentId, changed: environmentId !== input.currentEnvironmentId };
}
