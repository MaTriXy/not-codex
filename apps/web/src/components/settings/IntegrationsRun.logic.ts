import type { EnvironmentId, MonkeyLoopyValidateResult, RuntimeMode } from "@notcodex/contracts";

export const LOOPY_RUNTIME_MODE_OPTIONS = [
  { value: "auto-accept-edits", label: "Auto-accept edits" },
  { value: "full-access", label: "Full access" },
] as const satisfies ReadonlyArray<{ readonly value: RuntimeMode; readonly label: string }>;

export type ParsedRunInputs =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly message: string };

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

export function parseRunInputsJson(value: string): ParsedRunInputs {
  if (value.trim().length === 0) return { ok: true, value: {} };
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      return { ok: false, message: "Inputs must be a JSON object keyed by input name." };
    }
    return { ok: true, value: parsed as Readonly<Record<string, unknown>> };
  } catch {
    return { ok: false, message: "Inputs must be valid JSON before the loop can run." };
  }
}

export function isCurrentLoopSpecExecutionReady(input: {
  readonly yaml: string;
  readonly validatedYaml: string | null;
  readonly validation: MonkeyLoopyValidateResult | null;
}): boolean {
  return input.validation?.executionReady === true && input.validatedYaml === input.yaml;
}
