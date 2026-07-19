import { makeIntegrationRetryRequestId } from "@notcodex/client-runtime/state/integration-run-operations";
import type { IntegrationRunState } from "@notcodex/contracts";

export {
  deriveIntegrationRunControls,
  integrationRunOperationConfirmation,
  makeIntegrationRetryRequestId,
  type IntegrationRunControl,
  type IntegrationRunOperation,
  type IntegrationRunOperationConfirmation,
} from "@notcodex/client-runtime/state/integration-run-operations";

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

export interface IntegrationRetryRequest {
  readonly sourceRunId: string;
  readonly requestId: string;
}

export function getOrCreateIntegrationRetryRequest(
  current: IntegrationRetryRequest | null,
  sourceRunId: string,
  uuid: string,
): IntegrationRetryRequest {
  if (current?.sourceRunId === sourceRunId) return current;
  return { sourceRunId, requestId: makeIntegrationRetryRequestId(uuid) };
}
