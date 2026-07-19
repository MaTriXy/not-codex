export function sanitizeIntegrationRunText(value: string, limit: number): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b((?:api[_-]?key|token|secret|password)\s*[:=])\s*[^\s,;]+/gi, "$1[REDACTED]")
    .slice(0, limit);
}

export const INTEGRATION_RUN_RETENTION_DAYS = 90;

export function integrationRunRetentionCutoff(now: string): string {
  return DateTime.formatIso(
    DateTime.subtract(DateTime.makeUnsafe(now), { days: INTEGRATION_RUN_RETENTION_DAYS }),
  );
}
import * as DateTime from "effect/DateTime";
