import * as NodeNet from "node:net";

import { assert, expect, it } from "@effect/vitest";
import { PNG } from "pngjs";

import showcaseConfig, {
  resolveShowcaseAndroidAbi,
  type ShowcaseConfig,
  type ShowcaseStoreAssetSpec,
} from "./mobile-showcase.config.ts";
import {
  SHOWCASE_ENVIRONMENTS,
  SHOWCASE_PROJECTS,
  SHOWCASE_THREADS,
} from "./mobile-showcase-environment.ts";
import {
  androidSettingRestoreArgs,
  assertShowcasePortAvailable,
  encodeAndroidPairingUrls,
  normalizeStorePng,
  parseShowcaseCliArgs,
  parsePairingCredentialOutput,
  parseAndroidNightMode,
  parseAndroidWmOverride,
  planShowcaseCaptures,
  readPngDimensions,
  readPngMetadata,
  resolveAndroidSdkRoot,
  selectLanIpv4Address,
  showcaseCaptureDirectory,
  showcaseSceneUrl,
  validateStoreAsset,
  validateStoreAssetCount,
} from "./mobile-showcase.ts";

const appleSpec: ShowcaseStoreAssetSpec = {
  store: "apple",
  directory: "apple/iphone-test",
  width: 1284,
  height: 2778,
  minimumUploadCount: 1,
  maximumUploadCount: 10,
};

const googleSpec: ShowcaseStoreAssetSpec = {
  store: "google-play",
  directory: "google-play/phone",
  width: 1080,
  height: 1920,
  minimumUploadCount: 2,
  maximumUploadCount: 8,
  maximumFileSizeBytes: 8 * 1024 * 1024,
};

const config: ShowcaseConfig = {
  outputDirectory: "artifacts",
  metroPort: 8199,
  settleDelayMs: 1,
  devices: [
    {
      id: "phone",
      platform: "ios",
      simulator: "iPhone Test",
      reuseExistingSimulator: false,
      scenes: ["thread", "review"],
      storeAsset: appleSpec,
    },
    {
      id: "pixel",
      platform: "android",
      avd: "Pixel_Test",
      scenes: ["thread", "terminal"],
      storeAsset: googleSpec,
    },
  ],
};

it("parses repeatable capture filters", () => {
  const options = parseShowcaseCliArgs([
    "--platform",
    "ios",
    "--device",
    "phone",
    "--scene",
    "review",
    "--appearance",
    "both",
    "--skip-build",
  ]);
  assert.deepStrictEqual([...options.platforms], ["ios"]);
  assert.deepStrictEqual([...options.deviceIds], ["phone"]);
  assert.deepStrictEqual([...options.scenes], ["review"]);
  assert.deepStrictEqual([...options.appearances], ["light", "dark"]);
  assert.equal(options.skipBuild, true);
});

it("rejects unsupported system appearances", () => {
  assert.throws(
    () => parseShowcaseCliArgs(["--appearance", "sepia"]),
    /Unsupported appearance 'sepia'/u,
  );
});

it("parses validation-only mode", () => {
  assert.equal(parseShowcaseCliArgs(["--validate-only"]).validateOnly, true);
});

it("selects the default Android ABI from the host architecture", () => {
  assert.equal(resolveShowcaseAndroidAbi(undefined, "arm64"), "arm64-v8a");
  assert.equal(resolveShowcaseAndroidAbi(undefined, "x64"), "x86_64");
  assert.equal(resolveShowcaseAndroidAbi(undefined, "ia32"), "x86");
  assert.equal(resolveShowcaseAndroidAbi(undefined, "arm"), "armeabi-v7a");
  assert.throws(
    () => resolveShowcaseAndroidAbi(undefined, "riscv64"),
    /Cannot infer an Android ABI for host architecture 'riscv64'/u,
  );
});

it("allows an explicit Android ABI to override the host architecture", () => {
  assert.equal(resolveShowcaseAndroidAbi("x86_64", "arm64"), "x86_64");
  assert.throws(
    () => resolveShowcaseAndroidAbi("mips", "arm64"),
    /Unsupported NOT_CODEX_SHOWCASE_ANDROID_ABI/u,
  );
});

it("uses platform-correct default Android SDK roots", () => {
  assert.equal(
    resolveAndroidSdkRoot({ HOME: "/Users/showcase" }, "darwin"),
    "/Users/showcase/Library/Android/sdk",
  );
  assert.equal(
    resolveAndroidSdkRoot({ HOME: "/home/showcase" }, "linux"),
    "/home/showcase/Android/Sdk",
  );
  assert.equal(
    resolveAndroidSdkRoot(
      { HOME: "/home/showcase", ANDROID_SDK_ROOT: "/opt/android-sdk" },
      "linux",
    ),
    "/opt/android-sdk",
  );
});

