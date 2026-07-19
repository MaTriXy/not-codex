import type {
  IntegrationRun,
  IntegrationRunState,
  IntegrationRunTimelineEvent,
  IntegrationRunVerificationSummary,
  MonkeyLoopyValidateResult,
} from "@notcodex/contracts";
import * as DateTime from "effect/DateTime";

const SENSITIVE_ASSIGNMENT_NAME = /(?:api[_-]?key|token|secret|password)/i;

function isSensitiveAssignmentName(name: string): boolean {
  return SENSITIVE_ASSIGNMENT_NAME.test(name);
}

export function sanitizeIntegrationRunText(value: string, limit: number): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /"([A-Za-z_][A-Za-z0-9_-]*)"(\s*:\s*)"((?:\\.|[^"\\])*)"/g,
      (assignment, name: string, separator: string) =>
        isSensitiveAssignmentName(name) ? `"${name}"${separator}"[REDACTED]"` : assignment,
    )
    .replace(
      /'([A-Za-z_][A-Za-z0-9_-]*)'(\s*:\s*)'((?:\\.|[^'\\])*)'/g,
      (assignment, name: string, separator: string) =>
        isSensitiveAssignmentName(name) ? `'${name}'${separator}'[REDACTED]'` : assignment,
    )
    .replace(
      /\b([A-Za-z_][A-Za-z0-9_-]*)(\s*[:=])\s*([^\s,;]+)/g,
      (assignment, name: string, separator: string) =>
        isSensitiveAssignmentName(name) ? `${name}${separator}[REDACTED]` : assignment,
    )
    .slice(0, limit);
}

const STATE_SUMMARIES = {
  queued: "Run queued",
  running: "Run started",
  waiting: "Run is waiting",
  succeeded: "Run completed successfully",
  failed: "Run failed",
  cancelled: "Run cancelled",
} as const satisfies Record<IntegrationRunState, string>;

function timelineEvent(
  sequence: number,
  state: IntegrationRunState,
  occurredAt: string,
  summary: string = STATE_SUMMARIES[state],
): IntegrationRunTimelineEvent {
  return {
    sequence,
    state,
    occurredAt,
    summary: sanitizeIntegrationRunText(summary, 500),
  };
}

export function backfillIntegrationRunTimeline(
  run: IntegrationRun,
): ReadonlyArray<IntegrationRunTimelineEvent> {
  if (run.timeline.length > 0) return run.timeline;
  const events: Array<IntegrationRunTimelineEvent> = [timelineEvent(0, "queued", run.createdAt)];
  if (run.startedAt !== null) {
    events.push(timelineEvent(events.length, "running", run.startedAt));
  }
  if (run.state === "waiting") {
    events.push(timelineEvent(events.length, "waiting", run.updatedAt));
  } else if (["succeeded", "failed", "cancelled"].includes(run.state)) {
    events.push(timelineEvent(events.length, run.state, run.completedAt ?? run.updatedAt));
  }
  return events;
}

export function appendIntegrationRunTimeline(
  run: IntegrationRun,
  state: IntegrationRunState,
  occurredAt: string,
  summary?: string,
): Array<IntegrationRunTimelineEvent> {
  const timeline = [...backfillIntegrationRunTimeline(run)];
  if (timeline.at(-1)?.state === state && summary === undefined) return timeline;
  timeline.push(timelineEvent((timeline.at(-1)?.sequence ?? -1) + 1, state, occurredAt, summary));
  return timeline.slice(-100);
}

export function monkeyLoopyVerificationSummary(
  validation: MonkeyLoopyValidateResult,
): IntegrationRunVerificationSummary {
  const count = (level: "error" | "warning" | "info") =>
    validation.diagnostics.filter((diagnostic) => diagnostic.level === level).length;
  return {
    valid: validation.valid,
    verified: validation.verified,
    executionReady: validation.executionReady,
    score: validation.score,
    name: validation.name === null ? null : sanitizeIntegrationRunText(validation.name, 500),
    factoryVersion: validation.factoryVersion,
    executionVersion: validation.executionVersion,
    errorCount: count("error"),
    warningCount: count("warning"),
    infoCount: count("info"),
  };
}

export const INTEGRATION_RUN_RETENTION_DAYS = 90;

export function integrationRunRetentionCutoff(now: string): string {
  return DateTime.formatIso(
    DateTime.subtract(DateTime.makeUnsafe(now), { days: INTEGRATION_RUN_RETENTION_DAYS }),
  );
}
export const INTERRUPTED_INTEGRATION_RUN_FAILURE = "Run interrupted before completion.";

export function buildInterruptedIntegrationRun(
  run: IntegrationRun,
  completedAt: string,
): IntegrationRun {
  return {
    ...run,
    state: "cancelled",
    failure: INTERRUPTED_INTEGRATION_RUN_FAILURE,
    timeline: appendIntegrationRunTimeline(run, "cancelled", completedAt),
    completedAt,
    updatedAt: completedAt,
  };
}
