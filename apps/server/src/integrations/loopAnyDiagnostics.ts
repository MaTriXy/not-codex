import type {
  IntegrationRequestError,
  LoopAnyConnectorDiagnostics,
  LoopAnyDiagnosticCode,
  LoopAnyDiagnosticEvent,
  LoopAnyHealthState,
} from "@notcodex/contracts";
import * as DateTime from "effect/DateTime";

import { sanitizeIntegrationRunText } from "./integrationRun.ts";
import { LOOPANY_PROTOCOL_COMPATIBILITY } from "./loopanyCompatibility.ts";

export const LOOPANY_PROTOCOL_VERSION = LOOPANY_PROTOCOL_COMPATIBILITY.version;
export const LOOPANY_RETRY_DELAY_MS = 3_000;

const EVENT_PRESENTATION = {
  "connector-disabled": { severity: "info", summary: "LoopAny connector disabled" },
  "connector-misconfigured": {
    severity: "error",
    summary: "LoopAny connector configuration is incomplete",
  },
  "poll-succeeded": { severity: "info", summary: "Delivery poll succeeded" },
  "poll-failed": { severity: "warning", summary: "Delivery poll failed; retry scheduled" },
  unauthorized: { severity: "error", summary: "LoopAny rejected the configured device token" },
  "protocol-error": {
    severity: "error",
    summary: "LoopAny returned an unsupported or malformed response",
  },
  "delivery-accepted": { severity: "info", summary: "Delivery accepted" },
  "delivery-duplicate": { severity: "warning", summary: "Duplicate delivery ignored" },
  "delivery-running": { severity: "info", summary: "Delivery execution started" },
  "workflow-fallback": {
    severity: "warning",
    summary: "Delivered workflow was treated as inert fallback context",
  },
  "root-rejected": { severity: "error", summary: "Delivery rejected by allowed-root policy" },
  "execution-failed": { severity: "error", summary: "Delivery execution failed" },
  "report-failed": { severity: "error", summary: "Terminal report delivery failed" },
  "delivery-succeeded": { severity: "info", summary: "Delivery completed successfully" },
} as const satisfies Record<
  LoopAnyDiagnosticCode,
  { readonly severity: LoopAnyDiagnosticEvent["severity"]; readonly summary: string }
>;

export function loopAnyDiagnosticEvent(input: {
  readonly id: string;
  readonly code: LoopAnyDiagnosticCode;
  readonly runId: string | null;
  readonly occurredAt: string;
}): LoopAnyDiagnosticEvent {
  const presentation = EVENT_PRESENTATION[input.code];
  return {
    ...input,
    severity: presentation.severity,
    summary: sanitizeIntegrationRunText(presentation.summary, 500),
  };
}

export function appendLoopAnyDiagnosticEvent(
  events: ReadonlyArray<LoopAnyDiagnosticEvent>,
  event: LoopAnyDiagnosticEvent,
): Array<LoopAnyDiagnosticEvent> {
  const latest = events.at(-1);
  const next =
    latest?.code === event.code && latest.runId === event.runId
      ? [...events.slice(0, -1), event]
      : [...events, event];
  return next.slice(-50);
}

export function loopAnyPollFailureState(error: IntegrationRequestError): {
  readonly health: LoopAnyHealthState;
  readonly code: LoopAnyDiagnosticCode;
  readonly message: string;
} {
  if (error.code === "unauthorized") {
    return {
      health: "unauthorized",
      code: "unauthorized",
      message: "LoopAny rejected the configured device token.",
    };
  }
  if (error.code === "validation-failed" || error.code === "version-mismatch") {
    return {
      health: "protocol-error",
      code: "protocol-error",
      message: "LoopAny returned an unsupported or malformed response.",
    };
  }
  if (error.code === "invalid-config" || error.code === "not-configured") {
    return {
      health: "misconfigured",
      code: "connector-misconfigured",
      message: "LoopAny connector configuration is incomplete.",
    };
  }
  return {
    health: "backing-off",
    code: "poll-failed",
    message: "LoopAny could not be reached; polling will retry.",
  };
}

export function makeLoopAnyDiagnostics(input: {
  readonly now: string;
  readonly persisted?: LoopAnyConnectorDiagnostics | undefined;
}): LoopAnyConnectorDiagnostics {
  return {
    health: "connecting",
    protocolVersion: LOOPANY_PROTOCOL_VERSION,
    serverVersion: input.persisted?.serverVersion ?? null,
    lastPollAt: input.persisted?.lastPollAt ?? null,
    lastSuccessAt: input.persisted?.lastSuccessAt ?? null,
    nextRetryAt: null,
    consecutiveFailures: input.persisted?.consecutiveFailures ?? 0,
    inFlight: 0,
    lastError: input.persisted?.lastError ?? null,
    recentEvents: [...(input.persisted?.recentEvents ?? [])].slice(-50),
    updatedAt: input.now,
  };
}

export function loopAnyRetryAt(now: string): string {
  return DateTime.formatIso(
    DateTime.add(DateTime.makeUnsafe(now), { milliseconds: LOOPANY_RETRY_DELAY_MS }),
  );
}
