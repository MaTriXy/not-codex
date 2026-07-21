import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  buildHostedChannelSelectionUrl,
  buildHostedPairingUrl,
  hasHostedPairingRequest,
  isHostedStaticApp,
  readHostedPairingRequest,
} from "./hostedPairing";

describe("hostedPairing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads hosted pairing host and query token parameters", () => {
    const url = new URL("https://app.notcodex.bpro.dev/pair?host=100.64.1.2:3773&token=ABCD1234");

    expect(readHostedPairingRequest(url)).toEqual({
      host: "100.64.1.2:3773",
      token: "ABCD1234",
      label: "",
    });
    expect(hasHostedPairingRequest(url)).toBe(true);
  });

  it("prefers hash tokens so generated hosted links do not put credentials in search params", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://preview.notcodex.test");

    const pairingUrl = buildHostedPairingUrl({
      host: "https://backend.example.com:3773",
      token: "pairing-token",
      label: "Workstation",
    });
    if (pairingUrl === null) throw new Error("expected configured hosted pairing URL");
    const url = new URL(pairingUrl);

    expect(url.origin).toBe("https://preview.notcodex.test");
    expect(url.pathname).toBe("/pair");
    expect(url.searchParams.get("host")).toBe("https://backend.example.com:3773");
    expect(url.searchParams.get("label")).toBe("Workstation");
    expect(url.searchParams.has("token")).toBe(false);
    expect(url.hash).toBe("#token=pairing-token");
  });

  it("builds hosted channel selection URLs through the configured router origin", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://app.notcodex.bpro.dev");

    const selectionUrl = buildHostedChannelSelectionUrl({
      channel: "nightly",
    });
    if (selectionUrl === null) throw new Error("expected configured hosted channel URL");
    const url = new URL(selectionUrl);

    expect(url.origin).toBe("https://app.notcodex.bpro.dev");
    expect(url.pathname).toBe("/__notcodex/channel");
    expect(url.searchParams.get("channel")).toBe("nightly");
    expect(url.searchParams.has("next")).toBe(false);
  });

  it("ignores incomplete hosted pairing requests", () => {
    expect(
      hasHostedPairingRequest(
        new URL("https://app.notcodex.bpro.dev/pair?host=backend.example.com"),
      ),
    ).toBe(false);
    expect(
      hasHostedPairingRequest(new URL("https://app.notcodex.bpro.dev/pair?token=ABCD1234")),
    ).toBe(false);
  });

  it("does not advertise a hosted app without an explicit deployment URL", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "");

    expect(
      buildHostedPairingUrl({ host: "https://backend.example.com", token: "PAIRCODE" }),
    ).toBeNull();
    expect(buildHostedChannelSelectionUrl({ channel: "latest" })).toBeNull();
    expect(isHostedStaticApp(new URL("https://app.notcodex.bpro.dev/"))).toBe(false);
  });

  it("detects the hosted static app only when no backend URL is configured", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://preview.notcodex.test");
    vi.stubEnv("VITE_HTTP_URL", "");
    vi.stubEnv("VITE_WS_URL", "");

    expect(isHostedStaticApp(new URL("https://preview.notcodex.test/"))).toBe(true);
    expect(isHostedStaticApp(new URL("https://preview.notcodex.test/pair"))).toBe(true);
    expect(isHostedStaticApp(new URL("https://backend.example.com/"))).toBe(false);

    vi.stubEnv("VITE_HTTP_URL", "https://backend.example.com");
    expect(isHostedStaticApp(new URL("https://preview.notcodex.test/"))).toBe(false);
  });

  it("detects hosted channel aliases as static apps", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://app.notcodex.bpro.dev");
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");
    vi.stubEnv("VITE_HTTP_URL", "");
    vi.stubEnv("VITE_WS_URL", "");

    expect(isHostedStaticApp(new URL("https://nightly.app.notcodex.bpro.dev/"))).toBe(true);

    vi.stubEnv("VITE_HTTP_URL", "https://backend.example.com");
    expect(isHostedStaticApp(new URL("https://nightly.app.notcodex.bpro.dev/"))).toBe(false);
  });
});
