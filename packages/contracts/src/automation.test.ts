import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  AutomationDefinitionDraft,
  AutomationPublishPolicy,
  AutomationSchedule,
} from "./automation.ts";

const decodeSchedule = Schema.decodeUnknownSync(AutomationSchedule);
const decodePublishPolicy = Schema.decodeUnknownSync(AutomationPublishPolicy);
const decodeDefinitionDraft = Schema.decodeUnknownSync(AutomationDefinitionDraft);

describe("Automation contracts", () => {
  it("accepts supported schedule variants", () => {
    expect(decodeSchedule({ type: "manual" })).toEqual({ type: "manual" });
    expect(
      decodeSchedule({ type: "interval", everyMinutes: 60, anchorAt: "2026-07-16T08:00:00.000Z" }),
    ).toMatchObject({ type: "interval", everyMinutes: 60 });
    expect(
      decodeSchedule({
        type: "calendar",
        timeZone: "Asia/Jerusalem",
        localTime: "09:30",
        weekdays: [0, 1, 2, 3, 4],
      }),
    ).toMatchObject({ type: "calendar", localTime: "09:30" });
  });

  it("rejects invalid calendar time and empty weekdays", () => {
    expect(() =>
      decodeSchedule({
        type: "calendar",
        timeZone: "UTC",
        localTime: "25:00",
        weekdays: [],
      }),
    ).toThrow();
  });

  it("requires explicit confirmation for a ready pull request", () => {
    expect(() =>
      decodePublishPolicy({ type: "ready-pr", titleTemplate: null, confirmed: false }),
    ).toThrow();
    expect(
      decodePublishPolicy({ type: "ready-pr", titleTemplate: null, confirmed: true }),
    ).toMatchObject({
      type: "ready-pr",
      confirmed: true,
    });
  });

  it("decodes a provider-neutral definition draft", () => {
    const decoded = decodeDefinitionDraft({
      projectId: "project-1",
      name: "Daily health check",
      description: null,
      enabled: true,
      prompt: "Review the repository and run the required checks.",
      modelSelection: { instanceId: "codex", model: "gpt-5" },
      runtimeMode: "approval-required",
      schedule: { type: "manual" },
      execution: {
        worktreeMode: "isolated",
        approvalHandling: "pause",
        maxDurationMinutes: 60,
        baseBranch: null,
        cleanupOnSuccess: false,
      },
      completion: { type: "turn-completed" },
      retry: { maxAttempts: 1, initialDelaySeconds: 0, maxDelaySeconds: 0 },
      publish: { type: "never" },
      notifications: {
        onStarted: false,
        onWaiting: true,
        onSucceeded: true,
        onFailed: true,
      },
    });

    expect(decoded.modelSelection.instanceId).toBe("codex");
    expect(decoded.schedule.type).toBe("manual");
  });
});
