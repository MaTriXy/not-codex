// @vitest-environment happy-dom

/**
 * The DOM-level guarantee for untrusted Open Kritt finding text: no matter what
 * markup an upstream finding carries, it reaches the document as text nodes and
 * never as elements. This must run in a real DOM, which is why it lives in a
 * `.dom.test.tsx` file rather than beside the pure helper tests.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vite-plus/test";

import { SecurityFindingMarkdown } from "./SecurityFindingMarkdown.tsx";

describe("SecurityFindingMarkdown DOM output", () => {
  it("never produces raw HTML: hostile markup survives only as DOM text", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <SecurityFindingMarkdown value={"<b>bold</b> and <script>alert(1)</script>\n\n- `x`"} />,
      );
    });

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>bold</b>");
    expect(container.querySelector("li code")?.textContent).toBe("x");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
