import { IntegrationRequestError } from "@notcodex/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  appendLoopAnyDiagnosticEvent,
  loopAnyDisabledStatus,
  loopAnyDiagnosticEvent,
  loopAnyPollFailureState,
  loopAnyPollStartedStatus,
  loopAnyRetryAt,
  makeLoopAnyDiagnostics,
} from "./loopAnyDiagnostics.ts";

const at = "2026-07-19T10:00:00.000Z";

describe("LoopAny diagnostics", () => {
  it.each([
    ["not-configured", "misconfigured", "connector-misconfigured"],
    ["invalid-config", "misconfigured", "connector-misconfigured"],
    ["unauthorized", "unauthorized", "unauthorized"],
    ["validation-failed", "protocol-error", "protocol-error"],
    ["version-mismatch", "protocol-error", "protocol-error"],
    ["connection-failed", "backing-off", "poll-failed"],
  ] as const)("maps %s failures to an actionable health state", (errorCode, health, code) => {
    const result = loopAnyPollFailureState(
      new IntegrationRequestError({
        code: errorCode,
        message: "Bearer secret-value /private/path",
      }),
    );

    expect(result).toMatchObject({ health, code });
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(JSON.stringify(result)).not.toContain("/private/path");
  });

  it("bounds and collapses repeated recent events", () => {
    const events = Array.from({ length: 55 }, (_, index) =>
      loopAnyDiagnosticEvent({
        id: `event-${index}`,
        code: index % 2 === 0 ? "delivery-accepted" : "delivery-running",
        runId: `loopany-${index}`,
        occurredAt: at,
      }),
    ).reduce(appendLoopAnyDiagnosticEvent, []);
    const repeated = loopAnyDiagnosticEvent({
      id: "replacement",
      code: events.at(-1)!.code,
      runId: events.at(-1)!.runId,
      occurredAt: "2026-07-19T10:00:01.000Z",
    });

    expect(events).toHaveLength(50);
    expect(appendLoopAnyDiagnosticEvent(events, repeated)).toHaveLength(50);
    expect(appendLoopAnyDiagnosticEvent(events, repeated).at(-1)?.id).toBe("replacement");
  });

  it("preserves safe history across restart while resetting live state", () => {
    const event = loopAnyDiagnosticEvent({
      id: "event-1",
      code: "poll-succeeded",
      runId: null,
      occurredAt: at,
    });
    const persisted = {
      ...makeLoopAnyDiagnostics({ now: at }),
      health: "healthy" as const,
      lastSuccessAt: at,
      inFlight: 2,
      recentEvents: [event],
    };

    expect(makeLoopAnyDiagnostics({ now: "2026-07-19T10:01:00.000Z", persisted })).toMatchObject({
      health: "connecting",
      lastSuccessAt: at,
      inFlight: 0,
      recentEvents: [event],
    });
  });

  it("reports the retry time used by the connector worker", () => {
    expect(loopAnyRetryAt(at)).toBe("2026-07-19T10:00:03.000Z");
  });

  it("persists the disabled transition once and then becomes a no-op", () => {
    const current = makeLoopAnyDiagnostics({ now: at });
    const event = loopAnyDiagnosticEvent({
      id: "disabled-1",
      code: "connector-disabled",
      runId: null,
      occurredAt: at,
    });
    const disabled = loopAnyDisabledStatus(current, at, event);

    expect(disabled).toMatchObject({ health: "disabled", recentEvents: [event] });
    expect(loopAnyDisabledStatus(disabled!, "2026-07-19T10:00:03.000Z", event)).toBeNull();
  });

  it("keeps healthy status during long polls and shows connecting while recovering", () => {
    const healthy = {
      ...makeLoopAnyDiagnostics({ now: at }),
      health: "healthy" as const,
      lastSuccessAt: at,
    };
    const backingOff = { ...healthy, health: "backing-off" as const };

    expect(loopAnyPollStartedStatus(healthy, "2026-07-19T10:00:03.000Z", 0).health).toBe("healthy");
    expect(loopAnyPollStartedStatus(backingOff, "2026-07-19T10:00:03.000Z", 0).health).toBe(
      "connecting",
    );
  });
});
