import {
  buildConnectClerkAuthorizeUrl,
  connectCallbackUrl,
  connectLoopbackRedirectUri,
  CONNECT_OAUTH_SCOPES,
  type ConnectAuthorizeRequest,
} from "@notcodex/shared/connectAuth";
import { clerkFrontendApiUrlFromPublishableKey } from "@notcodex/shared/relayAuth";

import { isHostedStaticApp } from "../hostedPairing";
import { hasCloudPublicConfig, resolveCloudPublicConfig, trimNonEmpty } from "./publicConfig";

const CONNECT_CLI_AUTH_STATE_STORAGE_KEY = "notcodex-connect-cli-auth-state";
const MAX_PENDING_CONNECT_CLI_AUTH_STATES = 8;

export function resolveConnectCliOAuthClientId(): string | null {
  return trimNonEmpty(import.meta.env.VITE_CLERK_CLI_OAUTH_CLIENT_ID as string | undefined);
}

export function hasConnectCliAuthConfig(): boolean {
  return Boolean(
    resolveCloudPublicConfig().clerkPublishableKey && resolveConnectCliOAuthClientId(),
  );
}

/**
 * Gate for the /connect routes: the CLI handshake only exists on the hosted
 * deployment (the same bundle ships inside local instances) and needs the
 * Clerk CLI OAuth client configured at build time.
 */
export function connectCliAuthRoutesEnabled(): boolean {
  return isHostedStaticApp() && hasCloudPublicConfig() && hasConnectCliAuthConfig();
}

/**
 * Builds the Clerk authorize URL for a CLI-initiated connect request. The
 * state is mirrored into sessionStorage so the callback page can verify the
 * response matches a request this browser actually started.
 *
 * A request carrying a loopback port came from a CLI with a local callback
 * listener: the authorization code must return to `127.0.0.1` directly, so
 * the hosted callback page never sees it. Clerk enforces its registered
 * redirect URI allowlist either way.
 */
export function buildConnectCliClerkAuthorizeUrl(
  request: ConnectAuthorizeRequest,
  currentUrl: URL = new URL(window.location.href),
): string | null {
  const { clerkPublishableKey } = resolveCloudPublicConfig();
  const clientId = resolveConnectCliOAuthClientId();
  if (!clerkPublishableKey || !clientId || !isHostedStaticApp(currentUrl)) {
    return null;
  }
  return buildConnectClerkAuthorizeUrl({
    authorizationEndpoint: `${clerkFrontendApiUrlFromPublishableKey(clerkPublishableKey)}/oauth/authorize`,
    clientId,
    redirectUri:
      request.loopbackPort === undefined
        ? connectCallbackUrl(currentUrl.origin)
        : connectLoopbackRedirectUri(request.loopbackPort),
    scopes: CONNECT_OAUTH_SCOPES,
    state: request.state,
    challenge: request.challenge,
  });
}

export function rememberConnectCliAuthState(state: string): void {
  try {
    const pendingStates = readStoredConnectCliAuthStates().filter((entry) => entry !== state);
    pendingStates.push(state);
    window.sessionStorage.setItem(
      CONNECT_CLI_AUTH_STATE_STORAGE_KEY,
      JSON.stringify(pendingStates.slice(-MAX_PENDING_CONNECT_CLI_AUTH_STATES)),
    );
  } catch {
    // Session storage can be unavailable (for example when blocked). The
    // callback page fails closed when it cannot recover this state.
  }
}

/**
 * Read-only on purpose: this runs during render, where a removal could be
 * consumed by React's double-invoked/discarded renders (StrictMode). The
 * matched state is removed later by an effect on the accepted callback.
 */
export function hasConnectCliAuthState(state: string): boolean {
  return readStoredConnectCliAuthStates().includes(state);
}

export function forgetConnectCliAuthState(state: string): void {
  try {
    const pendingStates = readStoredConnectCliAuthStates().filter((entry) => entry !== state);
    if (pendingStates.length === 0) {
      window.sessionStorage.removeItem(CONNECT_CLI_AUTH_STATE_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(
        CONNECT_CLI_AUTH_STATE_STORAGE_KEY,
        JSON.stringify(pendingStates),
      );
    }
  } catch {
    // Storage failures leave the callback fail-closed on the next render.
  }
}

function readStoredConnectCliAuthStates(): Array<string> {
  try {
    const stored = window.sessionStorage.getItem(CONNECT_CLI_AUTH_STATE_STORAGE_KEY);
    if (!stored) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is string => typeof entry === "string" && entry !== "");
      }
      return typeof parsed === "string" && parsed !== "" ? [parsed] : [];
    } catch {
      // Backward compatibility with the previous single raw-state format.
      return [stored];
    }
  } catch {
    return [];
  }
}

export interface ConnectCliCallbackResult {
  readonly code: string;
  readonly state: string;
}

export function readConnectCliCallbackResult(
  url: URL = new URL(window.location.href),
): ConnectCliCallbackResult | null {
  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  if (!code || !state) {
    return null;
  }
  return { code, state };
}
