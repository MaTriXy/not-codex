import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  getElectronPlatformClassNames,
  syncDocumentElectronWindowFullscreenClass,
  syncDocumentElectronWindowMaximizedClass,
} from "./windowControlsOverlay";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe("syncDocumentElectronWindowFullscreenClass", () => {
  it("tracks fullscreen transitions and cleans up", () => {
    const classes = new Set<string>();
    const classList = {
      toggle: vi.fn((name: string, enabled: boolean) => {
        if (enabled) classes.add(name);
        else classes.delete(name);
      }),
      remove: vi.fn((name: string) => classes.delete(name)),
    };
    vi.stubGlobal("document", { documentElement: { classList } });

    let listener: ((fullscreen: boolean) => void) | undefined;
    const unsubscribe = vi.fn();
    const cleanup = syncDocumentElectronWindowFullscreenClass({
      getWindowFullscreenState: () => false,
      onWindowFullscreenStateChange: (nextListener) => {
        listener = nextListener;
        return unsubscribe;
      },
    });

    expect(classes.has("electron-window-fullscreen")).toBe(false);
    listener?.(true);
    expect(classes.has("electron-window-fullscreen")).toBe(true);
    listener?.(false);
    expect(classes.has("electron-window-fullscreen")).toBe(false);

    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(classes.has("electron-window-fullscreen")).toBe(false);
  });
});

describe("syncDocumentElectronWindowMaximizedClass", () => {
  it("tracks maximize transitions and cleans up", () => {
    const classes = new Set<string>();
    const classList = {
      toggle: vi.fn((name: string, enabled: boolean) => {
        if (enabled) classes.add(name);
        else classes.delete(name);
      }),
      remove: vi.fn((name: string) => classes.delete(name)),
    };
    vi.stubGlobal("document", { documentElement: { classList } });

    let listener: ((maximized: boolean) => void) | undefined;
    const unsubscribe = vi.fn();
    const cleanup = syncDocumentElectronWindowMaximizedClass({
      getWindowMaximizedState: () => true,
      onWindowMaximizedStateChange: (nextListener) => {
        listener = nextListener;
        return unsubscribe;
      },
    });

    expect(classes.has("electron-window-maximized")).toBe(true);
    listener?.(false);
    expect(classes.has("electron-window-maximized")).toBe(false);
    listener?.(true);
    expect(classes.has("electron-window-maximized")).toBe(true);

    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(classes.has("electron-window-maximized")).toBe(false);
  });
});
