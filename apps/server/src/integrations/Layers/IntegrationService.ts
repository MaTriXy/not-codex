import {
  IntegrationRequestError,
  type IntegrationRun,
  type LoopAnySettings,
} from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { IntegrationRunRepository } from "../../persistence/Services/IntegrationRunRepository.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { integrationRunRetentionCutoff, sanitizeIntegrationRunText } from "../integrationRun.ts";
import { MONKEY_D_LOOPY_FACTORY_VERSION } from "../monkeyLoopyVersions.ts";
import { IntegrationService } from "../Services/IntegrationService.ts";
import { LoopAnyConnector } from "../Services/LoopAnyConnector.ts";
import { MonkeyLoopyService } from "../Services/MonkeyLoopyService.ts";

export const LOOPANY_DEVICE_TOKEN_SECRET = "integration-loopany-device-token";
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
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error("LoopAny server URL must not contain embedded credentials.");
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
  const loopAnyConnector = yield* LoopAnyConnector;
  const runs = yield* IntegrationRunRepository;

  const readToken = secrets
    .get(LOOPANY_DEVICE_TOKEN_SECRET)
    .pipe(Effect.mapError((cause) => requestError("not-configured", cause.message, cause)));

  const list: IntegrationService["Service"]["list"] = Effect.gen(function* () {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError((cause) => requestError("invalid-config", cause.message, cause)),
    );
    const tokenConfigured = Option.isSome(yield* readToken);
    const loopAny = current.integrations.loopAny;
    const connectorStatus = yield* loopAnyConnector.status;
    return {
      integrations: [
        {
          id: "monkey-d-loopy",
          name: "Monkey.D.Loopy",
          description:
            "Full v0.5 authoring, verification, inference, and bounded execution through Not Codex.",
          version: MONKEY_D_LOOPY_FACTORY_VERSION,
          state: "ready",
          capabilities: ["author", "recipes", "infer", "validate", "verify", "run", "mcp"],
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
            : tokenConfigured && loopAny.serverUrl.length > 0 && loopAny.allowedRoots.length > 0
              ? connectorStatus.state
              : "error",
          capabilities: ["schedule", "deliver", "report"],
          tokenConfigured,
          lastActivityAt: connectorStatus.lastActivityAt,
          error:
            loopAny.enabled && (!tokenConfigured || loopAny.serverUrl.length === 0)
              ? "LoopAny is enabled but its URL or device token is missing."
              : loopAny.enabled && loopAny.allowedRoots.length === 0
                ? "LoopAny is enabled but no allowed project roots are configured."
                : connectorStatus.error,
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
    const nextLoopAny = yield* Effect.try({
      try: (): LoopAnySettings => {
        const next: LoopAnySettings = {
          ...current.integrations.loopAny,
          ...input.settings,
          ...(input.settings.serverUrl === undefined
            ? {}
            : { serverUrl: normalizeServerUrl(input.settings.serverUrl) }),
        };
        validateLoopAnySettings(next);
        return next;
      },
      catch: (cause) => requestError("invalid-config", String(cause), cause),
    });

    const existingTokenConfigured = Option.isSome(yield* readToken);
    const clearsToken = input.clearToken === true || input.token === "";
    const tokenConfiguredAfterChange = clearsToken
      ? false
      : input.token !== undefined
        ? input.token.length > 0
        : existingTokenConfigured;
    if (nextLoopAny.enabled && !tokenConfiguredAfterChange) {
      return yield* requestError(
        "not-configured",
        "A LoopAny device token is required before enabling the connector.",
      );
    }

    if (clearsToken) {
      yield* secrets
        .remove(LOOPANY_DEVICE_TOKEN_SECRET)
        .pipe(Effect.mapError((cause) => requestError("invalid-config", cause.message, cause)));
    } else if (input.token !== undefined) {
      yield* secrets
        .set(LOOPANY_DEVICE_TOKEN_SECRET, textEncoder.encode(input.token))
        .pipe(Effect.mapError((cause) => requestError("invalid-config", cause.message, cause)));
    }

    const tokenConfigured = Option.isSome(yield* readToken);
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

  const getMonkeyLoopyAuthoringContext = monkeyLoopy.getAuthoringContext;
  const scaffoldMonkeyLoopy = monkeyLoopy.scaffold;
  const inferMonkeyLoopy = monkeyLoopy.infer;
  const validateMonkeyLoopy = monkeyLoopy.validate;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const asRequestError = (cause: { readonly message: string }) =>
    requestError("execution-failed", cause.message, cause);
  const newRunId = Random.next.pipe(Effect.map((value) => `monkey-${value.toString(36).slice(2)}`));
  const transition = (run: IntegrationRun, from: ReadonlyArray<IntegrationRun["state"]>) =>
    runs.transition(run, from).pipe(Effect.mapError(asRequestError));

  const runMonkeyLoopy: IntegrationService["Service"]["runMonkeyLoopy"] = Effect.fn(
    "IntegrationService.runMonkeyLoopy",
  )(function* (input) {
    const createdAt = yield* now;
    yield* runs
      .pruneCompletedBefore(integrationRunRetentionCutoff(createdAt))
      .pipe(Effect.mapError(asRequestError));
    const id = yield* newRunId;
    const queued: IntegrationRun = {
      id,
      source: "monkey-d-loopy",
      state: "queued",
      projectId: input.projectId,
      parentRunId: null,
      attempt: 0,
      threadIds: [],
      journalRef: null,
      outputSummary: null,
      failure: null,
      createdAt,
      startedAt: null,
      completedAt: null,
      updatedAt: createdAt,
    };
    yield* runs.insert(queued).pipe(Effect.mapError(asRequestError));
    const startedAt = yield* now;
    const running: IntegrationRun = {
      ...queued,
      state: "running",
      startedAt,
      updatedAt: startedAt,
    };
    if (!(yield* transition(running, ["queued"]))) {
      return yield* requestError("execution-failed", "Could not start the integration run.");
    }
    const result = yield* monkeyLoopy.run(input, id).pipe(
      Effect.match({
        onFailure: (error) => ({ error, result: null }),
        onSuccess: (result) => ({ error: null, result }),
      }),
    );
    const completedAt = yield* now;
    if (result.result === null) {
      const failed: IntegrationRun = {
        ...running,
        state: "failed",
        failure: sanitizeIntegrationRunText(result.error.message, 4_096),
        completedAt,
        updatedAt: completedAt,
      };
      if (!(yield* transition(failed, ["running", "waiting"]))) {
        return yield* requestError("execution-failed", "Could not fail the integration run.");
      }
      return yield* result.error;
    }
    const completed: IntegrationRun = {
      ...running,
      state: result.result.state,
      threadIds: result.result.threadIds.slice(0, 100),
      journalRef: `monkey-d-loopy/.loopy/runs/${id}`,
      outputSummary: sanitizeIntegrationRunText(result.result.output, 16_384),
      failure:
        result.result.error === null
          ? null
          : sanitizeIntegrationRunText(result.result.error, 4_096),
      completedAt: result.result.state === "waiting" ? null : completedAt,
      updatedAt: completedAt,
    };
    if (!(yield* transition(completed, ["running"]))) {
      return yield* requestError("execution-failed", "Could not complete the integration run.");
    }
    return result.result;
  });

  const listRuns: IntegrationService["Service"]["listRuns"] = Effect.fn(
    "IntegrationService.listRuns",
  )(function* (input) {
    const rows = yield* runs.list(input).pipe(Effect.mapError(asRequestError));
    const page = rows.slice(0, input.limit);
    const next = rows.length > input.limit ? page.at(-1) : undefined;
    return {
      runs: page,
      nextCursor: next === undefined ? null : { createdAt: next.createdAt, id: next.id },
    };
  });
  const getRun: IntegrationService["Service"]["getRun"] = (input) =>
    runs.get(input.id).pipe(Effect.map(Option.getOrNull), Effect.mapError(asRequestError));

  return IntegrationService.of({
    list,
    configureLoopAny,
    testLoopAny,
    getMonkeyLoopyAuthoringContext,
    scaffoldMonkeyLoopy,
    inferMonkeyLoopy,
    validateMonkeyLoopy,
    runMonkeyLoopy,
    listRuns,
    getRun,
  });
});

export const IntegrationServiceLive = Layer.effect(IntegrationService, makeIntegrationService);
