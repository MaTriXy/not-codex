import { describe, expect, it } from "vite-plus/test";

import { describePreviewError } from "./errorCodeMessages";

describe("describePreviewError", () => {
  it("maps known Chromium descriptions to friendly copy", () => {
    expect(describePreviewError("ERR_CONNECTION_REFUSED")).toBe("Connection refused");
  });

  it("preserves an unknown non-empty description", () => {
    expect(describePreviewError("ERR_CUSTOM_FAILURE")).toBe("ERR_CUSTOM_FAILURE");
  });

  it("uses a generic fallback when no description is available", () => {
    expect(describePreviewError("")).toBe("Network error");
  });
});
