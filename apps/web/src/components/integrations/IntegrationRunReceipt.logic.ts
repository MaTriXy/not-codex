import type { IntegrationRunState } from "@notcodex/contracts";

export const TERMINAL_INTEGRATION_RUN_STATES = new Set<IntegrationRunState>([
  "succeeded",
  "failed",
  "cancelled",
]);

export function shouldAutoRefreshIntegrationRunReceipt(input: {
  readonly state: IntegrationRunState | null;
  readonly isPending: boolean;
  readonly error: string | null;
}): boolean {
  return (
    !input.isPending &&
    input.error === null &&
    input.state !== null &&
    !TERMINAL_INTEGRATION_RUN_STATES.has(input.state)
  );
}
