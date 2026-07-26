import { describe, expect, it } from "vite-plus/test";

import { isSettingsRoutePathname } from "./AppSidebarLayout.logic";

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
