import { describe, expect, it } from "vite-plus/test";

import {
  integrationAccessibilityLabel,
  integrationAvailability,
  integrationAvailabilityLabel,
  isIntegrationQueryUnavailable,
  interruptedIntegrationCommandDetail,
  safeIntegrationRequestErrorDetail,
  integrationStatusDetail,
  selectedIntegrationEnvironmentId,
} from "./integrationPresentation";

describe("integration presentation", () => {
  it("keeps offline, authorization, and unsupported states distinct from integration state", () => {
    expect(
      integrationAvailability({ descriptor: null, connectionState: "offline", queryError: null }),
    ).toBe("offline");
    expect(
      integrationAvailability({
        descriptor: null,
        connectionState: "connected",
        queryError: "403 forbidden: /private/token",
      }),
    ).toBe("unauthorized");
    expect(
      integrationAvailability({
        descriptor: null,
        connectionState: "connected",
        queryError: "method not found: integrations.list",
      }),
    ).toBe("unsupported");
    expect(
      integrationAvailability({
        descriptor: null,
        connectionState: "reconnecting",
        queryError: null,
      }),
    ).toBe("connecting");
  });

  it("uses a safe generic error detail instead of raw remote error data", () => {
    expect(
      integrationAvailability({
        descriptor: null,
        connectionState: "connected",
        queryError: "remote request failed",
      }),
    ).toBe("error");
    expect(integrationAvailabilityLabel("error")).toBe("Error");
    expect(integrationStatusDetail("error")).not.toContain("token");
    expect(integrationStatusDetail("unsupported")).toContain("older");
  });

  it("surfaces connection states that cannot produce integration query data", () => {
    expect(isIntegrationQueryUnavailable("offline")).toBe(true);
    expect(isIntegrationQueryUnavailable("disconnected")).toBe(true);
    expect(isIntegrationQueryUnavailable("error")).toBe(true);
    expect(isIntegrationQueryUnavailable("connecting")).toBe(false);
    expect(isIntegrationQueryUnavailable("ready")).toBe(false);
  });

  it("classifies remote request failures without returning raw server data", () => {
    const secret = "token=raw-secret /private/project";
    const details = [
      safeIntegrationRequestErrorDetail(`403 forbidden ${secret}`, "Request failed."),
      safeIntegrationRequestErrorDetail(`socket disconnected ${secret}`, "Request failed."),
      safeIntegrationRequestErrorDetail(secret, "Request failed."),
    ];
    expect(details[0]).toContain("not authorized");
    expect(details[1]).toContain("Reconnect");
    expect(details[2]).toBe("Request failed.");
    expect(interruptedIntegrationCommandDetail("Run retry")).toContain("interrupted");
    expect(details.join(" ")).not.toContain(secret);
  });

  it("keeps an explicit environment selected across refreshes and falls back after disconnect", () => {
    expect(selectedIntegrationEnvironmentId(["local", "cloud"], "cloud")).toBe("cloud");
    expect(selectedIntegrationEnvironmentId(["local"], "cloud")).toBe("local");
    expect(selectedIntegrationEnvironmentId([], "cloud")).toBeNull();
  });

  it("builds a bounded screen-reader summary without exposing raw server errors", () => {
    const label = integrationAccessibilityLabel(
      {
        id: "loopany",
        name: "LoopAny",
        description: "External delivery",
        version: "2026-07",
        state: "error",
        capabilities: ["schedule", "deliver"],
        tokenConfigured: true,
        lastActivityAt: null,
        error: "token=raw-secret /private/path",
        diagnostics: null,
      },
      "error",
    );

    expect(label).toContain("LoopAny. Error");
    expect(label).toContain("Token configured yes");
    expect(label).not.toContain("raw-secret");
    expect(label).not.toContain("/private/path");
  });
});
