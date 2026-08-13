import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { getPreviewPanelMaxWidth, PreviewPanelShell } from "./PreviewPanelShell";

describe("getPreviewPanelMaxWidth", () => {
  it("uses 70% of the actual chat container without a pixel ceiling", () => {
    expect(getPreviewPanelMaxWidth(4_000)).toBe(2_800);
  });

  it("rounds fractional CSS pixels down", () => {
    expect(getPreviewPanelMaxWidth(2_001)).toBe(1_400);
  });

  it("keeps inline panels inside their containing workspace", () => {
    const markup = renderToStaticMarkup(
      jsx(PreviewPanelShell, { mode: "inline", defaultWidth: 1_000, children: "Panel" }),
    );

    expect(markup).toContain("max-w-full");
  });
});
