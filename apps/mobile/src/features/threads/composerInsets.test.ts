import { describe, expect, it } from "vite-plus/test";

import { resolveComposerBottomInset } from "./composerInsets";

describe("resolveComposerBottomInset", () => {
  it("removes the safe-area inset while the software keyboard is visible", () => {
    expect(resolveComposerBottomInset({ isKeyboardVisible: true, safeAreaBottom: 34 })).toBe(0);
  });

  it("restores the gesture-bar inset after the keyboard closes", () => {
    expect(resolveComposerBottomInset({ isKeyboardVisible: false, safeAreaBottom: 34 })).toBe(34);
  });

  it("keeps a minimum inset when the device reports no bottom safe area", () => {
    expect(resolveComposerBottomInset({ isKeyboardVisible: false, safeAreaBottom: 0 })).toBe(12);
  });
});
