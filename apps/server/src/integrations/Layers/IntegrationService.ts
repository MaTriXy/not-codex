import { IntegrationRequestError, type LoopAnySettings } from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { IntegrationService } from "../Services/IntegrationService.ts";
import { MonkeyLoopyService } from "../Services/MonkeyLoopyService.ts";

export const LOOPANY_DEVICE_TOKEN_SECRET = "integration-loopany-device-token";
export const MONKEY_D_LOOPY_VERSION = "0.5.0";
export const LOOPANY_PROTOCOL_VERSION = "2026-07";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function requestError(
  code: IntegrationRequestError["code"],
  message: string,
  cause?: unknown,
): IntegrationRequestError {
  return new IntegrationRequestError({ code, message, ...(cause === undefined ? {} : { cause }) });
}

function normalizeServerUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("LoopAny server URL must use HTTPS or HTTP.");
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function validateLoopAnySettings(settings: LoopAnySettings): void {
  if (settings.serverUrl.length > 0) normalizeServerUrl(settings.serverUrl);
  if (settings.enabled && settings.serverUrl.length === 0) {
    throw new Error("A LoopAny server URL is required before enabling the connector.");
  }
  if (settings.enabled && settings.allowedRoots.length === 0) {
    throw new Error("At least one allowed project root is required before enabling LoopAny.");
  }
}

export const makeIntegrationService = Effect.gen(function* () {
  const settings = yield* ServerSettingsService;
  const secrets = yield* ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;
  const monkeyLoopy = yield* MonkeyLoopyService;

  const readToken = secrets
    .get(LOOPANY_DEVICE_TOKEN_SECRET)
    .pipe(Effect.mapError((cause) => requestError("not-configured", cause.message, cause)));

  const list: IntegrationService["Service"]["list"] = Effect.gen(function* () {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError((cause) => requestError("invalid-config", cause.message, cause)),
    );
    const tokenConfigured = Option.isSome(yield* readToken);
    const loopAny = current.integrations.loopAny;
    return {
      integrations: [
        {
          id: "monkey-d-loopy",
          name: "Monkey.D.Loopy",
          description: "Validated, bounded, crash-resumable agent loops running through Not Codex.",
          version: MONKEY_D_LOOPY_VERSION,
          state: "ready",
          capabilities: ["validate", "verify", "run", "resume", "inspect", "mcp"],
          tokenConfigured: false,
          lastActivityAt: null,
          error: null,
        },
        {
          id: "loopany",
          name: "LoopAny",
          description: "Optional external scheduling and delivery for the local Not Codex harness.",
          version: LOOPANY_PROTOCOL_VERSION,
          state: !loopAny.enabled
            ? "disabled"
            : tokenConfigured && loopAny.serverUrl.length > 0
              ? "disconnected"
              : "error",
          capabilities: ["schedule", "deliver", "report"],
          tokenConfigured,
          lastActivityAt: null,
          error:
            loopAny.enabled && (!tokenConfigured || loopAny.serverUrl.length === 0)
              ? "LoopAny is enabled but its URL or device token is missing."
              : null,
        },
      ],
    };
  });

  const configureLoopAny: IntegrationService["Service"]["configureLoopAny"] = Effect.fn(
    "IntegrationService.configureLoopAny",
  )(function* (input) {
    if (input.clearToken && input.token !== undefined && input.token.length > 0) {
      return yield* requestError(
        "invalid-config",
        "A LoopAny token cannot be set and cleared in the same request.",
      );
    }
    const current = yield* settings.getSettings.pipe(
      Effect.mapError((cause) => requestError("invalid-config", cause.message, cause)),
    );
    const nextLoopAny: LoopAnySettings = {
      ...current.integrations.loopAny,
      ...input.settings,
      ...(input.settings.serverUrl === undefined
        ? {}
        : { serverUrl: normalizeServerUrl(input.settings.serverUrl) }),
    };
    yield* Effect.try({
      try: () => validateLoopAnySettings(nextLoopAny),
      catch: (cause) => requestError("invalid-config", String(cause), cause),
    });

    if (input.clearToken || input.token === "") {
      yield* secrets
        .remove(LOOPANY_DEVICE_TOKEN_SECRET)
        .pipe(Effect.mapError((cause) => requestError("invalid-config", cause.message, cause)));
    } else if (input.token !== undefined) {
      yield* secrets
        .set(LOOPANY_DEVICE_TOKEN_SECRET, textEncoder.encode(input.token))
        .pipe(Effect.mapError((cause) => requestError("invalid-config", cause.message, cause)));
    }

    const tokenConfigured = Option.isSome(yield* readToken);
    if (nextLoopAny.enabled && !tokenConfigured) {
      return yield* requestError(
        "not-configured",
        "A LoopAny device token is required before enabling the connector.",
      );
    }
    const updated = yield* settings
      .updateSettings({ integrations: { loopAny: nextLoopAny } })
      .pipe(Effect.mapError((cause) => requestError("invalid-config", cause.message, cause)));
    return { settings: updated.integrations.loopAny, tokenConfigured };
  });

  const testLoopAny: IntegrationService["Service"]["testLoopAny"] = Effect.gen(function* () {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError((cause) => requestError("invalid-config", cause.message, cause)),
    );
    const serverUrl = normalizeServerUrl(current.integrations.loopAny.serverUrl);
    const tokenOption = yield* readToken;
    if (serverUrl.length === 0 || Option.isNone(tokenOption)) {
      return yield* requestError(
        "not-configured",
        "Configure the LoopAny server URL and device token before testing the connection.",
      );
    }
    const token = textDecoder.decode(tokenOption.value);
    const response = yield* httpClient
      .execute(
        HttpClientRequest.get(`${serverUrl}/api/machine/status`).pipe(
          HttpClientRequest.bearerToken(token),
          HttpClientRequest.setHeader("Accept", "application/json"),
        ),
      )
      .pipe(
        Effect.timeout("10 seconds"),
        Effect.mapError((cause) =>
          requestError("connection-failed", "Could not reach the LoopAny server.", cause),
        ),
      );
    if (response.status === 401 || response.status === 403) {
      return yield* requestError("unauthorized", "The LoopAny device token was rejected.");
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* requestError("connection-failed", `LoopAny returned HTTP ${response.status}.`);
    }
    return { ok: true, message: "Connected to LoopAny.", serverVersion: null };
  });

  const validateMonkeyLoopy = monkeyLoopy.validate;
  const runMonkeyLoopy = monkeyLoopy.run;

  return IntegrationService.of({
    list,
    configureLoopAny,
    testLoopAny,
    validateMonkeyLoopy,
    runMonkeyLoopy,
  });
});

export const IntegrationServiceLive = Layer.effect(IntegrationService, makeIntegrationService);
