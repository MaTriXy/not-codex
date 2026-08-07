import type {
  OpenKrittDiagnosticEvent,
  OpenKrittDiagnostics,
  OpenKrittHealthState,
} from "@notcodex/contracts";
import * as NodeCrypto from "node:crypto";
import { stripOpenKrittControlCharacters } from "./openKrittText.ts";

const MAX_EVENTS = 50;
const MAX_TEXT = 500;

function safeText(value: unknown): string {
  const text = typeof value === "string" ? value : "Open Kritt connector event.";
  return stripOpenKrittControlCharacters(
    text
      .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
      .replace(/\b[^\s,;]*(?:bearer|token)[^\s,;]*\b/gi, "[redacted]")
      .replace(/(?:\/Users\/|\/home\/|[A-Za-z]:\\)[^\s"']*/g, "[path redacted]"),
  ).slice(0, MAX_TEXT);
}

function isoNow(): string {
  // @effect-diagnostics-next-line globalDate:off
  return new Date().toISOString();
}

function normalizeEvent(input: {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly summary?: unknown;
  readonly severity?: unknown;
  readonly occurredAt?: unknown;
  readonly id?: unknown;
}): OpenKrittDiagnosticEvent {
  const severity =
    input.severity === "error" || input.severity === "warning" ? input.severity : "info";
  return {
    id: safeText(input.id ?? NodeCrypto.randomUUID()),
    severity,
    code: safeText(input.code ?? "connector-event"),
    summary: safeText(input.summary ?? input.message),
    occurredAt: typeof input.occurredAt === "string" ? input.occurredAt : isoNow(),
  };
}

export function redactOpenKrittDiagnostic(
  input: Record<string, unknown>,
): OpenKrittDiagnosticEvent {
  return normalizeEvent(input);
}

export function sanitizeOpenKrittDiagnostics(input: {
  readonly health: OpenKrittHealthState;
  readonly lastSuccessfulContact?: string | null;
  readonly nextRetryAt?: string | null;
  readonly compatibilityVersion: string;
  readonly serverVersion: string | null;
  readonly recentEvents: ReadonlyArray<Record<string, unknown> | OpenKrittDiagnosticEvent>;
}): OpenKrittDiagnostics {
  if (input.recentEvents.length > MAX_EVENTS) {
    throw new Error("Open Kritt diagnostic event limit exceeded.");
  }
  return {
    health: input.health,
    lastSuccessfulContact: input.lastSuccessfulContact ?? null,
    nextRetryAt: input.nextRetryAt ?? null,
    compatibilityVersion: safeText(input.compatibilityVersion),
    serverVersion: input.serverVersion === null ? null : safeText(input.serverVersion),
    lastError: null,
    recentEvents: input.recentEvents.map((event) => normalizeEvent(event)),
  };
}

export function appendOpenKrittDiagnosticEvent(
  current: OpenKrittDiagnostics,
  input: {
    readonly code: string;
    readonly summary: string;
    readonly severity: "info" | "warning" | "error";
  },
): OpenKrittDiagnostics {
  const event = redactOpenKrittDiagnostic(input);
  const recentEvents = [...current.recentEvents, event].slice(-MAX_EVENTS);
  return { ...current, recentEvents };
}
