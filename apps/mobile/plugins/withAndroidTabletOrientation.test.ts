import * as NodeModule from "node:module";
import { describe, expect, it } from "vite-plus/test";

interface MainActivityModResult {
  readonly modResults: {
    readonly contents: string;
    readonly language: string;
  };
}

type MainActivityMod = (config: {
  readonly name: string;
  readonly slug: string;
  readonly modResults: MainActivityModResult["modResults"];
  readonly modRequest: {
    readonly projectRoot: string;
    readonly platform: "android";
    readonly modName: "mainActivity";
    readonly introspect: false;
  };
}) => Promise<MainActivityModResult>;

type TabletOrientationPlugin = (config: { readonly name: string; readonly slug: string }) => {
  readonly mods: { readonly android: { readonly mainActivity: MainActivityMod } };
};

const require = NodeModule.createRequire(import.meta.url);
const withAndroidTabletOrientation =
  require("./withAndroidTabletOrientation.cjs") as TabletOrientationPlugin;

const MAIN_ACTIVITY = `package com.notcodex

import android.os.Bundle

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }
}`;

async function applyPlugin(contents: string, language = "kt"): Promise<string> {
  const config = withAndroidTabletOrientation({ name: "Not Codex", slug: "notcodex" });
  const result = await config.mods.android.mainActivity({
    name: "Not Codex",
    slug: "notcodex",
    modResults: { contents, language },
    modRequest: {
      projectRoot: process.cwd(),
      platform: "android",
      modName: "mainActivity",
      introspect: false,
    },
  });
  return result.modResults.contents;
}

describe("withAndroidTabletOrientation", () => {
  it("adds runtime phone, tablet, and foldable orientation handling", async () => {
    const result = await applyPlugin(MAIN_ACTIVITY);

    expect(result).toContain("import android.content.pm.ActivityInfo");
    expect(result).toContain("import android.content.res.Configuration");
    expect(result).toContain("override fun onConfigurationChanged(newConfig: Configuration)");
    expect(result).toContain("resources.configuration.smallestScreenWidthDp >= 600");
    expect(result).toContain("ActivityInfo.SCREEN_ORIENTATION_FULL_USER");
    expect(result).toContain("ActivityInfo.SCREEN_ORIENTATION_PORTRAIT");
    expect(result).toContain("super.onCreate(null)\n    applyTabletOrientation()");
  });

  it("is idempotent", async () => {
    const once = await applyPlugin(MAIN_ACTIVITY);
    const twice = await applyPlugin(once);

    expect(twice).toBe(once);
  });

  it("fails loudly when the generated activity is not Kotlin", async () => {
    await expect(applyPlugin(MAIN_ACTIVITY, "java")).rejects.toThrow("MainActivity must be Kotlin");
  });
});
