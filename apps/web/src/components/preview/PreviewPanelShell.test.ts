import { describe, expect, it } from "vite-plus/test";

import { getPreviewPanelMaxWidth } from "./PreviewPanelShell";

describe("getPreviewPanelMaxWidth", () => {
  it("uses 70% of the actual chat container without a pixel ceiling", () => {
    expect(getPreviewPanelMaxWidth(4_000)).toBe(2_800);
  });

  it("rounds fractional CSS pixels down", () => {
    expect(getPreviewPanelMaxWidth(2_001)).toBe(1_400);
  });
});
