import {
  IntegrationRequestError,
  type IntegrationRun,
  type IntegrationRunRuntimeSnapshot,
  type LoopAnySettings,
  type MonkeyLoopyRunInput,
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
  INTERRUPTED_INTEGRATION_RUN_FAILURE,
  integrationRunRetentionCutoff,
  monkeyLoopyVerificationSummary,
  sanitizeIntegrationRunText,
} from "../integrationRun.ts";
import { LOOPANY_PROTOCOL_COMPATIBILITY } from "../loopanyCompatibility.ts";
import { MONKEY_D_LOOPY_FACTORY_VERSION } from "../monkeyLoopyVersions.ts";
import {
  decodeMonkeyLoopyRecoveryCapsule,
  encodeMonkeyLoopyRecoveryCapsule,
  isCurrentMonkeyLoopyRecoveryCapsule,
  makeMonkeyLoopyRecoveryCapsule,
  monkeyLoopyRecoverySecretName,
  pruneMonkeyLoopyRecoveryCapsules,
} from "../monkeyLoopyRecovery.ts";
import { IntegrationService } from "../Services/IntegrationService.ts";
import { LoopAnyConnector } from "../Services/LoopAnyConnector.ts";
import { MonkeyLoopyService } from "../Services/MonkeyLoopyService.ts";

