import type { IntegrationDescriptor } from "@notcodex/contracts";
import * as DateTime from "effect/DateTime";

export type IntegrationAvailability =
  | "disabled"
  | "disconnected"
  | "connecting"
  | "ready"
  | "error"
  | "offline"
  | "unauthorized"
  | "unsupported";

/** Preserve an explicit environment choice while it remains paired. */
export function selectedIntegrationEnvironmentId<A extends string>(
  environmentIds: ReadonlyArray<A>,
  selectedEnvironmentId: A | null,
): A | null {
  return selectedEnvironmentId !== null && environmentIds.includes(selectedEnvironmentId)
    ? selectedEnvironmentId
    : (environmentIds[0] ?? null);
}

export function integrationAvailability(input: {
  readonly descriptor: IntegrationDescriptor | null;
  readonly connectionState: string;
  readonly queryError: string | null;
}): IntegrationAvailability {
  if (input.connectionState === "offline") return "offline";
  if (input.queryError && /unauthori[sz]ed|forbidden|permission/i.test(input.queryError)) {
    return "unauthorized";
  }
  if (
    input.queryError &&
    /method.*not found|unsupported|not implemented|unknown method/i.test(input.queryError)
  ) {
    return "unsupported";
  }
  if (input.descriptor) return input.descriptor.state;
  return input.connectionState === "connecting" || input.connectionState === "reconnecting"
    ? "connecting"
    : "disconnected";
}

export function integrationAvailabilityLabel(availability: IntegrationAvailability): string {
  return {
    disabled: "Disabled",
    disconnected: "Disconnected",
    connecting: "Connecting",
    ready: "Ready",
    error: "Error",
    offline: "Offline",
    unauthorized: "Unauthorized",
    unsupported: "Unsupported",
  }[availability];
}

/** Never surface server-provided error strings: they can include paths, tokens, or payload details. */
export function integrationStatusDetail(availability: IntegrationAvailability): string | null {
  switch (availability) {
    case "error":
      return "This integration reported a problem on the selected environment.";
    case "offline":
      return "This device is offline. Reconnect to refresh integration status.";
    case "unauthorized":
      return "This device is not authorized to inspect integrations on this environment.";
    case "unsupported":
      return "This environment is running an older or incompatible version.";
    case "disconnected":
      return "Reconnect this environment to inspect integrations.";
    default:
      return null;
  }
}

export function integrationLastActivityLabel(value: DateTime.Utc | null): string {
  return value ? new Date(DateTime.toEpochMillis(value)).toLocaleString() : "No activity reported";
}

export function integrationAccessibilityLabel(
  descriptor: IntegrationDescriptor,
  availability: IntegrationAvailability,
): string {
  const detail = integrationStatusDetail(availability);
  return [
    descriptor.name,
    integrationAvailabilityLabel(availability),
    `Version ${descriptor.version}`,
    `Capabilities ${descriptor.capabilities.length ? descriptor.capabilities.join(", ") : "none reported"}`,
    `Token configured ${descriptor.tokenConfigured ? "yes" : "no"}`,
    `Last activity ${integrationLastActivityLabel(descriptor.lastActivityAt)}`,
    detail,
  ]
    .filter((part): part is string => part !== null)
    .join(". ");
}
