import { describe, expect, it } from "vite-plus/test";

import { getElectronPlatformClassNames } from "./windowControlsOverlay";

describe("getElectronPlatformClassNames", () => {
  it("adds the Windows-specific class for Electron on Windows", () => {
    expect(getElectronPlatformClassNames("Win32")).toEqual(["electron", "electron-windows"]);
    expect(getElectronPlatformClassNames("Windows")).toEqual(["electron", "electron-windows"]);
  });

  it("uses only the shared Electron class on other platforms", () => {
    expect(getElectronPlatformClassNames("MacIntel")).toEqual(["electron"]);
    expect(getElectronPlatformClassNames("Linux x86_64")).toEqual(["electron"]);
  });
});