export const LOOPANY_DEVICE_TOKEN_SECRET = "integration-loopany-device-token";
export const LOOPANY_PROTOCOL_VERSION = LOOPANY_PROTOCOL_COMPATIBILITY.version;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MONKEY_LOOPY_REGISTRATION_GRACE_PERIOD = "250 millis";

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
  const preRuntimeMonkeyLoopyCancellations = new Set<string>();
  const monkeyLoopyLaunches = yield* PartitionedSemaphore.make<string>({ permits: 1 });
  const serviceScope = yield* Effect.scope;
  const recoveryLocks = new Set<string>();

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
          capabilities: [
            "author",
            "recipes",
            "infer",
            "validate",
            "verify",
            "run",
            "resume",
            "retry",
            "inspect",
            "cancel",
            "mcp",
          ],
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
  const pruneExpiredRuns = Effect.fn("IntegrationService.pruneExpiredRuns")(function* (
    referenceTime: string,
  ) {
    const prunedRunIds = yield* runs
      .pruneCompletedBefore(integrationRunRetentionCutoff(referenceTime))
      .pipe(Effect.mapError(asRequestError));
    yield* pruneMonkeyLoopyRecoveryCapsules(secrets, prunedRunIds).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not prune private Monkey.D.Loopy recovery metadata", {
          message: cause.message,
        }),
      ),
    );
  });
  const validateMonkeyLoopyRunInput = Effect.fn("IntegrationService.validateMonkeyLoopyRunInput")(
    function* (input: Parameters<IntegrationService["Service"]["runMonkeyLoopy"]>[0]) {
      const validation = yield* monkeyLoopy.validate({ yaml: input.yaml });
      if (!validation.executionReady) {
        return yield* requestError(
          "validation-failed",
          "The LoopSpec must pass validation and verification before it can run.",
        );
      }
      return validation;
    },
  );

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
  const getRequiredRun = Effect.fn("IntegrationService.getRequiredRun")(function* (id: string) {
    const run = yield* runs
      .get(id)
      .pipe(Effect.map(Option.getOrUndefined), Effect.mapError(asRequestError));
    if (!run) return yield* requestError("run-not-found", `Integration run ${id} was not found.`);
    return run;
  });
  const releaseRecoveryLock = (runId: string) =>
    Effect.sync(() => {
      recoveryLocks.delete(runId);
    });
  const acquireRecoveryLock = Effect.fn("IntegrationService.acquireRecoveryLock")(function* (
    runId: string,
  ) {
    if (recoveryLocks.has(runId)) {
      return yield* requestError(
        "recovery-in-progress",
        "A recovery operation is already active for this Monkey.D.Loopy run.",
      );
    }
    recoveryLocks.add(runId);
  });
  const readRecoveryCapsule = Effect.fn("IntegrationService.readRecoveryCapsule")(function* (
    runId: string,
  ) {
    const stored = yield* secrets
      .get(monkeyLoopyRecoverySecretName(runId))
      .pipe(
        Effect.mapError(() =>
          requestError(
            "recovery-metadata-missing",
            "The private recovery metadata for this Monkey.D.Loopy run is unavailable.",
          ),
        ),
      );
    if (Option.isNone(stored)) {
      return yield* requestError(
        "recovery-metadata-missing",
        "The private recovery metadata for this Monkey.D.Loopy run is unavailable.",
      );
    }
    const capsule = yield* decodeMonkeyLoopyRecoveryCapsule(stored.value).pipe(
      Effect.mapError(() =>
        requestError(
          "recovery-metadata-missing",
          "The private recovery metadata for this Monkey.D.Loopy run is invalid.",
        ),
      ),
    );
    if (!isCurrentMonkeyLoopyRecoveryCapsule(capsule)) {
      return yield* requestError(
        "version-mismatch",
        "This run was created by an incompatible Monkey.D.Loopy execution version.",
      );
    }
    return capsule;
  });
  const persistRecoveryCapsule = Effect.fn("IntegrationService.persistRecoveryCapsule")(function* (
    runId: string,
    input: MonkeyLoopyRunInput,
  ) {
    const bytes = yield* encodeMonkeyLoopyRecoveryCapsule(
      makeMonkeyLoopyRecoveryCapsule(input),
    ).pipe(
      Effect.mapError(() =>
        requestError("execution-failed", "Could not encode private run recovery metadata."),
      ),
    );
    yield* secrets
      .set(monkeyLoopyRecoverySecretName(runId), bytes)
      .pipe(
        Effect.mapError(() =>
          requestError("execution-failed", "Could not persist private run recovery metadata."),
        ),
      );
  });
  const discardRecoveryCapsule = Effect.fn("IntegrationService.discardRecoveryCapsule")(function* (
    runId: string,
  ) {
    yield* secrets.remove(monkeyLoopyRecoverySecretName(runId)).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not discard unpublished Monkey.D.Loopy recovery metadata", {
          runId,
          message: cause.message,
        }),
      ),
    );
  });
  const publishRunWithRecoveryCapsule = Effect.fn(
    "IntegrationService.publishRunWithRecoveryCapsule",
  )(function* (run: IntegrationRun, input: MonkeyLoopyRunInput) {
    let publicationCompleted = false;
    return yield* Effect.gen(function* () {
      yield* persistRecoveryCapsule(run.id, input);
      const created = yield* runs.insertIfAbsent(run).pipe(Effect.mapError(asRequestError));
      publicationCompleted = true;
      return created;
    }).pipe(
      Effect.ensuring(
        Effect.suspend(() => (publicationCompleted ? Effect.void : discardRecoveryCapsule(run.id))),
      ),
      Effect.uninterruptible,
    );
  });

  const reconcileOrphanedMonkeyLoopyRun = Effect.fn(
    "IntegrationService.reconcileOrphanedMonkeyLoopyRun",
  )(function* (run: IntegrationRun, reconciledAt: string) {
    if (
      run.source !== "monkey-d-loopy" ||
      (run.state !== "queued" && run.state !== "running") ||
      activeMonkeyLoopyRuns.has(run.id)
    ) {
      return run;
    }
    const interrupted = buildInterruptedIntegrationRun(run, reconciledAt);
    return (yield* transition(interrupted, [run.state]))
      ? interrupted
      : yield* getRequiredRun(run.id);
  });

  const orphanSnapshot = (run: IntegrationRun): IntegrationRunRuntimeSnapshot => {
    const terminal = ["succeeded", "failed", "cancelled"].includes(run.state);
    const waiting = run.state === "waiting";
    const restartInterrupted =
      run.source === "monkey-d-loopy" &&
      run.state === "cancelled" &&
      run.failure === INTERRUPTED_INTEGRATION_RUN_FAILURE;
    return {
      live: false,
      phase: terminal ? "terminal" : waiting ? "waiting" : "orphaned",
      recoverable: waiting || restartInterrupted,
      progress: {
        agentCallsStarted: run.threadIds.length,
        agentCallsCompleted: run.threadIds.length,
        activeStep: null,
        activeThreadId: null,
        linkedThreadIds: run.threadIds,
      },
      caps: null,
      diagnostics: restartInterrupted
        ? ["Run was interrupted by a server restart and can be resumed from its verified journal."]
        : terminal
          ? ["Run is terminal; no live runtime is retained."]
          : waiting
            ? ["Run is durably waiting and has no active provider turn."]
            : ["The live runtime is unavailable after a server restart."],
    };
  };

  const startingSnapshot = (run: IntegrationRun): IntegrationRunRuntimeSnapshot => ({
    live: true,
    phase: run.state === "queued" ? "queued" : "starting",
    recoverable: false,
    progress: {
      agentCallsStarted: run.threadIds.length,
      agentCallsCompleted: 0,
      activeStep: null,
      activeThreadId: null,
      linkedThreadIds: run.threadIds,
    },
    caps: null,
    diagnostics: ["Run is active in this server process; the Loopy runtime is starting."],
  });

  const executeMonkeyLoopyRun = Effect.fn("IntegrationService.executeMonkeyLoopyRun")(function* (
    input: Parameters<IntegrationService["Service"]["runMonkeyLoopy"]>[0],
    queued: IntegrationRun,
    alreadyRunning = false,
    operation: "run" | "resume" = "run",
    approveCaps = false,
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
      const observer = {
        isCancellationRequested: () =>
          Effect.sync(() => preRuntimeMonkeyLoopyCancellations.has(queued.id)),
        onThreadCreated: Effect.fn("IntegrationService.persistMonkeyLoopyThread")(function* (
          threadId: IntegrationRun["threadIds"][number],
        ) {
          let current = activeRun;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            if (current.state !== "running" && current.state !== "cancelled") break;
            const updatedAt = yield* now;
            const withThread: IntegrationRun = {
              ...current,
              threadIds: [...new Set([...current.threadIds, threadId])].slice(0, 100),
              updatedAt,
            };
            if (yield* transition(withThread, [current.state])) {
              activeRun = withThread;
              return;
            }
            current = yield* getRequiredRun(queued.id);
          }
          return yield* requestError(
            "execution-failed",
            "Could not persist the active integration thread.",
          );
        }),
      };
      const result =
        operation === "resume"
          ? yield* monkeyLoopy.resume(input, queued.id, approveCaps, observer)
          : yield* monkeyLoopy.run(input, queued.id, observer);
      const completedAt = yield* now;
      const completed: IntegrationRun = {
        ...running,
        state: result.state,
        threadIds: [...new Set([...activeRun.threadIds, ...result.threadIds])].slice(0, 100),
        journalRef: `monkey-d-loopy/.loopy/runs/${queued.id}`,
        outputSummary: sanitizeIntegrationRunText(result.output, 16_384),
        failure: result.error === null ? null : sanitizeIntegrationRunText(result.error, 4_096),
        timeline: appendIntegrationRunTimeline(activeRun, result.state, completedAt),
        completedAt: result.state === "waiting" ? null : completedAt,
        updatedAt: completedAt,
      };
      if (!(yield* transition(completed, ["running"]))) {
        const current = yield* getRequiredRun(queued.id);
        if (current.state !== "cancelled" && current.state !== "failed") {
          return yield* requestError("execution-failed", "Could not complete the integration run.");
        }
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
    operation: "run" | "resume" = "run",
    approveCaps = false,
    cleanup: Effect.Effect<void> = Effect.void,
  ) {
    yield* Effect.gen(function* () {
      activeMonkeyLoopyRuns.add(queued.id);
      yield* prepare;
      yield* executeMonkeyLoopyRun(input, queued, alreadyRunning, operation, approveCaps).pipe(
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
        Effect.ensuring(monkeyLoopy.releaseRun(queued.id)),
        Effect.ensuring(Effect.sync(() => preRuntimeMonkeyLoopyCancellations.delete(queued.id))),
        Effect.ensuring(Effect.sync(() => activeMonkeyLoopyRuns.delete(queued.id))),
        Effect.ensuring(cleanup),
        Effect.interruptible,
        Effect.forkIn(serviceScope, { startImmediately: true }),
      );
    }).pipe(
      Effect.onError(() =>
        Effect.sync(() => {
          preRuntimeMonkeyLoopyCancellations.delete(queued.id);
          activeMonkeyLoopyRuns.delete(queued.id);
        }),
      ),
      Effect.onError(() => cleanup),
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

        let backgroundOwnsMarker = false;
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => activeMonkeyLoopyRuns.add(id)),
          () =>
            Effect.gen(function* () {
              const validation = yield* validateMonkeyLoopyRunInput(input);
              yield* persistRecoveryCapsule(id, input);
              const reclaimedAt = yield* now;
              const reclaimed: IntegrationRun = {
                ...existing,
                state: "running",
                attempt: existing.attempt + 1,
                threadIds: [],
                outputSummary: null,
                failure: null,
                verification: monkeyLoopyVerificationSummary(validation),
                timeline: appendIntegrationRunTimeline(existing, "running", reclaimedAt),
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
              yield* forkMonkeyLoopyRun(input, reclaimed, true, reclaim).pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    backgroundOwnsMarker = true;
                  }),
                ),
                Effect.uninterruptible,
              );
              return { run: reclaimed, created: false };
            }),
          () =>
            Effect.sync(() => {
              if (!backgroundOwnsMarker) activeMonkeyLoopyRuns.delete(id);
            }),
        );
      },
    );
    const existing = yield* runs
      .get(id)
      .pipe(Effect.map(Option.getOrUndefined), Effect.mapError(asRequestError));
    if (existing) return yield* resumeExistingRun(existing);
    const validation = yield* validateMonkeyLoopyRunInput(input);
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
    // Keep recovery metadata ahead of row publication without retaining it when publication fails.
    const created = yield* publishRunWithRecoveryCapsule(queued, input);
    if (!created) {
      const existing = yield* runs
        .get(id)
        .pipe(Effect.map(Option.getOrUndefined), Effect.mapError(asRequestError));
      if (!existing) {
        yield* discardRecoveryCapsule(id);
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

  const inspectRun: IntegrationService["Service"]["inspectRun"] = Effect.fn(
    "IntegrationService.inspectRun",
  )(function* (input) {
    const inspectedAt = yield* now;
    yield* pruneExpiredRuns(inspectedAt);
    let run = yield* getRequiredRun(input.id);
    const live = run.source === "monkey-d-loopy" ? yield* monkeyLoopy.inspectRun(run.id) : null;
    if (live === null) run = yield* reconcileOrphanedMonkeyLoopyRun(run, inspectedAt);
    const runtime =
      live ??
      (activeMonkeyLoopyRuns.has(run.id) && (run.state === "queued" || run.state === "running")
        ? startingSnapshot(run)
        : orphanSnapshot(run));
    return { run, runtime };
  });

  const cancelMonkeyLoopyRuntime = Effect.fn("IntegrationService.cancelMonkeyLoopyRuntime")(
    function* (runId: IntegrationRun["id"]) {
      const registered = yield* Effect.gen(function* () {
        while (true) {
          const live = yield* monkeyLoopy.cancelRun(runId);
          if (live !== null || !activeMonkeyLoopyRuns.has(runId)) return live;
          yield* Effect.sleep("10 millis");
        }
      }).pipe(Effect.timeoutOption(MONKEY_LOOPY_REGISTRATION_GRACE_PERIOD));
      if (Option.isSome(registered)) {
        return { live: registered.value, preRuntime: false };
      }

      if (!activeMonkeyLoopyRuns.has(runId)) return { live: null, preRuntime: false };
      preRuntimeMonkeyLoopyCancellations.add(runId);
      const live = yield* monkeyLoopy.cancelRun(runId);
      return {
        live,
        preRuntime: live === null && activeMonkeyLoopyRuns.has(runId),
      };
    },
  );

  const awaitSettledMonkeyLoopyRun = Effect.fn("IntegrationService.awaitSettledMonkeyLoopyRun")(
    function* (runId: IntegrationRun["id"]) {
      while (activeMonkeyLoopyRuns.has(runId)) {
        const current = yield* getRequiredRun(runId);
        if (["succeeded", "failed", "cancelled"].includes(current.state)) return current;
        yield* Effect.sleep("10 millis");
      }
      return yield* getRequiredRun(runId);
    },
  );

  const cancelRun: IntegrationService["Service"]["cancelRun"] = Effect.fn(
    "IntegrationService.cancelRun",
  )(function* (input) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = yield* getRequiredRun(input.id);
      if (["succeeded", "failed", "cancelled"].includes(current.state)) {
        return { run: current, outcome: "already-terminal" };
      }
      if (current.source !== "monkey-d-loopy") {
        return yield* requestError(
          "run-not-cancellable",
          "Only active Monkey.D.Loopy runs can be cancelled by this operation.",
        );
      }

      const cancellation = yield* cancelMonkeyLoopyRuntime(current.id).pipe(
        Effect.tapError(() =>
          Effect.gen(function* () {
            const latest = yield* getRequiredRun(current.id);
            if (["succeeded", "failed", "cancelled"].includes(latest.state)) return;
            const failedAt = yield* now;
            const withFailure = {
              ...latest,
              timeline: appendIntegrationRunTimeline(
                latest,
                latest.state,
                failedAt,
                "Cancellation request failed",
              ),
              updatedAt: failedAt,
            };
            yield* transition(withFailure, [latest.state]).pipe(Effect.ignore);
          }),
        ),
      );
      const live = cancellation.live;
      if (live?.phase === "terminal") {
        const settled = yield* awaitSettledMonkeyLoopyRun(current.id);
        if (["succeeded", "failed", "cancelled"].includes(settled.state)) {
          return { run: settled, outcome: "already-terminal" };
        }
        continue;
      }
      const latest = yield* getRequiredRun(current.id);
      if (["succeeded", "failed", "cancelled"].includes(latest.state)) {
        return { run: latest, outcome: "already-terminal" };
      }
      const requestedAt = yield* now;
      if (
        live === null &&
        !cancellation.preRuntime &&
        (latest.state === "queued" || latest.state === "running") &&
        !activeMonkeyLoopyRuns.has(latest.id)
      ) {
        const reconciled = yield* reconcileOrphanedMonkeyLoopyRun(latest, requestedAt);
        if (reconciled.state === "cancelled") {
          return { run: reconciled, outcome: "cancelled" };
        }
        if (reconciled.state === "succeeded" || reconciled.state === "failed") {
          return { run: reconciled, outcome: "already-terminal" };
        }
        continue;
      }
      const requested = {
        ...latest,
        timeline: appendIntegrationRunTimeline(
          latest,
          latest.state,
          requestedAt,
          "Cancellation requested",
        ),
        updatedAt: requestedAt,
      };
      const completed: IntegrationRun = {
        ...requested,
        state: "cancelled",
        failure: latest.failure,
        timeline: appendIntegrationRunTimeline(
          requested,
          "cancelled",
          requestedAt,
          "Run cancelled",
        ),
        completedAt: requestedAt,
        updatedAt: requestedAt,
      };
      if (yield* transition(completed, [latest.state])) {
        return { run: completed, outcome: "cancelled" };
      }
    }
    return yield* requestError("execution-failed", "Could not persist run cancellation.");
  });

  const resumeRunWithCleanup = Effect.fn("IntegrationService.resumeRunWithCleanup")(function* (
    input: Parameters<IntegrationService["Service"]["resumeRun"]>[0],
    cleanup: Effect.Effect<void> = Effect.void,
    onHandoff: () => void = () => {},
  ) {
    let handedOff = false;
    let activeMarkerInstalled = false;
    return yield* Effect.gen(function* () {
      yield* Effect.acquireRelease(acquireRecoveryLock(input.id), () =>
        Effect.suspend(() =>
          handedOff
            ? Effect.void
            : Effect.all(
                [
                  releaseRecoveryLock(input.id),
                  Effect.sync(() => {
                    if (activeMarkerInstalled) activeMonkeyLoopyRuns.delete(input.id);
                  }),
                ],
                { discard: true },
              ),
        ),
      );
      const reconciliationAt = yield* now;
      yield* pruneExpiredRuns(reconciliationAt);
      let current = yield* getRequiredRun(input.id);
      current = yield* reconcileOrphanedMonkeyLoopyRun(current, reconciliationAt);
      if (current.source !== "monkey-d-loopy") {
        return yield* requestError(
          "run-not-recoverable",
          "Only Monkey.D.Loopy runs can be resumed by this operation.",
        );
      }
      const restartInterrupted =
        current.state === "cancelled" && current.failure === INTERRUPTED_INTEGRATION_RUN_FAILURE;
      if (current.state !== "waiting" && !restartInterrupted) {
        return yield* requestError(
          "run-not-recoverable",
          "Only waiting or restart-interrupted Monkey.D.Loopy runs can be resumed.",
        );
      }
      const capsule = yield* readRecoveryCapsule(current.id);
      yield* monkeyLoopy.verifyJournal(capsule.input, current.id, false);
      const resumedAt = yield* now;
      const requested: IntegrationRun = {
        ...current,
        timeline: appendIntegrationRunTimeline(
          current,
          current.state,
          resumedAt,
          "Resume requested",
        ),
        updatedAt: resumedAt,
      };
      const running: IntegrationRun = {
        ...requested,
        state: "running",
        failure: null,
        timeline: appendIntegrationRunTimeline(requested, "running", resumedAt, "Run resumed"),
        startedAt: current.startedAt ?? resumedAt,
        completedAt: null,
        updatedAt: resumedAt,
      };
      if (activeMonkeyLoopyRuns.has(current.id)) {
        return yield* requestError(
          "recovery-in-progress",
          "This Monkey.D.Loopy run already has an active runtime.",
        );
      }
      yield* Effect.sync(() => {
        activeMonkeyLoopyRuns.add(current.id);
        activeMarkerInstalled = true;
      });
      const recovered = yield* runs
        .recoverMonkeyLoopy(running, { state: current.state, failure: current.failure })
        .pipe(Effect.mapError(asRequestError));
      if (!recovered) {
        return yield* requestError(
          "recovery-in-progress",
          "The run changed while recovery was being prepared.",
        );
      }
      yield* forkMonkeyLoopyRun(
        capsule.input,
        running,
        true,
        Effect.void,
        "resume",
        input.approveCaps,
        Effect.all([releaseRecoveryLock(current.id), cleanup], { discard: true }),
      ).pipe(
        Effect.andThen(
          Effect.sync(() => {
            handedOff = true;
            onHandoff();
          }),
        ),
        Effect.uninterruptible,
      );
      return { run: running, operation: "resume", created: false } as const;
    }).pipe(Effect.scoped);
  });

  const resumeRun: IntegrationService["Service"]["resumeRun"] = Effect.fn(
    "IntegrationService.resumeRun",
  )(function* (input) {
    return yield* resumeRunWithCleanup(input);
  });

  const retryRun: IntegrationService["Service"]["retryRun"] = Effect.fn(
    "IntegrationService.retryRun",
  )(function* (input) {
    let handedOff = false;
    let activeChildMarker: string | null = null;
    return yield* Effect.gen(function* () {
      yield* Effect.acquireRelease(acquireRecoveryLock(input.id), () =>
        Effect.suspend(() =>
          handedOff
            ? Effect.void
            : Effect.all(
                [
                  releaseRecoveryLock(input.id),
                  Effect.sync(() => {
                    if (activeChildMarker !== null) {
                      activeMonkeyLoopyRuns.delete(activeChildMarker);
                    }
                  }),
                ],
                { discard: true },
              ),
        ),
      );
      const pruneAt = yield* now;
      yield* pruneExpiredRuns(pruneAt);
      let source = yield* getRequiredRun(input.id);
      source = yield* reconcileOrphanedMonkeyLoopyRun(source, pruneAt);
      if (
        source.source !== "monkey-d-loopy" ||
        (source.state !== "failed" && source.state !== "cancelled")
      ) {
        return yield* requestError(
          "run-not-recoverable",
          "Only failed or cancelled Monkey.D.Loopy runs can be retried.",
        );
      }
      const capsule = yield* readRecoveryCapsule(source.id);
      yield* monkeyLoopy.verifyJournal(capsule.input, source.id, true, source.journalRef === null);
      const retryInput: MonkeyLoopyRunInput = {
        ...capsule.input,
        requestId: input.requestId,
      };
      const id = `monkey-${input.requestId}`;
      if (id === source.id) {
        return yield* requestError(
          "invalid-config",
          "A retry request ID must create a new run ID.",
        );
      }
      const recoverExistingRetry = Effect.fn("IntegrationService.recoverExistingRetry")(function* (
        existing: IntegrationRun,
      ) {
        if (existing.parentRunId !== source.id || existing.attempt !== source.attempt + 1) {
          return yield* requestError(
            "invalid-config",
            "This retry request ID is already associated with another run.",
          );
        }
        const current =
          existing.state === "running" && !activeMonkeyLoopyRuns.has(existing.id)
            ? yield* reconcileOrphanedMonkeyLoopyRun(existing, yield* now)
            : existing;
        if (
          current.state === "cancelled" &&
          current.failure === INTERRUPTED_INTEGRATION_RUN_FAILURE
        ) {
          const resumed = yield* resumeRunWithCleanup(
            { id: current.id, approveCaps: false },
            releaseRecoveryLock(source.id),
            () => {
              handedOff = true;
            },
          );
          return { run: resumed.run, operation: "retry", created: false } as const;
        }
        if (current.state !== "queued" || activeMonkeyLoopyRuns.has(current.id)) {
          return { run: current, operation: "retry", created: false } as const;
        }

        let backgroundOwnsMarker = false;
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => activeMonkeyLoopyRuns.add(current.id)),
          () =>
            Effect.gen(function* () {
              const validation = yield* validateMonkeyLoopyRunInput(retryInput);
              yield* persistRecoveryCapsule(current.id, retryInput);
              const reclaimedAt = yield* now;
              const reclaimed: IntegrationRun = {
                ...current,
                state: "running",
                threadIds: [],
                outputSummary: null,
                failure: null,
                verification: monkeyLoopyVerificationSummary(validation),
                timeline: appendIntegrationRunTimeline(
                  current,
                  "running",
                  reclaimedAt,
                  "Orphaned retry reclaimed",
                ),
                startedAt: reclaimedAt,
                completedAt: null,
                updatedAt: reclaimedAt,
              };
              const reclaim = transition(reclaimed, ["queued"]).pipe(
                Effect.flatMap((didReclaim) =>
                  didReclaim
                    ? Effect.void
                    : requestError(
                        "recovery-in-progress",
                        "The retry attempt changed while recovery was being prepared.",
                      ),
                ),
              );
              yield* forkMonkeyLoopyRun(
                retryInput,
                reclaimed,
                true,
                reclaim,
                "run",
                false,
                releaseRecoveryLock(source.id),
              ).pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    handedOff = true;
                    backgroundOwnsMarker = true;
                  }),
                ),
                Effect.uninterruptible,
              );
              return { run: reclaimed, operation: "retry", created: false } as const;
            }),
          () =>
            Effect.sync(() => {
              if (!backgroundOwnsMarker) activeMonkeyLoopyRuns.delete(current.id);
            }),
        );
      });
      return yield* monkeyLoopyLaunches.withPermit(id)(
        Effect.gen(function* () {
          const existing = yield* runs
            .get(id)
            .pipe(Effect.map(Option.getOrUndefined), Effect.mapError(asRequestError));
          if (existing) {
            return yield* recoverExistingRetry(existing);
          }

          const validation = yield* validateMonkeyLoopyRunInput(retryInput);
          const createdAt = yield* now;
          const queued: IntegrationRun = {
            id,
            source: "monkey-d-loopy",
            state: "queued",
            projectId: retryInput.projectId,
            parentRunId: source.id,
            attempt: source.attempt + 1,
            threadIds: [],
            journalRef: null,
            outputSummary: null,
            failure: null,
            verification: monkeyLoopyVerificationSummary(validation),
            timeline: [
              {
                sequence: 0,
                state: "queued",
                occurredAt: createdAt,
                summary: `Retry queued from ${source.id}`,
              },
            ],
            createdAt,
            startedAt: null,
            completedAt: null,
            updatedAt: createdAt,
          };
          const created = yield* Effect.gen(function* () {
            if (activeMonkeyLoopyRuns.has(id)) {
              return yield* requestError(
                "recovery-in-progress",
                "This Monkey.D.Loopy retry already has an active runtime.",
              );
            }
            yield* Effect.sync(() => {
              activeMonkeyLoopyRuns.add(id);
              activeChildMarker = id;
            });
            const inserted = yield* publishRunWithRecoveryCapsule(queued, retryInput);
            if (!inserted) {
              yield* Effect.sync(() => {
                activeMonkeyLoopyRuns.delete(id);
                activeChildMarker = null;
              });
              return false;
            }
            yield* forkMonkeyLoopyRun(
              retryInput,
              queued,
              false,
              Effect.void,
              "run",
              false,
              releaseRecoveryLock(source.id),
            );
            handedOff = true;
            return true;
          }).pipe(Effect.uninterruptible);
          if (!created) {
            const raced = yield* runs
              .get(id)
              .pipe(Effect.map(Option.getOrUndefined), Effect.mapError(asRequestError));
            if (!raced) {
              yield* discardRecoveryCapsule(id);
              return yield* requestError(
                "execution-failed",
                "The existing retry run could not be recovered.",
              );
            }
            return yield* recoverExistingRetry(raced);
          }
          return { run: queued, operation: "retry", created: true } as const;
        }),
      );
    }).pipe(Effect.scoped);
  });

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
    inspectRun,
    cancelRun,
    resumeRun,
    retryRun,
  });
});

export const IntegrationServiceLive = Layer.effect(IntegrationService, makeIntegrationService);
