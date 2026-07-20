import type { MonkeyLoopyValidateResult, RuntimeMode } from "@notcodex/contracts";

export const LOOPY_RUNTIME_MODE_OPTIONS = [
  { value: "auto-accept-edits", label: "Auto-accept edits" },
  { value: "full-access", label: "Full access" },
] as const satisfies ReadonlyArray<{ readonly value: RuntimeMode; readonly label: string }>;

export const DEFAULT_MONKEY_LOOPY_SPEC = `loopspec: "0.1"
id: not-codex-review
meta:
  name: Not Codex review loop
pattern: react
state:
  store: journal
  vars:
    agent_runs: { type: int, init: 0 }
body:
  - id: review
    kind: agent
    harness: not-codex
    prompt: Review the current work and complete one safe, verifiable improvement.
    on_done: { incr: agent_runs }
terminate:
  signal: state-predicate
  until: "\${state.agent_runs >= 1}"
caps:
  max_iterations: 2
  on_cap_exceeded: fail
schedule: { mode: manual }
`;

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

export function isCurrentLoopSpecRequest(input: {
  readonly requestSequence: number;
  readonly currentRequestSequence: number;
}): boolean {
  return input.requestSequence === input.currentRequestSequence;
}

export function normalizeIntegrationRunTimeout(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.max(1, Math.min(240, Math.round(value)));
}
