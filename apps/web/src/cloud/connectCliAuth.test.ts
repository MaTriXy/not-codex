import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  buildConnectCliClerkAuthorizeUrl,
  forgetConnectCliAuthState,
  hasConnectCliAuthConfig,
  hasConnectCliAuthState,
  readConnectCliCallbackResult,
  rememberConnectCliAuthState,
} from "./connectCliAuth";

// Any pk_test_* key decodes to <base64 hostname>.clerk.accounts.dev.
const TEST_PUBLISHABLE_KEY = `pk_test_${btoa("witty-mole-42.clerk.accounts.dev$")}`;

function createStorageStub(): Storage {
  const entries = new Map<string, string>();
  return {
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    },
    removeItem: (key) => entries.delete(key),
    setItem: (key, value) => entries.set(key, value),
  };
}

describe("connectCliAuth", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { sessionStorage: createStorageStub() });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("requires both the publishable key and the CLI OAuth client id", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", TEST_PUBLISHABLE_KEY);
    vi.stubEnv("VITE_CLERK_JWT_TEMPLATE", "notcodex-relay");
    vi.stubEnv("VITE_NOT_CODEX_RELAY_URL", "https://relay.example.com");
    expect(hasConnectCliAuthConfig()).toBe(false);

    vi.stubEnv("VITE_CLERK_CLI_OAUTH_CLIENT_ID", "oauthapp_123");
    expect(hasConnectCliAuthConfig()).toBe(true);
  });

  it("builds the Clerk authorize URL with the initiating hosted origin's callback", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", TEST_PUBLISHABLE_KEY);
    vi.stubEnv("VITE_CLERK_CLI_OAUTH_CLIENT_ID", "oauthapp_123");
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://app.notcodex.bpro.dev");
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");

    const authorizeUrl = buildConnectCliClerkAuthorizeUrl(
      {
        state: "state-1",
        challenge: "challenge-1",
      },
      new URL("https://nightly.app.notcodex.bpro.dev/connect"),
    );
    expect(authorizeUrl).not.toBeNull();

    const url = new URL(authorizeUrl!);
    expect(url.hostname).toBe("witty-mole-42.clerk.accounts.dev");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://nightly.app.notcodex.bpro.dev/connect/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("redirects straight to the CLI's loopback listener when the request carries a port", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", TEST_PUBLISHABLE_KEY);
    vi.stubEnv("VITE_CLERK_CLI_OAUTH_CLIENT_ID", "oauthapp_123");
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://app.notcodex.bpro.dev");

    const authorizeUrl = buildConnectCliClerkAuthorizeUrl(
      {
        state: "state-1",
        challenge: "challenge-1",
        loopbackPort: 34338,
      },
      new URL("https://app.notcodex.bpro.dev/connect"),
    );
    expect(authorizeUrl).not.toBeNull();

    const url = new URL(authorizeUrl!);
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:34338/callback");
    expect(url.searchParams.get("state")).toBe("state-1");
  });

  it("returns null when the CLI OAuth client id is not configured", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", TEST_PUBLISHABLE_KEY);
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://app.notcodex.bpro.dev");
    expect(
      buildConnectCliClerkAuthorizeUrl(
        { state: "state-1", challenge: "challenge-1" },
        new URL("https://app.notcodex.bpro.dev/connect"),
      ),
    ).toBeNull();
  });

  it("returns null when the hosted app origin is not configured", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", TEST_PUBLISHABLE_KEY);
    vi.stubEnv("VITE_CLERK_CLI_OAUTH_CLIENT_ID", "oauthapp_123");

    expect(
      buildConnectCliClerkAuthorizeUrl(
        { state: "state-1", challenge: "challenge-1" },
        new URL("https://app.notcodex.bpro.dev/connect"),
      ),
    ).toBeNull();
  });

  it("reads the code and state Clerk echoes back to the callback", () => {
    expect(
      readConnectCliCallbackResult(
        new URL("https://app.notcodex.bpro.dev/connect/callback?code=abc&state=state-1"),
      ),
    ).toEqual({ code: "abc", state: "state-1" });
    expect(
      readConnectCliCallbackResult(
        new URL("https://app.notcodex.bpro.dev/connect/callback?code=abc"),
      ),
    ).toBeNull();
    expect(
      readConnectCliCallbackResult(
        new URL("https://app.notcodex.bpro.dev/connect/callback?state=s"),
      ),
    ).toBeNull();
  });

  it("tracks concurrent authorization states independently and consumes one match", () => {
    rememberConnectCliAuthState("state-1");
    rememberConnectCliAuthState("state-2");

    expect(hasConnectCliAuthState("state-1")).toBe(true);
    expect(hasConnectCliAuthState("state-2")).toBe(true);

    forgetConnectCliAuthState("state-1");
    expect(hasConnectCliAuthState("state-1")).toBe(false);
    expect(hasConnectCliAuthState("state-2")).toBe(true);
  });

  it("bounds pending authorization state storage", () => {
    for (let index = 0; index < 10; index += 1) {
      rememberConnectCliAuthState(`state-${index}`);
    }

    expect(hasConnectCliAuthState("state-0")).toBe(false);
    expect(hasConnectCliAuthState("state-1")).toBe(false);
    expect(hasConnectCliAuthState("state-2")).toBe(true);
    expect(hasConnectCliAuthState("state-9")).toBe(true);
  });
});
