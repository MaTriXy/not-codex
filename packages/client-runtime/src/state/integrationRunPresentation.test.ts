import { describe, expect, it } from "vite-plus/test";

import { integrationRunSourceLabel } from "./integrationRunPresentation.ts";

describe("integration run presentation", () => {
  it("keeps source labels aligned across clients", () => {
    expect(integrationRunSourceLabel("loopany")).toBe("LoopAny");
    expect(integrationRunSourceLabel("monkey-d-loopy")).toBe("Monkey.D.Loopy");
    expect(integrationRunSourceLabel("open-kritt")).toBe("Open Kritt");
    expect(integrationRunSourceLabel("open-kritt", "pending")).toBe(
      "Open Kritt — queued/preparing",
    );
  });
});