it("plans only scenes supported by each selected device", () => {
  const options = parseShowcaseCliArgs([
    "--platform",
    "all",
    "--scene",
    "terminal",
    "--appearance",
    "light",
  ]);
  const captures = planShowcaseCaptures(config, options);
  assert.deepStrictEqual(
    captures.map((capture) => ({
      id: capture.device.id,
      appearance: capture.appearance,
      scenes: capture.scenes,
    })),
    [{ id: "pixel", appearance: "light", scenes: ["terminal"] }],
  );
});

it("expands an unfiltered run to both appearances", () => {
  const captures = planShowcaseCaptures(config, parseShowcaseCliArgs([]));
  assert.deepStrictEqual(
    captures.map((capture) => [capture.device.id, capture.appearance]),
    [
      ["phone", "light"],
      ["phone", "dark"],
      ["pixel", "light"],
      ["pixel", "dark"],
    ],
  );
});

it("rejects an occupied showcase Metro port", async () => {
  const server = NodeNet.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
    await expect(assertShowcasePortAvailable(address.port)).rejects.toThrow(
      /Showcase Metro port .* is already in use/u,
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

it("parses Android emulator state for lossless restoration", () => {
  assert.equal(parseAndroidNightMode("Night mode: auto\n"), "auto");
  assert.equal(
    parseAndroidWmOverride("Physical size: 1080x2400\nOverride size: 1080x1920\n", "size"),
    "1080x1920",
  );
  assert.equal(parseAndroidWmOverride("Physical density: 420\n", "density"), null);
  assert.throws(() => parseAndroidNightMode("unknown"), /Could not parse Android night mode/u);
});

it("restores absent Android settings by deleting their temporary values", () => {
  assert.deepStrictEqual(
    androidSettingRestoreArgs({ namespace: "system", key: "time_12_24", value: null }),
    ["shell", "settings", "delete", "system", "time_12_24"],
  );
  assert.deepStrictEqual(
    androidSettingRestoreArgs({
      namespace: "global",
      key: "window_animation_scale",
      value: "0.5",
    }),
    ["shell", "settings", "put", "global", "window_animation_scale", "0.5"],
  );
});

it("expands both appearances into independent upload-ready directories", () => {
  const options = parseShowcaseCliArgs(["--device", "phone", "--appearance", "both"]);
  const captures = planShowcaseCaptures(config, options);

  assert.deepStrictEqual(
    captures.map((capture) => ({
      appearance: capture.appearance,
      directory: showcaseCaptureDirectory("/captures", capture),
    })),
    [
      { appearance: "light", directory: "/captures/apple/iphone-test/light" },
      { appearance: "dark", directory: "/captures/apple/iphone-test/dark" },
    ],
  );
});

it("rejects unknown devices instead of silently capturing another target", () => {
  const options = parseShowcaseCliArgs(["--device", "missing"]);
  assert.throws(() => planShowcaseCaptures(config, options), /Unknown device 'missing'/u);
});

it("reads captured PNG dimensions from the IHDR header", () => {
  const bytes = new Uint8Array(26);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 1320);
  view.setUint32(20, 2868);
  view.setUint8(24, 8);
  view.setUint8(25, 2);
  assert.deepStrictEqual(readPngDimensions(bytes), { width: 1320, height: 2868 });
  assert.deepStrictEqual(readPngMetadata(bytes), {
    width: 1320,
    height: 2868,
    bitDepth: 8,
    colorType: 2,
    hasAlpha: false,
  });
});

function rgbaPng(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(255);
  return PNG.sync.write(png);
}

it("converts simulator RGBA captures to upload-safe 24-bit RGB PNGs", () => {
  const normalized = normalizeStorePng(rgbaPng(2, 3));
  assert.deepStrictEqual(readPngMetadata(normalized), {
    width: 2,
    height: 3,
    bitDepth: 8,
    colorType: 2,
    hasAlpha: false,
  });
});

it("validates exact Apple and Google Play upload assets", () => {
  const apple = normalizeStorePng(rgbaPng(appleSpec.width, appleSpec.height));
  const google = normalizeStorePng(rgbaPng(googleSpec.width, googleSpec.height));
  assert.equal(validateStoreAsset(appleSpec, apple).width, 1284);
  assert.equal(validateStoreAsset(googleSpec, google).height, 1920);
});

it("rejects truncated PNGs that only contain a plausible header", () => {
  const bytes = new Uint8Array(26);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, appleSpec.width);
  view.setUint32(20, appleSpec.height);
  view.setUint8(24, 8);
  view.setUint8(25, 2);
  assert.throws(() => validateStoreAsset(appleSpec, bytes), /Screenshot is not a decodable PNG/u);
});

it("rejects wrong dimensions and alpha-bearing PNGs", () => {
  const wrongSize = normalizeStorePng(rgbaPng(1242, 2688));
  assert.throws(() => validateStoreAsset(appleSpec, wrongSize), /requires 1284×2778/u);
  assert.throws(() => validateStoreAsset(appleSpec, rgbaPng(1284, 2778)), /without alpha/u);
});

it("enforces store screenshot count limits", () => {
  assert.doesNotThrow(() => validateStoreAssetCount(googleSpec, 5, true));
  assert.throws(() => validateStoreAssetCount(googleSpec, 1, true), /requires at least 2/u);
  assert.throws(() => validateStoreAssetCount(googleSpec, 9, false), /allows at most 8/u);
});

it("configures every default device with an exact upload-ready store target", () => {
  assert.deepStrictEqual(
    showcaseConfig.devices.map((device) => [
      device.id,
      device.storeAsset.directory,
      device.storeAsset.width,
      device.storeAsset.height,
    ]),
    [
      ["iphone-6.9", "apple/iphone-6.9", 1320, 2868],
      ["iphone-6.5", "apple/iphone-6.5", 1284, 2778],
      ["ipad-13", "apple/ipad-13", 2064, 2752],
      ["pixel", "google-play/phone", 1080, 1920],
      ["android-tablet-7", "google-play/tablet-7", 1080, 1920],
      ["android-tablet-10", "google-play/tablet-10", 1440, 2560],
    ],
  );
});

it("uses disposable iOS simulators by default", () => {
  const iosDevices = showcaseConfig.devices.filter((device) => device.platform === "ios");
  assert.equal(iosDevices.length, 3);
  assert.equal(
    iosDevices.every(
      (device) => !device.reuseExistingSimulator && Boolean(device.simulatorDeviceType),
    ),
    true,
  );
});

it("selects a reachable LAN IPv4 address", () => {
  assert.equal(
    selectLanIpv4Address([
      { address: "127.0.0.1", family: "IPv4", internal: true },
      { address: "fe80::1", family: "IPv6", internal: false },
      { address: "169.254.2.4", family: "IPv4", internal: false },
      { address: "192.168.1.80", family: "IPv4", internal: false },
    ]),
    "192.168.1.80",
  );
});

it("maps capture scenes to the real application routes", () => {
  assert.equal(showcaseSceneUrl("threads", "environment-1"), "notcodex-dev://");
  assert.equal(
    showcaseSceneUrl("environments", "environment-1"),
    "notcodex-dev://settings/environments",
  );
  assert.equal(
    showcaseSceneUrl("thread", "environment-1"),
    "notcodex-dev://threads/environment-1/remote-command-center",
  );
  assert.equal(
    showcaseSceneUrl("terminal", "environment-1"),
    "notcodex-dev://threads/environment-1/remote-command-center/terminal?terminalId=term-1",
  );
  assert.equal(
    showcaseSceneUrl("review", "environment-1"),
    "notcodex-dev://threads/environment-1/remote-command-center/review",
  );
});

it("seeds a playful multi-environment project spectrum", () => {
  assert.deepStrictEqual(
    SHOWCASE_PROJECTS.map((project) => project.title),
    ["Not Codex", "React", "Linux"],
  );
  assert.deepStrictEqual(
    SHOWCASE_ENVIRONMENTS.map((environment) => environment.label),
    ["Moonbase Terminal", "Suspense Station", "Kernel Cabin"],
  );
  assert.equal(SHOWCASE_THREADS.length, 6);
  assert.equal(new Set(SHOWCASE_THREADS.map((thread) => thread.projectId)).size, 3);
  assert.equal(
    SHOWCASE_PROJECTS.every((project) => project.favicon.includes("<svg")),
    true,
  );
});

it("reads multiline JSON from the pairing CLI", () => {
  assert.equal(
    parsePairingCredentialOutput('server log\n{\n  "credential": "PAIR-ME"\n}\n'),
    "PAIR-ME",
  );
});

it("encodes Android pairing URLs without shell-sensitive JSON quotes", () => {
  const urls = ["http://10.0.2.2:65164/#token=ONE", "http://10.0.2.2:65198/#token=TWO"];
  const encoded = encodeAndroidPairingUrls(urls);
  assert.equal(encoded.startsWith("json-uri:"), true);
  assert.deepStrictEqual(JSON.parse(decodeURIComponent(encoded.slice("json-uri:".length))), urls);
  assert.equal(encoded.includes('"'), false);
});
