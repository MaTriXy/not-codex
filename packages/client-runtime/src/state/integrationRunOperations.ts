import type {
  IntegrationInspectRunResult,
  IntegrationRun,
  IntegrationRunOperationAvailability,
} from "@notcodex/contracts";

export type IntegrationRunOperation = "cancel" | "resume" | "retry";

export interface IntegrationRunControl {
  readonly operation: IntegrationRunOperation;
  readonly disabled: boolean;
  readonly disabledReason: string | null;
}

export interface IntegrationRunOperationConfirmation {
  readonly title: string;
  readonly description: string;
  readonly consequence: string;
  readonly confirmLabel: string;
}

export interface IntegrationRetryRequest {
  readonly sourceRunId: string;
  readonly requestId: string;
}

const OPERATION_ORDER: ReadonlyArray<IntegrationRunOperation> = ["cancel", "resume", "retry"];

export function deriveIntegrationRunControls(input: {
  readonly inspection: IntegrationInspectRunResult;
  readonly connected: boolean;
  readonly queryPending: boolean;
  readonly pendingOperation: IntegrationRunOperation | null;
}): ReadonlyArray<IntegrationRunControl> {
  return OPERATION_ORDER.flatMap((operation) => {
    const availability: IntegrationRunOperationAvailability =
      input.inspection.operations[operation];
    if (!availability.allowed) return [];

    const disabledReason = !input.connected
      ? "Reconnect to this environment before controlling the run."
      : input.queryPending
        ? "Waiting for the latest durable run state."
        : input.pendingOperation !== null
          ? "Another run operation is already in progress."
          : null;
    return [{ operation, disabled: disabledReason !== null, disabledReason }];
  });
}

export function integrationRunOperationConfirmation(
  operation: IntegrationRunOperation,
  run: IntegrationRun,
): IntegrationRunOperationConfirmation {
  switch (operation) {
    case "cancel":
      return {
        title: "Cancel this run?",
        description: "Not Codex will request a graceful stop and interrupt any active agent turn.",
        consequence:
          "Completed work and the durable timeline remain available, but this attempt cannot continue unless it becomes eligible for retry.",
        confirmLabel: "Cancel run",
      };
    case "resume":
      return {
        title: "Resume this run?",
        description:
          run.state === "waiting"
            ? "Not Codex will approve the current cap breakpoint and continue this same journaled attempt."
            : "Not Codex will continue this restart-interrupted run from its existing journal.",
        consequence:
          "The run keeps the same id, attempt, journal, governed inputs, and linked thread history.",
        confirmLabel: "Resume run",
      };
    case "retry":
      return {
        title: "Retry this run?",
        description: "Not Codex will create and start a new durable attempt from this run.",
        consequence:
          "The original attempt remains unchanged. The new run gets its own id and journal with an explicit parent link.",
        confirmLabel: "Create retry",
      };
  }
}

export function makeIntegrationRetryRequestId(uuid: string): string {
  return `retry-${uuid.replaceAll("-", "")}`.slice(0, 120);
}

export function getOrCreateIntegrationRetryRequest(
  current: IntegrationRetryRequest | null,
  sourceRunId: string,
  uuid: string,
): IntegrationRetryRequest {
  if (current?.sourceRunId === sourceRunId) return current;
  return { sourceRunId, requestId: makeIntegrationRetryRequestId(uuid) };
}
