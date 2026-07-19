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

export const INTEGRATION_RUN_RETENTION_DAYS = 90;

export function integrationRunRetentionCutoff(now: string): string {
  return DateTime.formatIso(
    DateTime.subtract(DateTime.makeUnsafe(now), { days: INTEGRATION_RUN_RETENTION_DAYS }),
  );
}
import type { IntegrationRun } from "@notcodex/contracts";
import * as DateTime from "effect/DateTime";

export const INTERRUPTED_INTEGRATION_RUN_FAILURE = "Run interrupted before completion.";

export function buildInterruptedIntegrationRun(
  run: IntegrationRun,
  completedAt: string,
): IntegrationRun {
  return {
    ...run,
    state: "cancelled",
    failure: INTERRUPTED_INTEGRATION_RUN_FAILURE,
    completedAt,
    updatedAt: completedAt,
  };
}
