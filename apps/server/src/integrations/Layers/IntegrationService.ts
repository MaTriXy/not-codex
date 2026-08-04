import {
  IntegrationRequestError,
  type IntegrationRun,
  type IntegrationRunRuntimeSnapshot,
  type LoopAnySettings,
  type MonkeyLoopyRunInput,
  type OpenKrittFinding,
  type OpenKrittLaunchScanInput,
  type OpenKrittRemediationLaunchInput,
  type ProjectId,
} from "@notcodex/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PartitionedSemaphore from "effect/PartitionedSemaphore";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { AgentHarnessRunner } from "../../orchestration/Services/AgentHarnessRunner.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { RepositoryIdentityResolver } from "../../project/RepositoryIdentityResolver.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
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
import { integrationRunOperations } from "../integrationRunOperations.ts";
import { normalizeLoopAnyServerUrl } from "../loopAnyUrl.ts";
import { normalizeOpenKrittServerUrl } from "../openKrittUrl.ts";
import { openKrittRequestIdReuseRefusal } from "../openKrittCompatibility.ts";
import { IntegrationService } from "../Services/IntegrationService.ts";
import { LoopAnyConnector } from "../Services/LoopAnyConnector.ts";
import { MonkeyLoopyService } from "../Services/MonkeyLoopyService.ts";
import { OpenKrittConnector } from "../Services/OpenKrittConnector.ts";
import {
  OpenKrittScanRepository,
  type OpenKrittPersistedFinding,
  type OpenKrittPersistenceError,
} from "../Services/OpenKrittScanRepository.ts";
import { OpenKrittSnapshotService } from "../Layers/OpenKrittSnapshotService.ts";
import { buildRemediationPrompt } from "../openKrittEvidence.ts";
import { toOpenKrittFindingContract } from "../openKrittFindings.ts";
import { compareFindingSets } from "../openKrittFingerprint.ts";
import {
  comparisonEntry,
  priorScanConfiguration,
  sameOpenKrittConfiguration,
} from "../openKrittComparison.ts";
import { OPEN_KRITT_BEARER_TOKEN_SECRET_NAME } from "../openKrittSecret.ts";
import { buildOpenKrittRemoteSource, validateOpenKrittRemoteIdentity } from "../openKrittSource.ts";
import {
  buildOpenKrittRemediationLaunch,
  buildOpenKrittRescanLaunch,
} from "../openKrittRemediation.ts";
import { launchResolutionForTimeout } from "../Layers/OpenKrittConnector.ts";

export const LOOPANY_DEVICE_TOKEN_SECRET = "integration-loopany-device-token";
export const LOOPANY_PROTOCOL_VERSION = LOOPANY_PROTOCOL_COMPATIBILITY.version;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MONKEY_LOOPY_REGISTRATION_GRACE_PERIOD = "250 millis";
const OPEN_KRITT_EXTERNAL_SCAN_PREFIX = "external-scan:";

/**
 * Legacy fallback only. `open_kritt_scan_correlations` is authoritative for the
 * external scan id; this reads runs persisted before that table existed, and is
 * also the only path available when the server runs without SQL persistence.
 */
function legacyExternalScanId(outputSummary: string | null): string | null {
  const summary = outputSummary ?? "";
  if (!summary.startsWith(OPEN_KRITT_EXTERNAL_SCAN_PREFIX)) return null;
  const value =
    summary.slice(OPEN_KRITT_EXTERNAL_SCAN_PREFIX.length).split("\n", 1)[0]?.trim() ?? "";
  return /^[A-Za-z0-9_.:-]{1,256}$/.test(value) ? value : null;
}

function requestError(
  code: IntegrationRequestError["code"],
  message: string,
  cause?: unknown,
): IntegrationRequestError {
  return new IntegrationRequestError({ code, message, ...(cause === undefined ? {} : { cause }) });
}

function validateLoopAnySettings(settings: LoopAnySettings): void {
  if (settings.serverUrl.length > 0) normalizeLoopAnyServerUrl(settings.serverUrl);
  if (settings.enabled && settings.serverUrl.length === 0) {
    throw new Error("A LoopAny server URL is required before enabling the connector.");
  }
  if (settings.enabled && settings.allowedRoots.length === 0) {
    throw new Error("At least one allowed project root is required before enabling LoopAny.");
  }
}

function normalizeLoopAnySettingsUpdate(
  current: LoopAnySettings,
  patch: Partial<LoopAnySettings>,
): LoopAnySettings {
  const merged: LoopAnySettings = { ...current, ...patch };
  const serverUrl = (() => {
    if (patch.serverUrl !== undefined) return normalizeLoopAnyServerUrl(patch.serverUrl);
    if (merged.enabled || merged.serverUrl.length === 0) return merged.serverUrl;
    try {
      return normalizeLoopAnyServerUrl(merged.serverUrl);
    } catch {
      return "";
    }
  })();
  const next: LoopAnySettings = { ...merged, serverUrl };
  validateLoopAnySettings(next);
  return next;
}

function persistedFindingToContract(input: OpenKrittPersistedFinding): OpenKrittFinding {
  return toOpenKrittFindingContract({
    id: input.id,
    scanId: input.scanId,
    canonical: input.canonical,
    duplicateOf: input.duplicateOf,
    severity: input.severity,
    rank: input.rank,
    type: input.type,
    summary: input.summary,
    explanation: input.explanation,
    path: input.path,
    line: input.line,
    column: input.column,
    triggerFlow: input.triggerFlow,
    maliciousInput: input.maliciousInput,
    exploitability: input.exploitability,
    maliciousActor: input.maliciousActor,
    rootBug: input.rootBug,
    triage: input.triage,
    sourceCommitSha: input.sourceCommitSha ?? "unknown",
    snapshotId: input.snapshotId,
    cwe: input.cwe,
    cvss: input.cvss,
  });
}

function enrichFindingSource(
  finding: OpenKrittFinding,
  correlation: {
    readonly source: {
      readonly repoKind: "remote" | "local";
      readonly repoFull: string;
      readonly commitSha: string | null;
    };
  } | null,
): OpenKrittFinding {
  if (correlation === null) return finding;
  return {
    ...finding,
    source: {
      commitSha: finding.source.commitSha ?? correlation.source.commitSha,
      snapshotId:
        finding.source.snapshotId ??
        (correlation.source.repoKind === "local" ? correlation.source.repoFull : null),
    },
  };
}

function findingPersistenceInput(finding: OpenKrittFinding) {
  return {
    id: finding.id,
    scanId: finding.scanId,
    canonical: finding.canonical,
    duplicateOf: finding.duplicateOf,
    severity: finding.severity,
    rank: finding.rank,
    type: finding.type,
    summary: finding.summary,
    explanation: finding.explanation,
    path: finding.location.path,
    line: finding.location.line,
    column: finding.location.column,
    triggerFlow: finding.triggerFlow,
    maliciousInput: finding.maliciousInput,
    exploitability: finding.exploitability,
    maliciousActor: finding.maliciousActor,
    rootBug: finding.rootBug,
    triage: finding.triage,
    sourceCommitSha: finding.source.commitSha,
    snapshotId: finding.source.snapshotId,
    cwe: finding.cwe ?? null,
    cvss: finding.cvss ?? null,
  };
}

