import type { EnvironmentId, RuntimeMode } from "@notcodex/contracts";

export {
  DEFAULT_MONKEY_LOOPY_SPEC,
  isCurrentLoopSpecExecutionReady,
  normalizeIntegrationRunTimeout,
  parseRunInputsJson,
  type ParsedRunInputs,
} from "@notcodex/client-runtime/state/integration-run-launch";

export const LOOPY_RUNTIME_MODE_OPTIONS = [
  { value: "auto-accept-edits", label: "Auto-accept edits" },
  { value: "full-access", label: "Full access" },
] as const satisfies ReadonlyArray<{ readonly value: RuntimeMode; readonly label: string }>;

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

export function isCurrentLoopSpecValidationRequest(input: {
  readonly requestSequence: number;
  readonly currentRequestSequence: number;
}): boolean {
  return input.requestSequence === input.currentRequestSequence;
}
