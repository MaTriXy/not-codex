import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  ClipboardApiUnavailableError,
  ClipboardWriteError,
  writeTextToClipboard,
} from "./useCopyToClipboard";

describe("writeTextToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports unavailable clipboard support with structural context", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {});

    const error = await writeTextToClipboard("plan contents", "plan").then(
      () => undefined,
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(ClipboardApiUnavailableError);
    expect(error).toMatchObject({
      target: "plan",
    });
    expect((error as Error).message).not.toContain("plan contents");
  });

  it("preserves the exact clipboard failure without exposing copied contents", async () => {
    const cause = new Error("browser clipboard failure");
    const writeText = vi.fn().mockRejectedValue(cause);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const error = await writeTextToClipboard("secret clipboard contents", "error-message").then(
      () => undefined,
      (failure: unknown) => failure,
    );

    expect(writeText).toHaveBeenCalledWith("secret clipboard contents");
    expect(error).toBeInstanceOf(ClipboardWriteError);
    expect(error).toMatchObject({
      target: "error-message",
      cause,
    });
    expect((error as Error).message).not.toContain("secret clipboard contents");
  });

  it("prefers the privileged desktop clipboard bridge", async () => {
    const desktopWriteText = vi.fn().mockResolvedValue(undefined);
    const browserWriteText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { desktopBridge: { copyText: desktopWriteText } });
    vi.stubGlobal("navigator", { clipboard: { writeText: browserWriteText } });

    await expect(writeTextToClipboard("terminal output", "terminal selection")).resolves.toBe(true);

    expect(desktopWriteText).toHaveBeenCalledWith("terminal output");
    expect(browserWriteText).not.toHaveBeenCalled();
  });

  it("preserves the Clipboard method receiver in browser builds", async () => {
    const clipboard = {
      writeText: vi.fn<(value: string) => Promise<void>>(),
    };
    clipboard.writeText.mockImplementation(function (this: unknown) {
      expect(this).toBe(clipboard);
      return Promise.resolve();
    });
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard });

    await expect(writeTextToClipboard("terminal output", "terminal selection")).resolves.toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith("terminal output");
  });

  it("keeps empty values as a no-op when clipboard support is available", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(writeTextToClipboard("", "plan")).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});
