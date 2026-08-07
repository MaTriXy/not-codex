import { describe, expect, it } from "vite-plus/test";

import {
  deriveOpenKrittSettingsCard,
  parseOpenKrittAllowedAddressesInput,
  validateOpenKrittSettingsDraft,
} from "./IntegrationsSettings.tsx";

describe("Open Kritt integration settings presentation", () => {
  it("advertises the separately installed AGPL service and disabled-by-default state", () => {
    const card = deriveOpenKrittSettingsCard({
      enabled: false,
      tokenConfigured: false,
      serverUrl: "",
      health: "disabled",
    });

    expect(card).toMatchObject({
      title: "Open Kritt",
      enabled: false,
      tokenConfigured: false,
      links: expect.arrayContaining([
        expect.objectContaining({
          href: expect.stringContaining("github.com/Kritt-ai/open-kritt"),
        }),
        expect.objectContaining({ href: expect.stringContaining("docs.kritt.ai") }),
      ]),
      warning: expect.stringMatching(/separate|AGPL|provider|network/i),
    });
  });

  it("blocks enabling a non-loopback endpoint until security warning acknowledgement is explicit", () => {
    const draft = {
      enabled: true,
      serverUrl: "https://kritt.internal.example",
      authMode: "bearer" as const,
      tokenConfigured: true,
      replacementToken: "",
      acknowledgeNonLoopbackWarning: false,
    };
    expect(validateOpenKrittSettingsDraft(draft)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/warning|private|authentication/i),
    });
    expect(
      validateOpenKrittSettingsDraft({ ...draft, acknowledgeNonLoopbackWarning: true }),
    ).toMatchObject({ ok: true });
  });

  it("keeps token controls write-only and never serializes a bearer token into settings state", () => {
    const result = validateOpenKrittSettingsDraft({
      enabled: true,
      serverUrl: "http://127.0.0.1:8765",
      authMode: "bearer",
      tokenConfigured: false,
      replacementToken: "synthetic-write-only-token",
      acknowledgeNonLoopbackWarning: false,
    });
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).not.toContain("synthetic-write-only-token");
  });

  it("rejects public/insecure settings and does not offer direct browser fetch URLs", () => {
    expect(
      validateOpenKrittSettingsDraft({
        enabled: true,
        serverUrl: "http://kritt.example.test",
        authMode: "none",
        tokenConfigured: false,
        replacementToken: "",
        acknowledgeNonLoopbackWarning: true,
      }),
    ).toMatchObject({ ok: false });
    expect(JSON.stringify(validateOpenKrittSettingsDraft)).not.toContain("fetch(");
  });

  it("accepts loopback HTTPS and rejects unsupported URL schemes", () => {
    const draft = {
      enabled: true,
      serverUrl: "https://localhost:8765",
      authMode: "none" as const,
      tokenConfigured: false,
      replacementToken: "",
      acknowledgeNonLoopbackWarning: false,
    };
    expect(validateOpenKrittSettingsDraft(draft)).toMatchObject({ ok: true });
    expect(
      validateOpenKrittSettingsDraft({ ...draft, serverUrl: "ftp://localhost:8765" }),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/HTTP|HTTPS|scheme/i),
    });
  });

  it("accepts a reverse-proxy base path but rejects one the server would refuse", () => {
    const draft = {
      enabled: true,
      authMode: "none",
      tokenConfigured: false,
      replacementToken: "",
      acknowledgeNonLoopbackWarning: true,
    } as const;

    // The recommended way to authenticate an unauthenticated upstream is an
    // operator-run reverse proxy, which commonly terminates at a subpath.
    expect(
      validateOpenKrittSettingsDraft({ ...draft, serverUrl: "https://ops.example.test/kritt/" }),
    ).toMatchObject({ ok: true, settings: { serverUrl: "https://ops.example.test/kritt/" } });
    // Client and server must agree on the approved prefix, so encoded separators
    // and unsupported segments are refused here too.
    for (const serverUrl of [
      "https://ops.example.test/kr%2Fitt",
      "https://ops.example.test/kritt space",
      "https://ops.example.test/a/b/c/d/e/f/g/h/i",
    ]) {
      expect(validateOpenKrittSettingsDraft({ ...draft, serverUrl })).toMatchObject({
        ok: false,
        message: expect.stringMatching(/base path/i),
      });
    }
  });

  it("validates the operator private-address allowlist before saving", () => {
    const base = {
      enabled: true,
      serverUrl: "https://kritt.internal.example",
      authMode: "none" as const,
      tokenConfigured: false,
      replacementToken: "",
      acknowledgeNonLoopbackWarning: true,
    };
    expect(
      validateOpenKrittSettingsDraft({
        ...base,
        allowedPrivateAddresses: parseOpenKrittAllowedAddressesInput("192.168.10.20, 10.1.0.0/24"),
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateOpenKrittSettingsDraft({ ...base, allowedPrivateAddresses: ["kritt.internal"] }),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/literal IP/i) });
    expect(
      validateOpenKrittSettingsDraft({
        ...base,
        allowedPrivateAddresses: Array.from({ length: 9 }, (_, index) => `10.0.0.${index}`),
      }),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/at most 8/i) });
  });

  it("treats every 127.0.0.0/8 address as loopback, matching the server", () => {
    expect(
      validateOpenKrittSettingsDraft({
        enabled: true,
        serverUrl: "http://127.0.0.2:8765",
        authMode: "none",
        tokenConfigured: false,
        replacementToken: "",
        acknowledgeNonLoopbackWarning: false,
      }),
    ).toMatchObject({ ok: true });
  });
});
