import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  codeViewClassName: null as string | null,
  codeViewOptions: null as Record<string, unknown> | null,
}));

vi.mock("@pierre/diffs/react", () => ({
  CodeView: (props: { className: string; options: Record<string, unknown> }) => {
    testState.codeViewClassName = props.className;
    testState.codeViewOptions = props.options;
    return null;
  },
}));

import { StyledDiffCodeView } from "./StyledDiffCodeView";

describe("StyledDiffCodeView", () => {
  beforeEach(() => {
    testState.codeViewClassName = null;
    testState.codeViewOptions = null;
  });

  it("always pairs the shared diff styling with its virtualized geometry", () => {
    renderToStaticMarkup(
      <StyledDiffCodeView
        className="min-h-0"
        items={[]}
        options={{ theme: "pierre-dark", stickyHeaders: true }}
      />,
    );

    expect(testState.codeViewClassName).toBe("diff-render-surface outline-none min-h-0");
    expect(testState.codeViewOptions).toMatchObject({
      theme: "pierre-dark",
      stickyHeaders: true,
      itemMetrics: {
        diffHeaderHeight: 32,
        hunkSeparatorHeight: 24,
        paddingTop: 0,
        paddingBottom: 0,
      },
      layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
    });
    expect(testState.codeViewOptions?.unsafeCSS).toEqual(
      expect.stringContaining("[data-diffs-header]"),
    );
  });
});
