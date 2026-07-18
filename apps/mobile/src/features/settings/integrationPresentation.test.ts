import { describe, expect, it } from "vite-plus/test";

import {
  integrationAvailability,
  integrationAvailabilityLabel,
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
  });

  it("uses a safe generic error detail instead of raw remote error data", () => {
    expect(integrationAvailabilityLabel("error")).toBe("Error");
    expect(integrationStatusDetail("error")).not.toContain("token");
    expect(integrationStatusDetail("unsupported")).toContain("older");
  });

  it("keeps an explicit environment selected across refreshes and falls back after disconnect", () => {
    expect(selectedIntegrationEnvironmentId(["local", "cloud"], "cloud")).toBe("cloud");
    expect(selectedIntegrationEnvironmentId(["local"], "cloud")).toBe("local");
    expect(selectedIntegrationEnvironmentId([], "cloud")).toBeNull();
  });
});
