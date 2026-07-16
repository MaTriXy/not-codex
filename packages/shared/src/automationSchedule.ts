import type { AutomationSchedule } from "@notcodex/contracts";
import * as DateTime from "effect/DateTime";

const MINUTE_MS = 60_000;
const MAX_CALENDAR_SEARCH_MINUTES = 15 * 24 * 60;
const WEEKDAY_INDEX = new Map([
  ["Sun", 0],
  ["Mon", 1],
  ["Tue", 2],
  ["Wed", 3],
  ["Thu", 4],
  ["Fri", 5],
  ["Sat", 6],
]);

interface LocalMinute {
  readonly slot: string;
  readonly weekday: number;
  readonly localTime: string;
}

function calendarFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function localMinute(formatter: Intl.DateTimeFormat, value: DateTime.Utc): LocalMinute {
  const parts = new Map(
    formatter
      .formatToParts(DateTime.toDate(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const weekdayName = parts.get("weekday") ?? "";
  const weekday = WEEKDAY_INDEX.get(weekdayName);
  if (weekday === undefined) {
    throw new RangeError(`Unsupported calendar weekday: ${weekdayName}`);
  }
  const year = parts.get("year") ?? "";
  const month = parts.get("month") ?? "";
  const day = parts.get("day") ?? "";
  const hour = parts.get("hour") ?? "";
  const minute = parts.get("minute") ?? "";
  return {
    slot: `${year}-${month}-${day}T${hour}:${minute}`,
    weekday,
    localTime: `${hour}:${minute}`,
  };
}

function nextCalendarRun(
  schedule: Extract<AutomationSchedule, { type: "calendar" }>,
  after: DateTime.Utc,
) {
  const formatter = calendarFormatter(schedule.timeZone);
  const afterLocal = localMinute(formatter, after);
  const afterIsScheduledSlot =
    afterLocal.localTime === schedule.localTime && schedule.weekdays.includes(afterLocal.weekday);
  const firstMinute = Math.floor(DateTime.toEpochMillis(after) / MINUTE_MS) * MINUTE_MS + MINUTE_MS;

  for (let offset = 0; offset < MAX_CALENDAR_SEARCH_MINUTES; offset += 1) {
    const candidate = DateTime.makeUnsafe(firstMinute + offset * MINUTE_MS);
    const local = localMinute(formatter, candidate);
    if (local.localTime !== schedule.localTime || !schedule.weekdays.includes(local.weekday)) {
      continue;
    }
    // A fall-back DST transition can expose the same wall-clock slot twice.
    // Once that slot has run, advance to the next distinct local calendar slot.
    if (afterIsScheduledSlot && local.slot === afterLocal.slot) {
      continue;
    }
    return DateTime.formatIso(candidate);
  }

  throw new RangeError(
    `No calendar occurrence found within ${MAX_CALENDAR_SEARCH_MINUTES} minutes for ${schedule.timeZone}`,
  );
}

/**
 * Calculate the first scheduled instant strictly after `after`.
 *
 * Persisted `nextRunAt` remains the scheduler source of truth; this helper is
 * deterministic schedule arithmetic and never starts timers or performs I/O.
 */
export function nextAutomationRunAt(
  schedule: AutomationSchedule,
  after: DateTime.Utc,
): string | null {
  const afterMs = DateTime.toEpochMillis(after);
  if (!Number.isFinite(afterMs)) {
    throw new RangeError("The schedule cursor must be a valid Date");
  }

  switch (schedule.type) {
    case "manual":
      return null;
    case "once": {
      const runAt = DateTime.makeUnsafe(schedule.runAt);
      return DateTime.toEpochMillis(runAt) > afterMs ? DateTime.formatIso(runAt) : null;
    }
    case "interval": {
      const anchorMs = DateTime.toEpochMillis(DateTime.makeUnsafe(schedule.anchorAt));
      const intervalMs = schedule.everyMinutes * MINUTE_MS;
      const steps = afterMs < anchorMs ? 0 : Math.floor((afterMs - anchorMs) / intervalMs) + 1;
      return DateTime.formatIso(DateTime.makeUnsafe(anchorMs + steps * intervalMs));
    }
    case "calendar":
      return nextCalendarRun(schedule, after);
  }
}
