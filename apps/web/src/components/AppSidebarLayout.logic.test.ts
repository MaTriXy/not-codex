// @effect-diagnostics nodeBuiltinImport:off - Regression coverage compares shipped CSS with the sidebar width contract.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { isSettingsRoutePathname, THREAD_SIDEBAR_MIN_WIDTH } from "./AppSidebarLayout.logic";

describe("isSettingsRoutePathname", () => {
  it.each(["/settings", "/settings/providers", "/settings/keybindings/advanced"])(
    "recognizes settings route %s",
    (pathname) => {
      expect(isSettingsRoutePathname(pathname)).toBe(true);
    },
  );

  it.each(["/", "/thread/settings", "/settings-old", "/settings2"])(
    "does not mistake %s for a settings route",
    (pathname) => {
      expect(isSettingsRoutePathname(pathname)).toBe(false);
    },
  );
});

describe("sidebar brand width", () => {
  it("shows the desktop wordmark across the sidebar's full legal width range", () => {
    const sidebarStyles = NodeFS.readFileSync(new URL("../index.css", import.meta.url), "utf8");
    const desktopHeaderStyles = sidebarStyles.slice(
      sidebarStyles.indexOf("@media (min-width: 48rem)"),
      sidebarStyles.indexOf("/* Stage-channel sidebar art"),
    );
    const stageLabelThreshold = desktopHeaderStyles.match(
      /@container sidebar-header \(min-width: ([\d.]+)rem\) \{\s*\.sidebar-brand-stage \{\s*display: inline-flex;/,
    )?.[1];

    expect(sidebarStyles).toMatch(/\.sidebar-brand \{\s*display: none;/);
    expect(desktopHeaderStyles).toMatch(
      /@media \(min-width: 48rem\) \{\s*\.sidebar-brand \{\s*display: flex;/,
    );
    expect(THREAD_SIDEBAR_MIN_WIDTH).toBe(13 * 16);
    expect(Number(stageLabelThreshold) * 16).toBeGreaterThan(THREAD_SIDEBAR_MIN_WIDTH);
  });
});
