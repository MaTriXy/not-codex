import type { IntegrationRun, IntegrationRunOperations } from "@notcodex/contracts";

import { INTERRUPTED_INTEGRATION_RUN_FAILURE } from "./integrationRun.ts";

const unavailableOperation = (reason: string) => ({ allowed: false, reason }) as const;
const availableOperation = { allowed: true, reason: null } as const;

export function integrationRunOperations(run: IntegrationRun): IntegrationRunOperations {
  if (run.source !== "monkey-d-loopy") {
    const unavailable = unavailableOperation(
      "This operation is only available for Monkey.D.Loopy runs.",
    );
    return { cancel: unavailable, resume: unavailable, retry: unavailable };
  }

  const terminal = ["succeeded", "failed", "cancelled"].includes(run.state);
  const restartInterrupted =
    run.state === "cancelled" && run.failure === INTERRUPTED_INTEGRATION_RUN_FAILURE;
  return {
    cancel: terminal
      ? unavailableOperation("Terminal runs cannot be cancelled.")
      : availableOperation,
    resume:
      run.state === "waiting" || restartInterrupted
        ? availableOperation
        : unavailableOperation("Only waiting or restart-interrupted runs can be resumed."),
    retry:
      run.state === "failed" || run.state === "cancelled"
        ? availableOperation
        : unavailableOperation("Only failed or cancelled runs can be retried."),
  };
}

export function limitIntegrationRunOperationsToScope(
  operations: IntegrationRunOperations,
  canOperate: boolean,
): IntegrationRunOperations {
  if (canOperate) return operations;
  const readOnly = unavailableOperation("This connection has read-only orchestration access.");
  return { cancel: readOnly, resume: readOnly, retry: readOnly };
}
