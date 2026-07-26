import { assert, describe, it } from "@effect/vitest";

import { resolveCursorMaintenanceCapabilities } from "./CursorDriver.ts";

describe("resolveCursorMaintenanceCapabilities", () => {
  it("defaults updates to the cursor-agent executable", () => {
    const capabilities = resolveCursorMaintenanceCapabilities();

    assert.equal(capabilities.update?.executable, "cursor-agent");
    assert.equal(capabilities.update?.command, "cursor-agent update");
  });

  it("retains the executable resolved through an instance-specific PATH", () => {
    const capabilities = resolveCursorMaintenanceCapabilities({
      binaryPath: "cursor-agent-custom",
      resolvedCommandPath: "/Users/Jane Doe/bin/cursor-agent-custom",
    });

    assert.equal(capabilities.update?.executable, "/Users/Jane Doe/bin/cursor-agent-custom");
    assert.equal(capabilities.update?.command, '"/Users/Jane Doe/bin/cursor-agent-custom" update');
  });
});
