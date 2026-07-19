import type { MonkeyLoopyValidateResult } from "@notcodex/contracts";

export type ParsedRunInputs =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly message: string };

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
