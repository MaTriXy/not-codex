import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";

import { nextAutomationRunAt } from "./automationSchedule.ts";

describe("nextAutomationRunAt", () => {
  it("returns no due time for a manual schedule", () => {
    expect(
      nextAutomationRunAt({ type: "manual" }, DateTime.makeUnsafe("2026-07-16T00:00:00Z")),
    ).toBeNull();
  });

  it("expires a past one-shot and preserves a future one-shot", () => {
    expect(
      nextAutomationRunAt(
        { type: "once", runAt: "2026-07-16T01:00:00Z" },
        DateTime.makeUnsafe("2026-07-16T00:00:00Z"),
      ),
    ).toBe("2026-07-16T01:00:00.000Z");
    expect(
      nextAutomationRunAt(
        { type: "once", runAt: "2026-07-16T01:00:00Z" },
        DateTime.makeUnsafe("2026-07-16T01:00:00Z"),
      ),
    ).toBeNull();
  });

  it("keeps intervals anchored instead of drifting from the current time", () => {
    expect(
      nextAutomationRunAt(
        { type: "interval", everyMinutes: 15, anchorAt: "2026-07-16T00:00:00Z" },
        DateTime.makeUnsafe("2026-07-16T00:16:30Z"),
      ),
    ).toBe("2026-07-16T00:30:00.000Z");
  });

  it("calculates a calendar schedule in its explicit time zone", () => {
    expect(
      nextAutomationRunAt(
        {
          type: "calendar",
          timeZone: "Asia/Jerusalem",
          localTime: "09:30",
          weekdays: [4],
        },
        DateTime.makeUnsafe("2026-07-16T05:00:00Z"),
      ),
    ).toBe("2026-07-16T06:30:00.000Z");
  });

  it("skips a nonexistent DST wall-clock minute", () => {
    expect(
      nextAutomationRunAt(
        {
          type: "calendar",
          timeZone: "America/New_York",
          localTime: "02:30",
          weekdays: [0, 1, 2, 3, 4, 5, 6],
        },
        DateTime.makeUnsafe("2026-03-08T06:00:00Z"),
      ),
    ).toBe("2026-03-09T06:30:00.000Z");
  });

  it("does not run the repeated fall-back wall-clock slot twice", () => {
    const schedule = {
      type: "calendar" as const,
      timeZone: "America/New_York",
      localTime: "01:30",
      weekdays: [0],
    };
    const first = nextAutomationRunAt(schedule, DateTime.makeUnsafe("2026-11-01T04:00:00Z"));
    expect(first).toBe("2026-11-01T05:30:00.000Z");
    expect(nextAutomationRunAt(schedule, DateTime.makeUnsafe(first!))).toBe(
      "2026-11-08T06:30:00.000Z",
    );
  });

  it("rejects an unknown IANA time zone", () => {
    expect(() =>
      nextAutomationRunAt(
        {
          type: "calendar",
          timeZone: "Mars/Olympus",
          localTime: "09:00",
          weekdays: [1],
        },
        DateTime.makeUnsafe("2026-07-16T00:00:00Z"),
      ),
    ).toThrow(RangeError);
  });
});
