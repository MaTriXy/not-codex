import { describe, expect, it } from "vite-plus/test";

import { loopAnyHealthVariant } from "./LoopAnyDiagnosticsPanel";

describe("LoopAny diagnostics presentation", () => {
  it("distinguishes healthy, transitional, disabled, and actionable error states", () => {
    expect(loopAnyHealthVariant("healthy")).toBe("success");
    expect(loopAnyHealthVariant("connecting")).toBe("warning");
    expect(loopAnyHealthVariant("backing-off")).toBe("warning");
    expect(loopAnyHealthVariant("disabled")).toBe("secondary");
    expect(loopAnyHealthVariant("misconfigured")).toBe("error");
    expect(loopAnyHealthVariant("unauthorized")).toBe("error");
    expect(loopAnyHealthVariant("protocol-error")).toBe("error");
  });
});
