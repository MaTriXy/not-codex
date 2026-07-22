// @effect-diagnostics nodeBuiltinImport:off - This test verifies repository files before an Effect runtime exists.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";

const repoRoot = NodeURL.fileURLToPath(new URL("../", import.meta.url));

function absolute(relativePath: string): string {
  return NodePath.join(repoRoot, relativePath);
}

function expectSameAsset(sourcePath: string, candidatePaths: ReadonlyArray<string>): void {
  const source = NodeFS.readFileSync(absolute(sourcePath));
  for (const candidatePath of candidatePaths) {
    expect(NodeFS.readFileSync(absolute(candidatePath)).equals(source), candidatePath).toBe(true);
  }
}

function collectFiles(directory: string, extensions: ReadonlySet<string>): string[] {
  return NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(entryPath, extensions);
    return extensions.has(NodePath.extname(entry.name)) ? [entryPath] : [];
  });
}

function missingPublicAssetReferences(sourceDirectory: string, publicDirectory: string): string[] {
  const assetPattern = /(?:src|href)=["']\/(?!\/)([^"'#?]+\.(?:ico|jpe?g|png|svg|webp))["']/giu;
  const sourceFiles = collectFiles(sourceDirectory, new Set([".astro", ".html", ".ts", ".tsx"]));

  return sourceFiles.flatMap((sourceFile) => {
    const source = NodeFS.readFileSync(sourceFile, "utf8");
    return [...source.matchAll(assetPattern)]
      .map((match) => match[1])
      .filter((assetPath): assetPath is string => Boolean(assetPath))
      .filter((assetPath) => !NodeFS.existsSync(NodePath.join(publicDirectory, assetPath)))
      .map((assetPath) => `${NodePath.relative(repoRoot, sourceFile)} -> /${assetPath}`);
  });
}

function missingIconComposerAssets(bundlePath: string): string[] {
  const bundleDirectory = absolute(bundlePath);
  const document = JSON.parse(
    NodeFS.readFileSync(NodePath.join(bundleDirectory, "icon.json"), "utf8"),
  ) as {
    groups?: ReadonlyArray<{ layers?: ReadonlyArray<{ "image-name"?: string }> }>;
  };

  return (document.groups ?? []).flatMap((group) =>
    (group.layers ?? [])
      .map((layer) => layer["image-name"])
      .filter((assetName): assetName is string => Boolean(assetName))
      .filter(
        (assetName) => !NodeFS.existsSync(NodePath.join(bundleDirectory, "Assets", assetName)),
      )
      .map((assetName) => `${bundlePath}/Assets/${assetName}`),
  );
}

describe("asset integrity", () => {
  it("keeps marketing scripts compatible with the strict same-origin CSP", () => {
    const layout = NodeFS.readFileSync(absolute("apps/marketing/src/layouts/Layout.astro"), "utf8");
    const legalPage = NodeFS.readFileSync(
      absolute("apps/marketing/src/components/LegalPage.astro"),
      "utf8",
    );

    expect(layout).toContain('<script is:inline src="/site.js"></script>');
    expect(NodeFS.existsSync(absolute("apps/marketing/public/site.js"))).toBe(true);
    expect(layout).not.toMatch(/<script(?:\s[^>]*)?>(?!\s*<\/script>)[\s\S]+?<\/script>/u);
    expect(legalPage).not.toMatch(/<script(?:\s[^>]*)?>(?!\s*<\/script>)[\s\S]+?<\/script>/u);
  });

  it("keeps source-controlled web and marketing asset references resolvable", () => {
    expect([
      ...missingPublicAssetReferences(
        absolute("apps/marketing/src"),
        absolute("apps/marketing/public"),
      ),
      ...missingPublicAssetReferences(absolute("apps/web/src"), absolute("apps/web/public")),
    ]).toEqual([]);
  });

  it("keeps every desktop and hosted brand asset available", () => {
    expect(
      Object.values(BRAND_ASSET_PATHS).filter(
        (assetPath) => !NodeFS.existsSync(absolute(assetPath)),
      ),
    ).toEqual([]);
  });

  it("keeps every icon-composer layer available", () => {
    expect(
      [
        "apps/mobile/assets/icon-composer-dev.icon",
        "apps/mobile/assets/icon-composer-prod.icon",
        "assets/dev/blueprint-icon-composer.icon",
      ].flatMap(missingIconComposerAssets),
    ).toEqual([]);
  });

  it("keeps every mobile app-config asset available", () => {
    const configPath = absolute("apps/mobile/app.config.ts");
    const config = NodeFS.readFileSync(configPath, "utf8");
    const references = [...config.matchAll(/["'](\.\/assets\/[^"']+)["']/gu)]
      .map((match) => match[1])
      .filter((assetPath): assetPath is string => Boolean(assetPath));

    expect(
      references.filter(
        (assetPath) =>
          !NodeFS.existsSync(NodePath.resolve(NodePath.dirname(configPath), assetPath)),
      ),
    ).toEqual([]);
  });

  it("uses the approved Not Codex mark across first-party app and channel icons", () => {
    expectSameAsset(BRAND_ASSET_PATHS.productionLinuxIconPng, [
      BRAND_ASSET_PATHS.productionMacIconPng,
      "assets/prod/black-ios-1024.png",
      BRAND_ASSET_PATHS.nightlyMacIconPng,
      BRAND_ASSET_PATHS.nightlyLinuxIconPng,
      "assets/nightly/blueprint-ios-1024.png",
      BRAND_ASSET_PATHS.developmentDesktopIconPng,
      "assets/dev/blueprint-universal-1024.png",
      "assets/dev/blueprint-ios-1024.png",
      "apps/mobile/assets/splash-icon-dev.png",
      "apps/mobile/assets/splash-icon-prod.png",
      "apps/mobile/assets/icon-composer-dev.icon/Assets/NotCodex.png",
      "apps/mobile/assets/icon-composer-prod.icon/Assets/NotCodex.png",
      "assets/dev/blueprint-icon-composer.icon/Assets/NotCodex.png",
    ]);

    expectSameAsset("apps/marketing/public/icon.png", ["apps/desktop/resources/icon.png"]);

    expectSameAsset(BRAND_ASSET_PATHS.productionWebAppleTouchIconPng, [
      BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
      BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
      "apps/marketing/public/apple-touch-icon.png",
      "apps/web/public/apple-touch-icon.png",
    ]);
  });
});
