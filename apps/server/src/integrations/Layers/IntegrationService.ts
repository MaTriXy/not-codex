import {
  IntegrationRequestError,
  type IntegrationRun,
  type LoopAnySettings,
} from "@notcodex/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PartitionedSemaphore from "effect/PartitionedSemaphore";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { IntegrationRunRepository } from "../../persistence/Services/IntegrationRunRepository.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  appendIntegrationRunTimeline,
  buildInterruptedIntegrationRun,
  integrationRunRetentionCutoff,
  monkeyLoopyVerificationSummary,
  sanitizeIntegrationRunText,
} from "../integrationRun.ts";
import { LOOPANY_PROTOCOL_COMPATIBILITY } from "../loopanyCompatibility.ts";
import { MONKEY_D_LOOPY_FACTORY_VERSION } from "../monkeyLoopyVersions.ts";
import { IntegrationService } from "../Services/IntegrationService.ts";
import { LoopAnyConnector } from "../Services/LoopAnyConnector.ts";
import { MonkeyLoopyService } from "../Services/MonkeyLoopyService.ts";

export const LOOPANY_DEVICE_TOKEN_SECRET = "integration-loopany-device-token";
export const LOOPANY_PROTOCOL_VERSION = LOOPANY_PROTOCOL_COMPATIBILITY.version;

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
  const activeMonkeyLoopyRuns = new Set<string>();
  const monkeyLoopyLaunches = yield* PartitionedSemaphore.make<string>({ permits: 1 });
  const serviceScope = yield* Effect.scope;

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
        HttpClientRequest.get(
          `${serverUrl}${LOOPANY_PROTOCOL_COMPATIBILITY.endpoints.status}`,
        ).pipe(
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
  const transition = (run: IntegrationRun, from: ReadonlyArray<IntegrationRun["state"]>) =>
    runs.transition(run, from).pipe(Effect.mapError(asRequestError));
  const pruneExpiredRuns = (referenceTime: string) =>
    runs
      .pruneCompletedBefore(integrationRunRetentionCutoff(referenceTime))
      .pipe(Effect.mapError(asRequestError));

  const markRunInterrupted = Effect.fn("IntegrationService.markRunInterrupted")(function* (
    activeRun: IntegrationRun,
  ) {
    const completedAt = yield* now;
    const cancelled = buildInterruptedIntegrationRun(activeRun, completedAt);
    yield* transition(cancelled, ["queued", "running"]).pipe(
      Effect.flatMap((transitioned) =>
        transitioned
          ? Effect.void
          : Effect.logWarning("Interrupted integration run had already advanced", {
              runId: activeRun.id,
            }),
      ),
      Effect.catch((error) =>
        Effect.logWarning("Interrupted integration run could not be persisted", {
          runId: activeRun.id,
          message: error.message,
        }),
      ),
    );
  });

  const reconcileOrphanedMonkeyLoopyRuns = Effect.fn(
    "IntegrationService.reconcileOrphanedMonkeyLoopyRuns",
  )(function* (reconciledAt: string) {
    for (const state of ["queued", "running"] as const) {
      let cursor: { readonly createdAt: string; readonly id: IntegrationRun["id"] } | undefined;
      do {
        const rows = yield* runs
          .list({
            source: "monkey-d-loopy",
            state,
            limit: 100,
            ...(cursor === undefined ? {} : { cursor }),
          })
          .pipe(Effect.mapError(asRequestError));
        const page = rows.slice(0, 100);
        for (const run of page) {
          if (activeMonkeyLoopyRuns.has(run.id)) continue;
          yield* transition(buildInterruptedIntegrationRun(run, reconciledAt), [state]);
        }
        const next = rows.length > 100 ? page.at(-1) : undefined;
        cursor = next === undefined ? undefined : { createdAt: next.createdAt, id: next.id };
      } while (cursor !== undefined);
    }
  });

  const executeMonkeyLoopyRun = Effect.fn("IntegrationService.executeMonkeyLoopyRun")(function* (
    input: Parameters<IntegrationService["Service"]["runMonkeyLoopy"]>[0],
    queued: IntegrationRun,
    alreadyRunning = false,
  ) {
    let activeRun = queued;
    return yield* Effect.gen(function* () {
      let running = queued;
      if (!alreadyRunning) {
        const startedAt = yield* now;
        running = {
          ...queued,
          state: "running",
          startedAt,
          timeline: appendIntegrationRunTimeline(queued, "running", startedAt),
          updatedAt: startedAt,
        };
      }
      activeRun = running;
      if (!alreadyRunning && !(yield* transition(running, ["queued"]))) {
        return yield* requestError("execution-failed", "Could not start the integration run.");
      }
      const result = yield* monkeyLoopy.run(input, queued.id, {
        onThreadCreated: Effect.fn("IntegrationService.persistMonkeyLoopyThread")(
          function* (threadId) {
            const updatedAt = yield* now;
            const withThread: IntegrationRun = {
              ...activeRun,
              threadIds: [...new Set([...activeRun.threadIds, threadId])].slice(0, 100),
              updatedAt,
            };
            if (!(yield* transition(withThread, ["running"]))) {
              return yield* requestError(
                "execution-failed",
                "Could not persist the active integration thread.",
              );
            }
            activeRun = withThread;
          },
        ),
      });
      const completedAt = yield* now;
      const completed: IntegrationRun = {
        ...running,
        state: result.state,
        threadIds: result.threadIds.slice(0, 100),
        journalRef: `monkey-d-loopy/.loopy/runs/${queued.id}`,
        outputSummary: sanitizeIntegrationRunText(result.output, 16_384),
        failure: result.error === null ? null : sanitizeIntegrationRunText(result.error, 4_096),
        timeline: appendIntegrationRunTimeline(activeRun, result.state, completedAt),
        completedAt: result.state === "waiting" ? null : completedAt,
        updatedAt: completedAt,
      };
      if (!(yield* transition(completed, ["running"]))) {
        return yield* requestError("execution-failed", "Could not complete the integration run.");
      }
    }).pipe(Effect.onInterrupt(() => markRunInterrupted(activeRun)));
  });

  const recoverMonkeyLoopyRunFailure = Effect.fn("IntegrationService.recoverMonkeyLoopyRunFailure")(
    function* (runId: string, cause: Cause.Cause<unknown>) {
      const failure = Cause.squash(cause);
      const message =
        failure instanceof Error && failure.message.trim().length > 0
          ? failure.message
          : "Monkey D. Loopy execution failed.";
      const current = yield* runs
        .get(runId)
        .pipe(Effect.map(Option.getOrUndefined), Effect.mapError(asRequestError));
      if (current && ["queued", "running", "waiting"].includes(current.state)) {
        const completedAt = yield* now;
        const failed: IntegrationRun = {
          ...current,
          state: "failed",
          failure: sanitizeIntegrationRunText(message, 4_096),
          timeline: appendIntegrationRunTimeline(current, "failed", completedAt),
          completedAt,
          updatedAt: completedAt,
        };
        yield* transition(failed, ["queued", "running", "waiting"]);
      }
      yield* Effect.logWarning("Monkey D. Loopy background run failed", {
        runId,
        message: sanitizeIntegrationRunText(message, 4_096),
      });
    },
  );

  const forkMonkeyLoopyRun = Effect.fn("IntegrationService.forkMonkeyLoopyRun")(function* (
    input: Parameters<IntegrationService["Service"]["runMonkeyLoopy"]>[0],
    queued: IntegrationRun,
    alreadyRunning = false,
    prepare: Effect.Effect<void, IntegrationRequestError> = Effect.void,
  ) {
    yield* Effect.gen(function* () {
      activeMonkeyLoopyRuns.add(queued.id);
      yield* prepare;
      yield* executeMonkeyLoopyRun(input, queued, alreadyRunning).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : recoverMonkeyLoopyRunFailure(queued.id, cause).pipe(
                Effect.catchCause((recoveryCause) =>
                  Effect.logError("Could not persist Monkey D. Loopy background failure", {
                    runId: queued.id,
                    cause: Cause.pretty(recoveryCause),
                  }),
                ),
              ),
        ),
        Effect.ensuring(Effect.sync(() => activeMonkeyLoopyRuns.delete(queued.id))),
        Effect.interruptible,
        Effect.forkIn(serviceScope, { startImmediately: true }),
      );
    }).pipe(
      Effect.onError(() => Effect.sync(() => activeMonkeyLoopyRuns.delete(queued.id))),
      Effect.uninterruptible,
    );
  });

  const runMonkeyLoopyLocked = Effect.fn("IntegrationService.runMonkeyLoopyLocked")(function* (
    input: Parameters<IntegrationService["Service"]["runMonkeyLoopy"]>[0],
    id: string,
  ) {
    const createdAt = yield* now;
    yield* pruneExpiredRuns(createdAt);
    const resumeExistingRun = Effect.fn("IntegrationService.resumeExistingMonkeyLoopyRun")(
      function* (existing: IntegrationRun) {
        if (existing.projectId !== input.projectId) {
          return yield* requestError(
            "execution-failed",
            "The launch request id is already associated with another project.",
          );
        }
        if (
          (existing.state !== "queued" && existing.state !== "running") ||
          activeMonkeyLoopyRuns.has(id)
        ) {
          return { run: existing, created: false };
        }

        const reclaimedAt = yield* now;
        const reclaimed: IntegrationRun = {
          ...existing,
          state: "running",
          attempt: existing.attempt + 1,
          threadIds: [],
          outputSummary: null,
          failure: null,
          startedAt: reclaimedAt,
          completedAt: null,
          updatedAt: reclaimedAt,
        };
        const reclaim = transition(reclaimed, ["queued", "running"]).pipe(
          Effect.flatMap((didReclaim) =>
            didReclaim
              ? Effect.void
              : requestError(
                  "execution-failed",
                  "The stale integration run could not be reclaimed.",
                ),
          ),
        );
        yield* forkMonkeyLoopyRun(input, reclaimed, true, reclaim);
        return { run: reclaimed, created: false };
      },
    );
    const existing = yield* runs
      .get(id)
      .pipe(Effect.map(Option.getOrUndefined), Effect.mapError(asRequestError));
    if (existing) return yield* resumeExistingRun(existing);
    const validation = yield* monkeyLoopy.validate({ yaml: input.yaml });
    if (!validation.executionReady) {
      return yield* requestError(
        "validation-failed",
        "The LoopSpec must pass validation and verification before it can run.",
      );
    }
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
      verification: monkeyLoopyVerificationSummary(validation),
      timeline: [{ sequence: 0, state: "queued", occurredAt: createdAt, summary: "Run queued" }],
      createdAt,
      startedAt: null,
      completedAt: null,
      updatedAt: createdAt,
    };
    const created = yield* runs.insertIfAbsent(queued).pipe(Effect.mapError(asRequestError));
    if (!created) {
      const existing = yield* runs
        .get(id)
        .pipe(Effect.map(Option.getOrUndefined), Effect.mapError(asRequestError));
      if (!existing) {
        return yield* requestError(
          "execution-failed",
          "The existing integration run could not be recovered.",
        );
      }
      return yield* resumeExistingRun(existing);
    }
    yield* forkMonkeyLoopyRun(input, queued);
    return { run: queued, created: true };
  });

  const runMonkeyLoopy: IntegrationService["Service"]["runMonkeyLoopy"] = Effect.fn(
    "IntegrationService.runMonkeyLoopy",
  )(function* (input) {
    const id = `monkey-${input.requestId}`;
    return yield* monkeyLoopyLaunches.withPermit(id)(runMonkeyLoopyLocked(input, id));
  });

  const listRuns: IntegrationService["Service"]["listRuns"] = Effect.fn(
    "IntegrationService.listRuns",
  )(function* (input) {
    const readAt = yield* now;
    yield* pruneExpiredRuns(readAt);
    yield* reconcileOrphanedMonkeyLoopyRuns(readAt);
    const rows = yield* runs.list(input).pipe(Effect.mapError(asRequestError));
    const page = rows.slice(0, input.limit);
    const next = rows.length > input.limit ? page.at(-1) : undefined;
    return {
      runs: page,
      nextCursor: next === undefined ? null : { createdAt: next.createdAt, id: next.id },
    };
  });
  const getRun: IntegrationService["Service"]["getRun"] = Effect.fn("IntegrationService.getRun")(
    function* (input) {
      const readAt = yield* now;
      yield* pruneExpiredRuns(readAt);
      yield* reconcileOrphanedMonkeyLoopyRuns(readAt);
      return yield* runs
        .get(input.id)
        .pipe(Effect.map(Option.getOrNull), Effect.mapError(asRequestError));
    },
  );

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