export const makeIntegrationService = Effect.gen(function* () {
  const settings = yield* ServerSettingsService;
  const secrets = yield* ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;
  const monkeyLoopy = yield* MonkeyLoopyService;
  const openKrittConnector = Option.getOrElse(yield* Effect.serviceOption(OpenKrittConnector), () =>
    OpenKrittConnector.of({
      diagnostics: Effect.succeed({
        health: "disabled",
        lastSuccessfulContact: null,
        nextRetryAt: null,
        compatibilityVersion: "open-kritt-v1.2.0",
        serverVersion: null,
        lastError: null,
        recentEvents: [],
      }),
      configure: () =>
        Effect.fail(requestError("not-configured", "Open Kritt is unavailable in this runtime.")),
      testConnection: Effect.fail(
        requestError("not-configured", "Open Kritt is unavailable in this runtime."),
      ),
      refreshCatalog: Effect.fail(
        requestError("not-configured", "Open Kritt is unavailable in this runtime."),
      ),
      launchScan: () =>
        Effect.fail(requestError("not-configured", "Open Kritt is unavailable in this runtime.")),
      inspectScan: () =>
        Effect.fail(requestError("not-configured", "Open Kritt is unavailable in this runtime.")),
      reconcileLaunch: () =>
        Effect.fail(requestError("not-configured", "Open Kritt is unavailable in this runtime.")),
      controlScan: () =>
        Effect.fail(requestError("not-configured", "Open Kritt is unavailable in this runtime.")),
      listFindings: () =>
        Effect.fail(requestError("not-configured", "Open Kritt is unavailable in this runtime.")),
      getFinding: () =>
        Effect.fail(requestError("not-configured", "Open Kritt is unavailable in this runtime.")),
    }),
  );
  const harness = Option.getOrElse(yield* Effect.serviceOption(AgentHarnessRunner), () =>
    AgentHarnessRunner.of({
      createThread: () => Effect.die("Agent harness is unavailable in this runtime."),
      startTurn: () => Effect.die("Agent harness is unavailable in this runtime."),
      interrupt: () => Effect.die("Agent harness is unavailable in this runtime."),
      awaitTurn: () => Effect.die("Agent harness is unavailable in this runtime."),
      run: () => Effect.die("Agent harness is unavailable in this runtime."),
    }),
  );
  const loopAnyConnector = yield* LoopAnyConnector;
  const runs = yield* IntegrationRunRepository;
  const openKrittScans = yield* OpenKrittScanRepository;
  const sqlClient = yield* Effect.serviceOption(SqlClient.SqlClient);
  const withOpenKrittPersistence = <A>(
    effect: Effect.Effect<A, OpenKrittPersistenceError, SqlClient.SqlClient>,
    fallback: A,
  ) =>
    Option.match(sqlClient, {
      onNone: () => Effect.succeed(fallback),
      onSome: (sql) =>
        effect.pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.mapError((cause) =>
            requestError("execution-failed", "Open Kritt launch persistence failed.", cause),
          ),
        ),
    });
  const persistOpenKritt = <A>(
    effect: Effect.Effect<A, OpenKrittPersistenceError, SqlClient.SqlClient>,
  ): Effect.Effect<A | undefined, IntegrationRequestError> =>
    Option.match(sqlClient, {
      // `Effect.void` cannot stand in here: the success type is `A | undefined`,
      // and `void` is not assignable to it.
      // @effect-diagnostics-next-line effectSucceedWithVoid:off
      onNone: () => Effect.succeed<A | undefined>(undefined),
      onSome: (sql) =>
        effect.pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.mapError((cause) =>
            requestError("execution-failed", "Open Kritt persistence failed.", cause),
          ),
        ),
    });
  const serverEnvironment = Option.getOrElse(
    yield* Effect.serviceOption(ServerEnvironment),
    () => ({ getEnvironmentId: Effect.succeed("server") }),
  );
  const projectionSnapshotQuery = yield* Effect.serviceOption(ProjectionSnapshotQuery);
  const repositoryIdentityResolver = yield* Effect.serviceOption(RepositoryIdentityResolver);
  const gitVcsDriver = yield* Effect.serviceOption(GitVcsDriver);
  const gitWorkflow = yield* Effect.serviceOption(GitWorkflowService);
  const snapshotService = yield* Effect.serviceOption(OpenKrittSnapshotService);
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
    const openKritt = current.integrations.openKritt;
    const liveOpenKrittDiagnostics = yield* openKrittConnector.diagnostics;
    const persistedOpenKrittDiagnostics = yield* withOpenKrittPersistence(
      openKrittScans.getDiagnostics(),
      null,
    );
    const openKrittDiagnostics =
      liveOpenKrittDiagnostics.health === "disabled" && persistedOpenKrittDiagnostics !== null
        ? persistedOpenKrittDiagnostics
        : liveOpenKrittDiagnostics;
    const openKrittTokenConfigured = Option.isSome(
      yield* secrets
        .get(OPEN_KRITT_BEARER_TOKEN_SECRET_NAME)
        .pipe(Effect.mapError((cause) => requestError("invalid-config", cause.message, cause))),
    );
    const missingConfiguration =
      !tokenConfigured || loopAny.serverUrl.length === 0 || loopAny.allowedRoots.length === 0;
    const visibleConnectorStatus = !loopAny.enabled
      ? {
          ...connectorStatus,
          health: "disabled" as const,
          nextRetryAt: null,
          inFlight: 0,
          lastError: null,
        }
      : missingConfiguration
        ? {
            ...connectorStatus,
            health: "misconfigured" as const,
            nextRetryAt: null,
            inFlight: 0,
            lastError: {
              code: "connector-misconfigured" as const,
              message: "LoopAny connector configuration is incomplete.",
              occurredAt: connectorStatus.updatedAt,
            },
          }
        : connectorStatus;
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
          diagnostics: null,
        },
        {
          id: "loopany",
          name: "LoopAny",
          description: "Optional external scheduling and delivery for the local Not Codex harness.",
          version: LOOPANY_PROTOCOL_VERSION,
          state: !loopAny.enabled
            ? "disabled"
            : tokenConfigured && loopAny.serverUrl.length > 0 && loopAny.allowedRoots.length > 0
              ? visibleConnectorStatus.health === "healthy"
                ? "ready"
                : visibleConnectorStatus.health === "connecting"
                  ? "connecting"
                  : "error"
              : "error",
          capabilities: ["schedule", "deliver", "report"],
          tokenConfigured,
          lastActivityAt:
            visibleConnectorStatus.lastSuccessAt === null
              ? null
              : DateTime.makeUnsafe(visibleConnectorStatus.lastSuccessAt),
          error:
            loopAny.enabled && (!tokenConfigured || loopAny.serverUrl.length === 0)
              ? "LoopAny is enabled but its URL or device token is missing."
              : loopAny.enabled && loopAny.allowedRoots.length === 0
                ? "LoopAny is enabled but no allowed project roots are configured."
                : (visibleConnectorStatus.lastError?.message ?? null),
          diagnostics: visibleConnectorStatus,
        },
        {
          id: "open-kritt",
          name: "Open Kritt",
          description:
            "Optional server-only security scanning through a separately installed Open Kritt service.",
          version: "open-kritt-v1.2.0",
          state: !openKritt.enabled
            ? "disabled"
            : openKritt.serverUrl.length === 0
              ? "error"
              : openKrittDiagnostics.health === "healthy"
                ? "ready"
                : openKrittDiagnostics.health === "connecting"
                  ? "connecting"
                  : "error",
          capabilities: ["scan", "findings", "rescan"],
          tokenConfigured: openKrittTokenConfigured,
          lastActivityAt:
            openKrittDiagnostics.lastSuccessfulContact === null
              ? null
              : DateTime.makeUnsafe(openKrittDiagnostics.lastSuccessfulContact),
          error:
            openKritt.enabled && openKritt.serverUrl.length === 0
              ? "Open Kritt is enabled but its server URL is missing."
              : openKrittDiagnostics.health === "unauthorized"
                ? "Open Kritt rejected the configured authentication."
                : null,
          diagnostics: openKrittDiagnostics,
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
      try: () => normalizeLoopAnySettingsUpdate(current.integrations.loopAny, input.settings),
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
    const serverUrl = yield* Effect.try({
      try: () => normalizeLoopAnyServerUrl(current.integrations.loopAny.serverUrl),
      catch: (cause) =>
        requestError(
          "invalid-config",
          "The persisted LoopAny server URL is unsafe. Save a valid HTTPS or loopback URL.",
          cause,
        ),
    });
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

  const configureOpenKritt = openKrittConnector.configure;
  const testOpenKritt: IntegrationService["Service"]["testOpenKritt"] = Effect.gen(function* () {
    const result = yield* openKrittConnector.testConnection;
    yield* withOpenKrittPersistence(openKrittScans.saveDiagnostics(result.diagnostics), undefined);
    return result;
  });
  const refreshOpenKrittCatalog = openKrittConnector.refreshCatalog;

  const makeOpenKrittRun = (
    input: OpenKrittLaunchScanInput,
    runId: string,
    createdAt: string,
    parentRunId: string | null = null,
  ): IntegrationRun => ({
    id: runId,
    source: "open-kritt",
    state: "queued",
    projectId: input.projectId,
    parentRunId,
    attempt: 1,
    threadIds: [],
    journalRef: null,
    outputSummary: null,
    failure: null,
    verification: null,
    timeline: [
      {
        sequence: 0,
        state: "queued",
        occurredAt: createdAt,
        summary: "Open Kritt launch intent persisted.",
      },
    ],
    createdAt,
    startedAt: null,
    completedAt: null,
    updatedAt: createdAt,
  });

  /**
   * Resolves the project's current canonical `owner/repository` identity, or
   * `null` when this layer has no orchestration projection (unit layers) or the
   * project has no canonical GitHub remote. Remediation uses this to prove the
   * project still maps to the scanned repository.
   */
  const resolveProjectRepoFull = Effect.fn("IntegrationService.resolveProjectRepoFull")(function* (
    projectId: ProjectId,
  ): Effect.fn.Return<string | null, IntegrationRequestError> {
    if (Option.isNone(projectionSnapshotQuery)) return null;
    const project = yield* projectionSnapshotQuery.value
      .getProjectShellById(projectId)
      .pipe(
        Effect.mapError(() =>
          requestError("validation-failed", "The selected project is unavailable."),
        ),
      );
    if (Option.isNone(project)) return null;
    const identity = project.value.repositoryIdentity;
    if (identity?.owner && identity.name) return `${identity.owner}/${identity.name}`;
    let remoteUrl = identity?.locator.remoteUrl ?? null;
    if (remoteUrl === null && Option.isSome(repositoryIdentityResolver)) {
      const resolved = yield* repositoryIdentityResolver.value
        .resolve(project.value.workspaceRoot)
        .pipe(Effect.orElseSucceed(() => null));
      remoteUrl = resolved?.locator.remoteUrl ?? null;
    }
    if (remoteUrl === null) return null;
    const canonicalRemoteUrl = remoteUrl;
    return yield* Effect.try({
      try: () => validateOpenKrittRemoteIdentity(canonicalRemoteUrl).repoFull,
      catch: () => "unresolved-remote-identity" as const,
    }).pipe(Effect.orElseSucceed(() => null));
  });

  const verifyOpenKrittLaunchSource = Effect.fn("IntegrationService.verifyOpenKrittLaunchSource")(
    function* (
      input: OpenKrittLaunchScanInput,
    ): Effect.fn.Return<OpenKrittLaunchScanInput, IntegrationRequestError> {
      // Unit layers intentionally omit the orchestration projection. The live
      // server always provides it, and that is the boundary at which a client
      // supplied project id becomes a server-authoritative workspace.
      if (Option.isNone(projectionSnapshotQuery)) return input;
      const project = yield* projectionSnapshotQuery.value
        .getProjectShellById(input.projectId)
        .pipe(
          Effect.mapError(() =>
            requestError("validation-failed", "The selected project is unavailable."),
          ),
        );
      if (Option.isNone(project)) {
        return yield* requestError(
          "validation-failed",
          "The selected project is unavailable or deleted.",
        );
      }
      if (input.source.kind === "local") {
        if (!/^[A-Za-z0-9_-]{1,160}$/.test(input.source.snapshotId)) {
          return yield* requestError(
            "validation-failed",
            "The local snapshot identity is invalid.",
          );
        }
        if (Option.isSome(sqlClient)) {
          const snapshot = yield* withOpenKrittPersistence(
            openKrittScans.findSnapshot(input.source.snapshotId),
            null,
          );
          if (
            snapshot === null ||
            snapshot.projectId !== input.projectId ||
            snapshot.terminalAt !== null
          ) {
            return yield* requestError(
              "validation-failed",
              "The local snapshot is unavailable or belongs to another project.",
            );
          }
        }
        return input;
      }
      const remoteSource = input.source;

      let remoteUrl = project.value.repositoryIdentity?.locator.remoteUrl ?? null;
      if (remoteUrl === null && Option.isSome(repositoryIdentityResolver)) {
        const resolved = yield* repositoryIdentityResolver.value
          .resolve(project.value.workspaceRoot)
          .pipe(
            Effect.mapError(() =>
              requestError("validation-failed", "The project repository could not be resolved."),
            ),
          );
        remoteUrl = resolved?.locator.remoteUrl ?? null;
      }
      if (remoteUrl === null) {
        return yield* requestError(
          "validation-failed",
          "The selected project has no canonical GitHub remote.",
        );
      }
      const canonicalRemoteUrl = remoteUrl;
      const expectedRepoFull =
        project.value.repositoryIdentity?.owner && project.value.repositoryIdentity.name
          ? `${project.value.repositoryIdentity.owner}/${project.value.repositoryIdentity.name}`
          : undefined;
      const normalizedSource = yield* Effect.try({
        try: () =>
          buildOpenKrittRemoteSource({
            remoteUrl: canonicalRemoteUrl,
            commitSha: remoteSource.commitSha,
            ...(expectedRepoFull === undefined ? {} : { expectedRepoFull }),
          }),
        catch: () =>
          requestError(
            "validation-failed",
            "The selected repository or commit is not a valid immutable Open Kritt source.",
          ),
      });
      if (normalizedSource.repoFull !== remoteSource.repoFull) {
        return yield* requestError(
          "validation-failed",
          "The selected repository does not match the project repository.",
        );
      }
      if (Option.isNone(gitVcsDriver)) {
        return yield* requestError(
          "validation-failed",
          "Git commit verification is unavailable on this server.",
        );
      }
      const verified = yield* gitVcsDriver.value
        .execute({
          operation: "open-kritt.verify-commit",
          cwd: project.value.workspaceRoot,
          args: ["rev-parse", "--verify", "--quiet", `${normalizedSource.commitSha}^{commit}`],
          allowNonZeroExit: true,
          timeoutMs: 15_000,
          maxOutputBytes: 256,
        })
        .pipe(
          Effect.mapError(() =>
            requestError(
              "validation-failed",
              "The selected commit could not be verified in the project repository.",
            ),
          ),
        );
      const resolvedSha = verified.stdout.trim().toLowerCase();
      if (verified.exitCode !== 0 || resolvedSha !== normalizedSource.commitSha) {
        return yield* requestError(
          "validation-failed",
          "The selected full SHA is not a commit in the project repository.",
        );
      }
      const localStatus = yield* gitVcsDriver.value
        .statusDetailsLocal(project.value.workspaceRoot)
        .pipe(Effect.option);
      const remoteStatus = yield* gitVcsDriver.value
        .statusDetailsRemote(project.value.workspaceRoot)
        .pipe(Effect.option);
      const dirty =
        localStatus._tag === "Some" ? localStatus.value.hasWorkingTreeChanges : remoteSource.dirty;
      const unpushed =
        remoteStatus._tag === "Some" ? remoteStatus.value.aheadCount > 0 : remoteSource.unpushed;
      return {
        ...input,
        source: {
          ...remoteSource,
          repoFull: normalizedSource.repoFull,
          commitSha: normalizedSource.commitSha,
          ...(localStatus._tag === "Some" ? { dirty } : {}),
          ...(remoteStatus._tag === "Some" ? { unpushed } : {}),
        },
      };
    },
  );

  const launchOpenKrittScan: IntegrationService["Service"]["launchOpenKrittScan"] = Effect.fn(
    "IntegrationService.launchOpenKrittScan",
  )(function* (input) {
    const verifiedInput = yield* verifyOpenKrittLaunchSource(input);
    const runId = `open-kritt-${verifiedInput.requestId}`;
    const existing = yield* runs.get(runId).pipe(Effect.mapError(asRequestError));
    const priorRun = Option.isSome(existing) ? existing.value : null;
    // Set only on the one path that may re-POST for an existing request id: the
    // user answering a 409 launch-policy question. The elected retry deliberately
    // reuses the same request id and marker, so it reconciles to the same scan
    // rather than becoming a second paid one.
    let electedPolicyRetry = false;
    if (priorRun !== null) {
      if (priorRun.projectId !== verifiedInput.projectId) {
        return yield* requestError(
          "invalid-config",
          "The launch request id is already associated with another project.",
        );
      }
      // Read the authoritative correlation row rather than parsing the run's
      // human-readable summary. A correlation that was saved while the run
      // transition failed must still resolve, not report "unknown" for a scan
      // that Open Kritt already accepted.
      const correlation = yield* withOpenKrittPersistence(
        openKrittScans.findByRequestId(verifiedInput.requestId),
        null,
      );
      const externalScanId =
        correlation?.externalScanId ?? legacyExternalScanId(priorRun.outputSummary);
      if (
        externalScanId === null &&
        correlation?.launchResolution === "policy-required" &&
        verifiedInput.launchPolicy !== undefined
      ) {
        // Re-POSTing this request id is only safe if the reserved marker is known
        // to survive upstream, because that is what makes the retry reconcile to
        // the same scan instead of creating a second paid one. The round trip is
        // observed on the pinned v1.2.0 revision, so the retry proceeds; the
        // guard stays because a future unverified baseline must refuse it.
        const refusal = openKrittRequestIdReuseRefusal();
        if (refusal !== null) return yield* requestError("validation-failed", refusal);
        electedPolicyRetry = true;
      } else if (externalScanId === null && correlation?.launchResolution !== "policy-required") {
        // The launch outcome is still uncertain. Attempt bounded, best-effort
        // reconciliation inline so an immediate user retry resolves now instead
        // of appearing stranded until the next poller pass.
        const reconciled = yield* openKrittConnector
          .reconcileLaunch({ requestId: verifiedInput.requestId })
          .pipe(Effect.orElseSucceed(() => ({ externalScanId: null, exhausted: false })));
        if (reconciled.externalScanId !== null) {
          yield* withOpenKrittPersistence(
            openKrittScans.saveCorrelation({
              requestId: verifiedInput.requestId,
              externalScanId: reconciled.externalScanId,
              launchResolution: "reconciled",
              launchPolicyChoices: [],
            }),
            undefined,
          );
        }
        return {
          run: runId,
          externalScanId: reconciled.externalScanId,
          launchResolution:
            reconciled.externalScanId !== null ? ("reconciled" as const) : ("unknown" as const),
          policyChoices: [],
          fieldErrors: [],
        };
      } else {
        return {
          run: runId,
          externalScanId,
          launchResolution:
            externalScanId !== null ? ("reconciled" as const) : ("policy-required" as const),
          policyChoices: [],
          fieldErrors: [],
        };
      }
    }
    const currentSettings = yield* settings.getSettings.pipe(
      Effect.mapError((cause) => requestError("invalid-config", cause.message, cause)),
    );
    if (!currentSettings.integrations.openKritt.enabled) {
      return yield* requestError("not-configured", "Open Kritt is disabled.");
    }
    const existingIntent = yield* withOpenKrittPersistence(
      openKrittScans.findByRequestId(verifiedInput.requestId),
      null,
    );
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    if (
      existingIntent !== null &&
      (existingIntent.runId !== runId ||
        existingIntent.projectId !== verifiedInput.projectId ||
        existingIntent.environmentId !== environmentId)
    ) {
      return yield* requestError(
        "invalid-config",
        "The launch request id is already associated with another Open Kritt run.",
      );
    }
    const createdAt = yield* now;
    const intent = makeOpenKrittRun(
      verifiedInput,
      runId,
      createdAt,
      verifiedInput.parentRunId ?? null,
    );
    const inserted = yield* runs.insertIfAbsent(intent).pipe(Effect.mapError(asRequestError));
    if (!inserted && !electedPolicyRetry)
      return {
        run: runId,
        externalScanId: null,
        launchResolution: "unknown" as const,
        policyChoices: [],
        fieldErrors: [],
      };
    if (existingIntent === null) {
      yield* withOpenKrittPersistence(
        openKrittScans.insertLaunchIntent({
          runId,
          requestId: verifiedInput.requestId,
          environmentId,
          projectId: verifiedInput.projectId,
          source:
            verifiedInput.source.kind === "remote"
              ? {
                  repoKind: "remote",
                  repoFull: verifiedInput.source.repoFull,
                  commitSha: verifiedInput.source.commitSha,
                }
              : {
                  repoKind: "local",
                  repoFull: verifiedInput.source.snapshotId,
                  commitSha: verifiedInput.source.commitSha,
                },
          configurationSummary: {
            workflowId: verifiedInput.configuration.workflowId,
            postScriptIds: verifiedInput.configuration.postScriptIds,
            agentSkillIds: verifiedInput.configuration.agentSkillIds,
            severityRankerId: verifiedInput.configuration.severityRankerId,
            providerId: verifiedInput.configuration.providerId,
            modelId: verifiedInput.configuration.modelId,
            thinkingEffort: verifiedInput.configuration.thinkingEffort,
            jobLimit: verifiedInput.configuration.jobLimit,
            ...(verifiedInput.configuration.scope === undefined
              ? {}
              : { scope: verifiedInput.configuration.scope }),
          },
          launchResolution: "unknown",
        }),
        { created: true, runId },
      );
    }
    const launched = yield* openKrittConnector.launchScan(verifiedInput);
    const updatedAt = yield* now;
    const baseRun = priorRun ?? intent;
    // Every non-accepted outcome is durable and distinct. `rejected` is the only
    // terminal one: the request was refused outright, so no scan exists and no
    // reconciliation is owed. `unknown` and `policy-required` both wait, because
    // in both cases a later POST for this request id must not duplicate work.
    const outcome: {
      readonly state: IntegrationRun["state"];
      readonly summary: string;
      readonly timelineNote: string;
    } | null =
      launched.launchResolution === "accepted"
        ? null
        : launched.launchResolution === "policy-required"
          ? {
              state: "waiting",
              summary: "Open Kritt requires an explicit launch-policy choice before starting.",
              timelineNote: `Awaiting an explicit launch-policy choice: ${launched.policyChoices.join(", ").slice(0, 200)}`,
            }
          : launched.launchResolution === "rejected"
            ? {
                state: "failed",
                summary: "Open Kritt rejected the scan configuration.",
                timelineNote: launched.fieldErrors
                  .map((error) => `${error.field}: ${error.message}`)
                  .join("; ")
                  .slice(0, 500),
              }
            : {
                state: launchResolutionForTimeout().durableState,
                summary: "Launch outcome is uncertain; reconciliation is required before retrying.",
                timelineNote: "Launch outcome is uncertain; awaiting bounded reconciliation.",
              };
    const updated: IntegrationRun =
      outcome === null
        ? { ...baseRun, outputSummary: `external-scan:${launched.externalScanId}`, updatedAt }
        : {
            ...baseRun,
            state: outcome.state,
            outputSummary: outcome.summary,
            timeline: appendIntegrationRunTimeline(
              baseRun,
              outcome.state,
              updatedAt,
              outcome.timelineNote,
            ),
            updatedAt,
          };
    yield* runs
      .transition(updated, electedPolicyRetry ? ["queued", "waiting"] : ["queued"])
      .pipe(Effect.mapError(asRequestError));
    yield* withOpenKrittPersistence(
      openKrittScans.saveCorrelation({
        requestId: verifiedInput.requestId,
        externalScanId: launched.externalScanId,
        launchResolution: launched.launchResolution,
        launchPolicyChoices: launched.policyChoices,
      }),
      undefined,
    );
    if (verifiedInput.source.kind === "local") {
      yield* persistOpenKritt(
        openKrittScans.attachSnapshotToRun(verifiedInput.source.snapshotId, runId),
      );
    }
    return { ...launched, run: runId };
  });

  const listOpenKrittRuns: IntegrationService["Service"]["listOpenKrittRuns"] = (input) =>
    Effect.gen(function* () {
      const readAt = yield* now;
      yield* pruneExpiredRuns(readAt);
      const rows = yield* runs
        .list({ ...input, source: "open-kritt" })
        .pipe(Effect.mapError(asRequestError));
      const page = rows.slice(0, input.limit);
      const next = rows.length > input.limit ? page.at(-1) : undefined;
      return {
        runs: page,
        nextCursor: next === undefined ? null : { createdAt: next.createdAt, id: next.id },
      };
    });

  const listOpenKrittFindings: IntegrationService["Service"]["listOpenKrittFindings"] = Effect.fn(
    "IntegrationService.listOpenKrittFindings",
  )(function* (input) {
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    const correlation = yield* withOpenKrittPersistence(
      openKrittScans.findByExternalScanId(input.scanId, environmentId),
      null,
    );
    if (Option.isSome(sqlClient) && correlation === null) {
      return yield* requestError(
        "run-not-found",
        "The Open Kritt scan is not linked to this server environment.",
      );
    }
    const fresh = yield* openKrittConnector.listFindings(input).pipe(
      Effect.match({
        onFailure: (cause) => ({ ok: false as const, cause }),
        onSuccess: (value) => ({ ok: true as const, value }),
      }),
    );
    if (fresh.ok) {
      const items = fresh.value.items.map((finding) => enrichFindingSource(finding, correlation));
      yield* Effect.forEach(
        items,
        (finding) =>
          withOpenKrittPersistence(
            openKrittScans.upsertNormalizedFinding(findingPersistenceInput(finding)),
            undefined,
          ),
        { discard: true },
      );
      return { ...fresh.value, items };
    }

    const cached = yield* withOpenKrittPersistence(
      openKrittScans.listFindings({
        ...input,
        environmentId,
        // Upstream cursors are page tokens; the local cache uses a keyset token.
        // A stale reconnect starts from the first bounded cache page rather than
        // treating an upstream page token as a local primary key.
        cursor: input.cursor?.startsWith("page:") === true ? null : input.cursor,
      }),
      null,
    );
    if (cached !== null && (cached.items.length > 0 || correlation !== null)) {
      return {
        items: cached.items.map(persistedFindingToContract),
        nextCursor: cached.nextCursor,
        stale: true,
      };
    }
    return yield* fresh.cause;
  });
  const getOpenKrittFinding: IntegrationService["Service"]["getOpenKrittFinding"] = Effect.fn(
    "IntegrationService.getOpenKrittFinding",
  )(function* (input) {
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    const correlation = yield* withOpenKrittPersistence(
      openKrittScans.findByExternalScanId(input.scanId, environmentId),
      null,
    );
    if (Option.isSome(sqlClient) && correlation === null) {
      return yield* requestError(
        "run-not-found",
        "The Open Kritt scan is not linked to this server environment.",
      );
    }
    const fresh = yield* openKrittConnector.getFinding(input).pipe(
      Effect.match({
        onFailure: (cause) => ({ ok: false as const, cause }),
        onSuccess: (value) => ({ ok: true as const, value }),
      }),
    );
    if (fresh.ok) {
      const finding = enrichFindingSource(fresh.value.finding, correlation);
      yield* withOpenKrittPersistence(
        openKrittScans.upsertNormalizedFinding(findingPersistenceInput(finding)),
        undefined,
      );
      return { ...fresh.value, finding };
    }
    const cached = yield* withOpenKrittPersistence(
      openKrittScans.getFinding(input.findingId, environmentId),
      null,
    );
    if (cached !== null && cached.scanId === input.scanId) {
      const current = yield* settings.getSettings.pipe(
        Effect.mapError((cause) => requestError("invalid-config", cause.message, cause)),
      );
      const upstreamOrigin = yield* Effect.try({
        try: () => normalizeOpenKrittServerUrl(current.integrations.openKritt.serverUrl),
        catch: () => requestError("invalid-config", "The Open Kritt server URL is invalid."),
      });
      const finding = enrichFindingSource(persistedFindingToContract(cached), correlation);
      return {
        finding,
        upstreamUrl: `${upstreamOrigin}/scans/${encodeURIComponent(input.scanId)}/vulnerabilities/${encodeURIComponent(input.findingId)}`,
        stale: true,
      };
    }
    return yield* fresh.cause;
  });
  const ensureOpenKrittScanLinked = Effect.fn("IntegrationService.ensureOpenKrittScanLinked")(
    function* (scanId: string) {
      const environmentId = yield* serverEnvironment.getEnvironmentId;
      const correlation = yield* withOpenKrittPersistence(
        openKrittScans.findByExternalScanId(scanId, environmentId),
        null,
      );
      if (Option.isSome(sqlClient) && correlation === null) {
        return yield* requestError(
          "run-not-found",
          "The Open Kritt scan is not linked to this server environment.",
        );
      }
      return correlation;
    },
  );
  const pauseOpenKrittScan: IntegrationService["Service"]["pauseOpenKrittScan"] = (input) =>
    ensureOpenKrittScanLinked(input.scanId).pipe(
      Effect.flatMap(() => openKrittConnector.controlScan({ ...input, action: "pause" })),
    );
  const stopOpenKrittScan: IntegrationService["Service"]["stopOpenKrittScan"] = (input) =>
    ensureOpenKrittScanLinked(input.scanId).pipe(
      Effect.flatMap(() => openKrittConnector.controlScan({ ...input, action: "stop" })),
    );
  const resumeOpenKrittScan: IntegrationService["Service"]["resumeOpenKrittScan"] = (input) =>
    ensureOpenKrittScanLinked(input.scanId).pipe(
      Effect.flatMap(() => openKrittConnector.controlScan({ ...input, action: "resume" })),
    );

  const prepareOpenKrittRemediationWorktree = Effect.fn(
    "IntegrationService.prepareOpenKrittRemediationWorktree",
  )(function* (input: OpenKrittRemediationLaunchInput): Effect.fn.Return<
    {
      readonly branch: string | null;
      readonly worktreePath: string;
      readonly cleanup: Effect.Effect<void>;
    } | null,
    IntegrationRequestError
  > {
    if (
      Option.isNone(projectionSnapshotQuery) ||
      Option.isNone(gitVcsDriver) ||
      Option.isNone(gitWorkflow)
    ) {
      return null;
    }
    const project = yield* projectionSnapshotQuery.value
      .getProjectShellById(input.projectId)
      .pipe(
        Effect.mapError(() =>
          requestError("validation-failed", "The remediation project is unavailable."),
        ),
      );
    if (Option.isNone(project)) {
      return yield* requestError(
        "validation-failed",
        "The remediation project is unavailable or deleted.",
      );
    }
    const verified = yield* gitVcsDriver.value
      .execute({
        operation: "open-kritt.verify-remediation-commit",
        cwd: project.value.workspaceRoot,
        args: ["rev-parse", "--verify", "--quiet", `${input.targetCommitSha}^{commit}`],
        allowNonZeroExit: true,
        timeoutMs: 15_000,
        maxOutputBytes: 256,
      })
      .pipe(
        Effect.mapError(() =>
          requestError(
            "validation-failed",
            "The scanned commit could not be verified for remediation.",
          ),
        ),
      );
    if (verified.exitCode !== 0 || verified.stdout.trim().toLowerCase() !== input.targetCommitSha) {
      return yield* requestError(
        "validation-failed",
        "Remediation must start from the exact scanned commit.",
      );
    }
    if (input.worktreePreference === "existing-clean-worktree") {
      const status = yield* gitVcsDriver.value
        .statusDetailsLocal(project.value.workspaceRoot)
        .pipe(
          Effect.mapError(() =>
            requestError(
              "validation-failed",
              "The selected worktree status could not be verified.",
            ),
          ),
        );
      if (status.hasWorkingTreeChanges) {
        return yield* requestError(
          "validation-failed",
          "The selected worktree is not clean; use an exact-commit worktree.",
        );
      }
      return { branch: null, worktreePath: project.value.workspaceRoot, cleanup: Effect.void };
    }
    const safeFindingId = input.findingId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80) || "finding";
    const worktree = yield* gitWorkflow.value
      .createWorktree({
        cwd: project.value.workspaceRoot,
        refName: input.targetCommitSha,
        baseRefName: input.targetCommitSha,
        newRefName: `security/open-kritt-${safeFindingId}`,
        path: null,
      })
      .pipe(
        Effect.mapError(() =>
          requestError(
            "execution-failed",
            "Could not create the exact-commit remediation worktree.",
          ),
        ),
      );
    return {
      branch: worktree.worktree.refName,
      worktreePath: worktree.worktree.path,
      cleanup: gitWorkflow.value
        .removeWorktree({
          cwd: project.value.workspaceRoot,
          path: worktree.worktree.path,
          force: true,
        })
        .pipe(
          Effect.asVoid,
          Effect.catch(() => Effect.void),
        ),
    };
  });

  const launchOpenKrittRemediation: IntegrationService["Service"]["launchOpenKrittRemediation"] =
    Effect.fn("IntegrationService.launchOpenKrittRemediation")(function* (input) {
      const environmentId = yield* serverEnvironment.getEnvironmentId;
      const persisted = yield* withOpenKrittPersistence(
        openKrittScans.getFinding(input.findingId, environmentId),
        null,
      );
      // Remediation correlation (finding -> scan -> project -> commit) is only
      // provable against persisted state, so a persistence-less deployment must
      // fail closed rather than trust a client supplied evidence packet.
      if (Option.isNone(sqlClient)) {
        return yield* requestError(
          "not-configured",
          "Open Kritt remediation requires the server persistence layer.",
        );
      }
      if (persisted === null) {
        return yield* requestError(
          "validation-failed",
          "The selected Open Kritt finding is not available in the server cache.",
        );
      }
      const findingCorrelation = yield* withOpenKrittPersistence(
        openKrittScans.findByExternalScanId(persisted.scanId, environmentId),
        null,
      );
      if (findingCorrelation === null || findingCorrelation.projectId !== input.projectId) {
        return yield* requestError(
          "validation-failed",
          "The selected finding is not linked to this project.",
        );
      }
      if (persisted.sourceCommitSha !== input.targetCommitSha) {
        return yield* requestError(
          "validation-failed",
          "Remediation must start from the exact scanned commit.",
        );
      }
      // The scanned commit check is a strong proxy, but a project whose remote
      // was repointed to a fork sharing history would still resolve it. Compare
      // the canonical repository identity explicitly for remote scans.
      const scannedRepoFull =
        findingCorrelation.source.repoKind === "remote" ? findingCorrelation.source.repoFull : null;
      const currentRepoFull =
        scannedRepoFull === null ? null : yield* resolveProjectRepoFull(input.projectId);
      const evidence =
        persisted === null
          ? input.evidence
          : {
              type: persisted.type,
              severity: persisted.severity,
              summary: persisted.summary,
              explanation: persisted.explanation,
              path: persisted.path,
              line: persisted.line,
              triggerFlow: persisted.triggerFlow,
              maliciousInput: persisted.maliciousInput,
              exploitability: persisted.exploitability,
              maliciousActor: persisted.maliciousActor,
              cwe: persisted.cwe,
              cvss: persisted.cvss,
            };
      const remediation = yield* Effect.try({
        try: () =>
          buildOpenKrittRemediationLaunch({
            findingId: input.findingId,
            scanId: persisted.scanId,
            projectId: input.projectId,
            ...(scannedRepoFull === null || currentRepoFull === null
              ? {}
              : { scannedRepoFull, currentRepoFull }),
            sourceCommitSha: input.targetCommitSha,
            worktreePreference: input.worktreePreference,
            modelSelection: input.modelSelection,
            runtimeMode: input.runtimeMode,
            evidence,
          }),
        catch: (cause) =>
          requestError(
            "validation-failed",
            cause instanceof Error ? cause.message : "Invalid remediation evidence.",
          ),
      });
      const prepared = yield* prepareOpenKrittRemediationWorktree(input);
      let turnStarted = false;
      return yield* Effect.gen(function* () {
        const threadId = yield* harness
          .createThread({
            projectId: input.projectId,
            title: `Security remediation: ${input.evidence.type}`,
            modelSelection: input.modelSelection,
            runtimeMode: input.runtimeMode,
            branch: prepared?.branch ?? null,
            worktreePath: prepared?.worktreePath ?? null,
          })
          .pipe(
            Effect.mapError((cause) =>
              requestError("execution-failed", "Could not create the remediation thread.", cause),
            ),
          );
        yield* harness
          .startTurn({
            threadId,
            prompt: buildRemediationPrompt(remediation.execution.evidence),
            modelSelection: input.modelSelection,
            runtimeMode: input.runtimeMode,
            titleSeed: "Open Kritt remediation",
          })
          .pipe(
            Effect.mapError((cause) =>
              requestError("execution-failed", "Could not start the remediation turn.", cause),
            ),
          );
        turnStarted = true;
        return { threadId, runId: null, sourceCommitSha: input.targetCommitSha };
      }).pipe(
        Effect.ensuring(
          Effect.suspend(() =>
            prepared !== null && !turnStarted ? prepared.cleanup : Effect.void,
          ),
        ),
      );
    });

  const rescanOpenKritt: IntegrationService["Service"]["rescanOpenKritt"] = Effect.fn(
    "IntegrationService.rescanOpenKritt",
  )(function* (input) {
    if (!input.configurationConfirmed)
      return yield* requestError("validation-failed", "Rescan configuration must be confirmed.");
    const priorRun = yield* runs.get(input.priorRunId).pipe(Effect.mapError(asRequestError));
    if (
      Option.isNone(priorRun) ||
      priorRun.value.source !== "open-kritt" ||
      priorRun.value.projectId !== input.projectId
    ) {
      return yield* requestError(
        "validation-failed",
        "The prior Open Kritt scan is not linked to this project.",
      );
    }
    const priorSummary = priorRun.value.outputSummary ?? "";
    const priorRunCorrelation = yield* withOpenKrittPersistence(
      openKrittScans.findByRunId(input.priorRunId),
      null,
    );
    const priorExternalScanId =
      priorRunCorrelation?.externalScanId ?? legacyExternalScanId(priorSummary);
    if (priorExternalScanId !== null && priorExternalScanId !== input.priorScanId) {
      return yield* requestError(
        "validation-failed",
        "The prior scan identity does not match the durable run.",
      );
    }
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    const priorCorrelation = yield* withOpenKrittPersistence(
      openKrittScans.findByExternalScanId(input.priorScanId, environmentId),
      null,
    );
    const rescanSource = input.source;
    if (rescanSource.kind === "remote") {
      const correlation = priorCorrelation;
      const priorCommitSha = correlation?.source.commitSha;
      if (priorCommitSha === null || priorCommitSha === undefined) {
        return yield* requestError(
          "validation-failed",
          "The prior immutable revision is unavailable; inspect the original scan before rescanning.",
        );
      }
      // Validates that the rescan targets a genuinely new immutable revision
      // linked to the prior scan before any paid work is created.
      yield* Effect.try({
        try: () =>
          buildOpenKrittRescanLaunch({
            projectId: input.projectId,
            priorRunId: input.priorRunId,
            priorScanId: input.priorScanId,
            ...(input.remediationThreadId === undefined
              ? {}
              : { remediationThreadId: input.remediationThreadId }),
            priorCommitSha,
            nextCommitSha: rescanSource.commitSha,
            configurationConfirmed: input.configurationConfirmed,
          }),
        catch: (cause) =>
          requestError(
            "validation-failed",
            cause instanceof Error ? cause.message : "Rescan revision is invalid.",
          ),
      });
      if (correlation === null || correlation.source.repoFull !== rescanSource.repoFull) {
        return yield* requestError(
          "validation-failed",
          "The rescan repository does not match the original scan.",
        );
      }
    } else {
      if (
        priorCorrelation === null ||
        priorCorrelation.source.repoKind !== "local" ||
        priorCorrelation.source.repoFull === rescanSource.snapshotId
      ) {
        return yield* requestError(
          "validation-failed",
          "A rescan requires a new local snapshot linked to the prior scan.",
        );
      }
    }
    // Reuse the prior configuration so the child scan is comparable with the
    // scan it is linked to. `input.configuration` is the user's confirmed edit
    // of that configuration; settings defaults are never silently substituted.
    const priorConfiguration = priorScanConfiguration(priorCorrelation?.configurationSummary);
    const configuration = input.configuration ?? priorConfiguration;
    if (configuration === null) {
      return yield* requestError(
        "validation-failed",
        "The prior scan configuration is unavailable; confirm an explicit configuration before rescanning.",
      );
    }
    const launchInput: OpenKrittLaunchScanInput = {
      projectId: input.projectId,
      requestId: input.requestId,
      source: rescanSource,
      configuration,
      parentRunId: input.priorRunId,
    };
    const result = yield* launchOpenKrittScan(launchInput);
    return {
      childRunId: result.run,
      externalScanId: result.externalScanId,
      configuration,
      reusedPriorConfiguration: input.configuration === undefined,
    };
  });

  const compareOpenKrittScans: IntegrationService["Service"]["compareOpenKrittScans"] = Effect.fn(
    "IntegrationService.compareOpenKrittScans",
  )(function* (input) {
    if (input.priorScanId === input.currentScanId) {
      return yield* requestError(
        "validation-failed",
        "A comparison requires two distinct Open Kritt scans.",
      );
    }
    if (Option.isNone(sqlClient)) {
      return yield* requestError(
        "not-configured",
        "Scan comparison requires durable Open Kritt persistence.",
      );
    }
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    const load = (scanId: string) =>
      Effect.gen(function* () {
        const correlation = yield* withOpenKrittPersistence(
          openKrittScans.findByExternalScanId(scanId, environmentId),
          null,
        );
        if (correlation === null || correlation.projectId !== input.projectId) {
          return yield* requestError(
            "run-not-found",
            "An Open Kritt scan in this comparison is not linked to this project.",
          );
        }
        const page = yield* withOpenKrittPersistence(
          openKrittScans.listFindings({
            scanId,
            includeDuplicates: input.includeDuplicates,
            limit: 200,
            environmentId,
          }),
          null,
        );
        return { correlation, items: page?.items ?? [] } as const;
      });
    const prior = yield* load(input.priorScanId);
    const current = yield* load(input.currentScanId);
    const sameSourceRevision =
      prior.correlation.source.repoKind === current.correlation.source.repoKind &&
      prior.correlation.source.repoFull === current.correlation.source.repoFull &&
      prior.correlation.source.commitSha !== null &&
      prior.correlation.source.commitSha === current.correlation.source.commitSha;
    const sameConfiguration = sameOpenKrittConfiguration(
      prior.correlation.configurationSummary,
      current.correlation.configurationSummary,
    );
    const comparison = compareFindingSets(prior.items, current.items, {
      sameSourceRevision,
      sameConfiguration,
    });
    return {
      priorScanId: input.priorScanId,
      currentScanId: input.currentScanId,
      sameSourceRevision,
      sameConfiguration,
      conclusion: comparison.conclusion,
      reason: comparison.reason ?? null,
      stillPresent: comparison.stillPresent
        .slice(0, 200)
        .map((entry) => comparisonEntry(entry.finding, entry.fingerprint)),
      disappeared: comparison.disappeared
        .slice(0, 200)
        .map((entry) => comparisonEntry(entry.finding, entry.fingerprint)),
      stale: false,
    };
  });

  const projectWorkspaceForSnapshot = Effect.fn("IntegrationService.projectWorkspaceForSnapshot")(
    function* (projectId: ProjectId) {
      if (Option.isNone(projectionSnapshotQuery)) {
        return yield* requestError(
          "not-configured",
          "Project snapshot support is unavailable in this runtime.",
        );
      }
      const project = yield* projectionSnapshotQuery.value
        .getProjectShellById(projectId)
        .pipe(
          Effect.mapError(() =>
            requestError("validation-failed", "The selected project is unavailable."),
          ),
        );
      if (Option.isNone(project)) {
        return yield* requestError(
          "validation-failed",
          "The selected project is unavailable or deleted.",
        );
      }
      return project.value;
    },
  );

  const snapshotCommitSha = (workspaceRoot: string) =>
    Option.match(gitVcsDriver, {
      onNone: () => Effect.succeed<string | null>(null),
      onSome: (git) =>
        git
          .execute({
            operation: "open-kritt.snapshot-source-commit",
            cwd: workspaceRoot,
            args: ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
            allowNonZeroExit: true,
            timeoutMs: 15_000,
            maxOutputBytes: 256,
          })
          .pipe(
            Effect.map((result) =>
              result.exitCode === 0 && /^[0-9a-f]{40}$/.test(result.stdout.trim().toLowerCase())
                ? result.stdout.trim().toLowerCase()
                : null,
            ),
            Effect.orElseSucceed<string | null>(() => null),
          ),
    });

  const previewOpenKrittSnapshot: IntegrationService["Service"]["previewOpenKrittSnapshot"] =
    Effect.fn("IntegrationService.previewOpenKrittSnapshot")(function* (input) {
      if (Option.isNone(snapshotService)) {
        return yield* requestError(
          "not-configured",
          "Local Open Kritt snapshots are not configured.",
        );
      }
      const project = yield* projectWorkspaceForSnapshot(input.projectId);
      const sourceCommitSha = yield* snapshotCommitSha(project.workspaceRoot);
      const preview = yield* snapshotService.value
        .previewSnapshot({
          projectId: input.projectId,
          workspaceRoot: project.workspaceRoot,
          sourceCommitSha,
        })
        .pipe(
          Effect.mapError(() =>
            requestError("validation-failed", "The local snapshot preview could not be created."),
          ),
        );
      const manifestDigest = preview.manifestDigest ?? "0".repeat(64);
      return {
        projectId: input.projectId,
        snapshotId: preview.snapshotId,
        manifestDigest,
        fileCount: preview.fileCount ?? preview.includedPaths.length,
        byteCount: preview.byteCount ?? 0,
        includedPaths: preview.includedPaths,
        excludedPaths: preview.excludedPaths,
        confirmedSafeForProvider: false as const,
      };
    });

  const createOpenKrittSnapshot: IntegrationService["Service"]["createOpenKrittSnapshot"] =
    Effect.fn("IntegrationService.createOpenKrittSnapshot")(function* (input) {
      if (Option.isNone(snapshotService)) {
        return yield* requestError(
          "not-configured",
          "Local Open Kritt snapshots are not configured.",
        );
      }
      const project = yield* projectWorkspaceForSnapshot(input.projectId);
      const sourceCommitSha = yield* snapshotCommitSha(project.workspaceRoot);
      const created = yield* snapshotService.value
        .createSnapshot({
          projectId: input.projectId,
          workspaceRoot: project.workspaceRoot,
          sourceCommitSha,
          confirmSafeForProvider: input.confirmSafeForProvider,
          acknowledgedManifestDigest: input.acknowledgedManifestDigest,
        })
        .pipe(
          Effect.mapError((cause) =>
            requestError(
              "validation-failed",
              cause instanceof Error && cause.message.length > 0
                ? cause.message
                : "The local snapshot could not be created.",
            ),
          ),
        );
      const saveSnapshot = persistOpenKritt(
        openKrittScans.saveSnapshot({
          snapshotId: created.snapshotId,
          projectId: input.projectId,
          folderName: created.snapshotFolderName,
          manifestDigest: created.manifestDigest,
          fileCount: created.manifest.fileCount,
          byteCount: created.manifest.byteCount,
          exclusions: created.manifest.excludedPaths,
          sourceCommitSha,
          // A local snapshot is a reviewed copy of the current workspace. The
          // commit is useful provenance, but the copy may include local edits.
          dirty: true,
          retainSnapshot: false,
        }),
      );
      const saveSnapshotWithCleanup = saveSnapshot.pipe(
        Effect.tapError(() =>
          snapshotService.value
            .cleanupSnapshot({
              snapshotFolderName: created.snapshotFolderName,
              scanState: "cancelled",
              retainSnapshot: false,
            })
            .pipe(Effect.ignore),
        ),
      );
      yield* saveSnapshotWithCleanup;
      return {
        projectId: input.projectId,
        snapshotId: created.snapshotId,
        manifestDigest: created.manifestDigest,
        fileCount: created.manifest.fileCount,
        byteCount: created.manifest.byteCount,
      };
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
        if (existing.parentRunId !== null) {
          return yield* requestError(
            "invalid-config",
            "The launch request id is already associated with a linked retry.",
          );
        }
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
    return {
      run,
      runtime,
      operations: integrationRunOperations(run),
    };
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
    configureOpenKritt,
    testOpenKritt,
    refreshOpenKrittCatalog,
    launchOpenKrittScan,
    pauseOpenKrittScan,
    stopOpenKrittScan,
    resumeOpenKrittScan,
    listOpenKrittRuns,
    listOpenKrittFindings,
    getOpenKrittFinding,
    launchOpenKrittRemediation,
    rescanOpenKritt,
    compareOpenKrittScans,
    previewOpenKrittSnapshot,
    createOpenKrittSnapshot,
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
