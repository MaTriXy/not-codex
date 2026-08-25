import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerBannerStack, type ComposerBannerStackItem } from "./ComposerBannerStack";

const banner = (
  id: string,
  variant: ComposerBannerStackItem["variant"] = "warning",
): ComposerBannerStackItem => ({
  id,
  variant,
  icon: <span aria-hidden="true">!</span>,
  title: `${id} warning`,
});

describe("ComposerBannerStack", () => {
  it("keeps the front banner visible and the rest expandable", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack items={[banner("front"), banner("stacked")]} />,
    );

    expect(markup.indexOf("front warning")).toBeLessThan(markup.indexOf("stacked warning"));
    expect(markup).toContain("group-hover/banner-stack:pointer-events-auto");
    expect(markup).toContain("group-focus-within/banner-stack:opacity-100");
  });

  it("colors the collapsed stack cap by the hidden banner's variant", () => {
    const infoBehind = renderToStaticMarkup(
      <ComposerBannerStack items={[banner("front", "info"), banner("stacked", "info")]} />,
    );
    expect(infoBehind).toContain("border-info/24");
    expect(infoBehind).not.toContain("border-warning/24");

    const warningBehind = renderToStaticMarkup(
      <ComposerBannerStack items={[banner("front", "info"), banner("stacked", "warning")]} />,
    );
    expect(warningBehind).toContain("border-warning/24");
  });

  it("does not render a collapsed stack cap for a single banner", () => {
    const markup = renderToStaticMarkup(<ComposerBannerStack items={[banner("front")]} />);

    expect(markup).not.toContain("border-warning/24");
    expect(markup).toContain("front warning");
    expect(markup).not.toContain("group-hover/banner-stack:pointer-events-auto");
  });

  it("renders a disabled compaction action on the shared accessible banner surface", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack
        items={[
          {
            id: "resume-compaction",
            variant: "info",
            icon: <span aria-hidden="true">!</span>,
            title: "Resume with less context",
            description: "250k tokens from an older session",
            actions: (
              <button type="button" disabled>
                Compact
              </button>
            ),
            dismissLabel: "Keep full history",
            onDismiss: () => {},
          },
        ]}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-label="Keep full history"');
  });
});
