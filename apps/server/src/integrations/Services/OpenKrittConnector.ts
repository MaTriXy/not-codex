import { IntegrationRequestError } from "@notcodex/contracts";
import type {
  OpenKrittCatalog,
  OpenKrittConfigureInput,
  OpenKrittConfigureResult,
  OpenKrittConnectionTestResult,
  OpenKrittDiagnostics,
  OpenKrittFindingDetailResult,
  OpenKrittFindingsListInput,
  OpenKrittFindingsListResult,
  OpenKrittLaunchScanInput,
  OpenKrittScanConfiguration,
  OpenKrittScanLaunchResult,
  OpenKrittScanControlInput,
  OpenKrittScanControlResult,
  OpenKrittSettings,
} from "@notcodex/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  OpenKrittHttpClientError,
  requestOpenKritt,
  type OpenKrittFetch,
} from "../Layers/OpenKrittHttpClient.ts";
import {
  buildOpenKrittLaunchRequestBody,
  buildOpenKrittLocalScanRequestBody,
  classifyOpenKrittLaunchResponse,
  isOpenKrittControlAuthorized,
  openKrittControlStatus,
  readOpenKrittRequestMarker,
} from "../Layers/OpenKrittConnector.ts";
import { OPEN_KRITT_BEARER_TOKEN_SECRET_NAME } from "../openKrittSecret.ts";
import {
  decodeOpenKrittCatalog,
  decodeOpenKrittFindingDetail,
  decodeOpenKrittFindings,
  decodeOpenKrittHealth,
  decodeOpenKrittScan,
  decodeOpenKrittScanList,
} from "../openKrittSchemas.ts";
import {
  normalizeOpenKrittDecodedFinding,
  toOpenKrittFindingContract,
  buildOpenKrittFindingUrl,
  type OpenKrittFindingSource,
} from "../openKrittFindings.ts";
import { appendOpenKrittDiagnosticEvent } from "../openKrittDiagnostics.ts";
import {
  isOpenKrittLoopbackUrl,
  normalizeOpenKrittServerUrl,
  parseOpenKrittAllowedAddress,
} from "../openKrittUrl.ts";
import { OPEN_KRITT_PROTOCOL_COMPATIBILITY } from "../openKrittCompatibility.ts";

/** Bounded reconciliation window for an uncertain POST /api/scans outcome. */
export const OPEN_KRITT_RECONCILE_PAGE_SIZE = 100;
export const OPEN_KRITT_RECONCILE_MAX_PAGES = 5;

export interface OpenKrittConnectorShape {
  readonly diagnostics: Effect.Effect<OpenKrittDiagnostics>;
  readonly configure: (
    input: OpenKrittConfigureInput,
  ) => Effect.Effect<OpenKrittConfigureResult, IntegrationRequestError>;
  readonly testConnection: Effect.Effect<OpenKrittConnectionTestResult, IntegrationRequestError>;
  readonly refreshCatalog: Effect.Effect<OpenKrittCatalog, IntegrationRequestError>;
  readonly launchScan: (
    input: OpenKrittLaunchScanInput,
  ) => Effect.Effect<OpenKrittScanLaunchResult, IntegrationRequestError>;
  /** Read one authoritative upstream scan snapshot. A 404 is represented as missing. */
  readonly inspectScan: (input: {
    readonly scanId: string;
  }) => Effect.Effect<OpenKrittScanObservation, IntegrationRequestError>;
  /**
   * Search a bounded window of scan pages for a preserved launch marker.
   * `exhausted` is true when the page bound was reached without a match, so the
   * caller can surface "not yet reconciled" instead of "no such scan".
   */
  readonly reconcileLaunch: (input: {
    readonly requestId: string;
  }) => Effect.Effect<
    { readonly externalScanId: string | null; readonly exhausted: boolean },
    IntegrationRequestError
  >;
  readonly controlScan: (
    input: OpenKrittScanControlInput,
  ) => Effect.Effect<OpenKrittScanControlResult, IntegrationRequestError>;
  readonly listFindings: (
    input: OpenKrittFindingsListInput,
  ) => Effect.Effect<OpenKrittFindingsListResult, IntegrationRequestError>;
  readonly getFinding: (input: {
    readonly scanId: string;
    readonly findingId: string;
  }) => Effect.Effect<OpenKrittFindingDetailResult, IntegrationRequestError>;
}

export interface OpenKrittScanObservation {
  readonly kind: "found" | "missing";
  readonly scan: ReturnType<typeof decodeOpenKrittScan> | null;
}

export class OpenKrittConnector extends Context.Service<
  OpenKrittConnector,
  OpenKrittConnectorShape
>()("notcodex/integrations/Services/OpenKrittConnector") {}

/**
 * Deterministic transport used by tests only. Production leaves this unset so
 * every request goes through the address-pinned client.
 */
export const OpenKrittTestFetch = Context.Reference<OpenKrittFetch | null>(
  "notcodex/integrations/Services/OpenKrittTestFetch",
  { defaultValue: () => null },
);

const isIntegrationRequestError = Schema.is(IntegrationRequestError);

// @effect-diagnostics-next-line globalDate:off
const nowIso = (): string => new Date().toISOString();

function requestError(
  code: IntegrationRequestError["code"],
  message: string,
): IntegrationRequestError {
  return new IntegrationRequestError({ code, message });
}

function safeErrorMessage(cause: unknown): string {
  if (cause instanceof OpenKrittHttpClientError) {
    switch (cause.code) {
      case "unauthorized":
        return "Open Kritt authorization was rejected by the configured private service.";
      case "timeout":
        return "Open Kritt did not respond within the configured timeout.";
      case "unsafe-redirect":
        return "Open Kritt returned an unsafe redirect.";
      default:
        return "Open Kritt connection failed.";
    }
  }
  return "Open Kritt connection failed.";
}

function requestErrorForHttp(cause: unknown): IntegrationRequestError {
  if (cause instanceof OpenKrittHttpClientError && cause.code === "unauthorized") {
    return requestError("unauthorized", "Open Kritt rejected the configured authentication.");
  }
  if (cause instanceof OpenKrittHttpClientError && cause.code === "unexpected-content-type") {
    return requestError("connection-failed", "Open Kritt returned an unexpected response type.");
  }
  if (cause instanceof OpenKrittHttpClientError && cause.code === "malformed-response") {
    return requestError("connection-failed", "Open Kritt returned malformed response data.");
  }
  return requestError("connection-failed", safeErrorMessage(cause));
}

/**
 * Open Kritt v1.2.0 returns one bare array. Page that bounded snapshot locally
 * so callers can still reach every finding without changing the upstream API.
 */
function openKrittFindingOffset(cursor: string | null): number {
  if (cursor === null) return 0;
  const match = /^offset:(0|[1-9]\d{0,8})$/.exec(cursor);
  if (match === null) throw new Error("Invalid Open Kritt finding cursor.");
  return Number(match[1]);
}

function fallbackDiagnostics(): OpenKrittDiagnostics {
  return {
    health: "disabled",
    lastSuccessfulContact: null,
    nextRetryAt: null,
    compatibilityVersion: OPEN_KRITT_PROTOCOL_COMPATIBILITY.version,
    serverVersion: null,
    lastError: null,
    recentEvents: [],
  };
}

export const makeOpenKrittConnector = Effect.gen(function* () {
  const settings = yield* ServerSettingsService;
  const secrets = yield* ServerSecretStore;
  const diagnosticsRef = yield* Ref.make<OpenKrittDiagnostics>(fallbackDiagnostics());

  const readToken = secrets
    .get(OPEN_KRITT_BEARER_TOKEN_SECRET_NAME)
    .pipe(
      Effect.mapError(() =>
        requestError("connection-failed", "Open Kritt token storage is unavailable."),
      ),
    );

  const readConfiguration = Effect.gen(function* () {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError(() => requestError("invalid-config", "Open Kritt settings are unavailable.")),
    );
    const tokenOption = yield* readToken;
    const token = Option.match(tokenOption, {
      onNone: () => null,
      onSome: (value) => new TextDecoder().decode(value),
    });
    const configuration = current.integrations.openKritt;
    const serverUrl =
      configuration.serverUrl.length === 0
        ? ""
        : normalizeOpenKrittServerUrl(configuration.serverUrl);
    return { configuration: { ...configuration, serverUrl }, token };
  }).pipe(
    Effect.mapError((cause) =>
      requestError(
        "invalid-config",
        cause instanceof Error ? cause.message : "Open Kritt settings are invalid.",
      ),
    ),
  );

  const recordDiagnosticFailure = (cause: unknown) =>
    Ref.update(diagnosticsRef, (current): OpenKrittDiagnostics => {
      const requestCode = isIntegrationRequestError(cause) ? cause.code : "connection-failed";
      const diagnosticCode =
        requestCode === "unauthorized"
          ? ("unauthorized" as const)
          : requestCode === "validation-failed"
            ? ("protocol-error" as const)
            : ("poll-failed" as const);
      const health =
        requestCode === "unauthorized"
          ? ("unauthorized" as const)
          : requestCode === "validation-failed"
            ? ("protocol-error" as const)
            : ("stale" as const);
      const occurredAt = nowIso();
      const message =
        health === "unauthorized"
          ? "Open Kritt authorization was rejected."
          : health === "protocol-error"
            ? "Open Kritt returned an invalid protocol response."
            : "Open Kritt connection failed.";
      return {
        ...appendOpenKrittDiagnosticEvent(current, {
          code: diagnosticCode,
          summary: message,
          severity: "error",
        }),
        health,
        nextRetryAt: occurredAt,
        lastError: { code: diagnosticCode, message, occurredAt },
      };
    });

  const testFetch = yield* OpenKrittTestFetch;
  const request = (input: {
    readonly configuration: OpenKrittSettings;
    readonly token: string | null;
    readonly method: "GET" | "POST" | "PATCH" | "DELETE";
    readonly path: string;
    readonly body?: unknown;
  }) =>
    Effect.tryPromise({
      try: () =>
        requestOpenKritt({
          ...(testFetch === null ? {} : { fetch: testFetch }),
          serverUrl: input.configuration.serverUrl,
          allowedPrivateAddresses: input.configuration.allowedPrivateAddresses,
          token: input.configuration.authMode === "bearer" ? input.token : null,
          method: input.method,
          path: input.path,
          ...(input.body === undefined ? {} : { body: input.body }),
          expectedContentType: "application/json",
        }),
      catch: (cause) => requestErrorForHttp(cause),
    }).pipe(Effect.tapError(recordDiagnosticFailure));

  const diagnostics = Ref.get(diagnosticsRef);

  const configure: OpenKrittConnectorShape["configure"] = Effect.fn("OpenKrittConnector.configure")(
    function* (input) {
      const current = yield* settings.getSettings.pipe(
        Effect.mapError(() =>
          requestError("invalid-config", "Open Kritt settings are unavailable."),
        ),
      );
      if (input.clearToken === true && input.token !== undefined && input.token.length > 0) {
        return yield* requestError(
          "invalid-config",
          "A token cannot be set and cleared in the same request.",
        );
      }
      const nextBase = {
        ...current.integrations.openKritt,
        ...input.settings,
      };
      const normalizedServerUrl = yield* Effect.try({
        try: () =>
          nextBase.serverUrl.length === 0 ? "" : normalizeOpenKrittServerUrl(nextBase.serverUrl),
        catch: (cause) =>
          requestError(
            "invalid-config",
            cause instanceof Error ? cause.message : "Invalid Open Kritt URL.",
          ),
      });
      const next: OpenKrittSettings = { ...nextBase, serverUrl: normalizedServerUrl };
      if (next.enabled && next.serverUrl.length === 0) {
        return yield* requestError(
          "invalid-config",
          "An Open Kritt server URL is required before enabling the connector.",
        );
      }
      if (
        next.enabled &&
        next.serverUrl.length > 0 &&
        !isOpenKrittLoopbackUrl(next.serverUrl) &&
        input.acknowledgeNonLoopbackWarning !== true
      ) {
        return yield* requestError(
          "invalid-config",
          "A non-loopback Open Kritt endpoint requires explicit private-network acknowledgement.",
        );
      }
      // Reject an unparseable allowlist entry at configure time rather than
      // silently ignoring it at connect time, where the operator would only see
      // a generic "disallowed address" failure.
      const invalidAllowedAddress = next.allowedPrivateAddresses.find(
        (entry) => parseOpenKrittAllowedAddress(entry) === null,
      );
      if (invalidAllowedAddress !== undefined) {
        return yield* requestError(
          "invalid-config",
          "Allowed private addresses must be literal IP addresses or CIDR ranges.",
        );
      }
      const existing = yield* readToken;
      const clears = input.clearToken === true || input.token === "";
      const secretChanged = clears || input.token !== undefined;
      const tokenConfigured = clears
        ? false
        : input.token !== undefined
          ? input.token.length > 0
          : Option.isSome(existing);
      if (next.authMode === "bearer" && next.enabled && !tokenConfigured) {
        return yield* requestError(
          "not-configured",
          "A bearer token is required before enabling authenticated Open Kritt access.",
        );
      }
      if (clears) {
        yield* secrets
          .remove(OPEN_KRITT_BEARER_TOKEN_SECRET_NAME)
          .pipe(
            Effect.mapError(() =>
              requestError("invalid-config", "Open Kritt token storage could not be cleared."),
            ),
          );
      } else if (input.token !== undefined) {
        yield* secrets
          .set(OPEN_KRITT_BEARER_TOKEN_SECRET_NAME, new TextEncoder().encode(input.token))
          .pipe(
            Effect.mapError(() =>
              requestError("invalid-config", "Open Kritt token storage could not be updated."),
            ),
          );
      }
      const restoreToken = Option.match(existing, {
        onNone: () => secrets.remove(OPEN_KRITT_BEARER_TOKEN_SECRET_NAME),
        onSome: (value) => secrets.set(OPEN_KRITT_BEARER_TOKEN_SECRET_NAME, Uint8Array.from(value)),
      });
      const updated = yield* settings.updateSettings({ integrations: { openKritt: next } }).pipe(
        Effect.mapError(() =>
          requestError("invalid-config", "Open Kritt settings could not be saved."),
        ),
        Effect.catch((settingsFailure) =>
          secretChanged
            ? restoreToken.pipe(
                Effect.mapError(() =>
                  requestError(
                    "invalid-config",
                    "Open Kritt settings could not be saved and the prior token could not be restored.",
                  ),
                ),
                Effect.flatMap(() => Effect.fail(settingsFailure)),
              )
            : Effect.fail(settingsFailure),
        ),
      );
      yield* Ref.update(
        diagnosticsRef,
        (value): OpenKrittDiagnostics => ({
          ...value,
          health: updated.integrations.openKritt.enabled ? "misconfigured" : "disabled",
          nextRetryAt: null,
        }),
      );
      return { settings: updated.integrations.openKritt, tokenConfigured };
    },
  );

  const testConnection: OpenKrittConnectorShape["testConnection"] = Effect.gen(function* () {
    const { configuration, token } = yield* readConfiguration;
    if (configuration.serverUrl.length === 0) {
      return yield* requestError(
        "not-configured",
        "Configure an Open Kritt server URL before testing the connection.",
      );
    }
    const result = yield* request({ configuration, token, method: "GET", path: "/api/health" });
    if (result.status !== 200)
      return yield* requestError("connection-failed", "Open Kritt health check failed.");
    yield* Effect.try({
      try: () => decodeOpenKrittHealth(result.body),
      catch: () =>
        requestError(
          "connection-failed",
          "The configured service is not a compatible Open Kritt instance.",
        ),
    });
    const updated: OpenKrittDiagnostics = {
      ...(yield* diagnostics),
      health: "healthy",
      lastSuccessfulContact: nowIso(),
      nextRetryAt: null,
    };
    yield* Ref.set(diagnosticsRef, updated);
    return { ok: true, message: "Connected to Open Kritt.", diagnostics: updated, catalog: null };
  });

  const refreshCatalog: OpenKrittConnectorShape["refreshCatalog"] = Effect.gen(function* () {
    const { configuration, token } = yield* readConfiguration;
    if (configuration.serverUrl.length === 0) {
      return yield* requestError(
        "not-configured",
        "Configure an Open Kritt server URL before refreshing its catalog.",
      );
    }
    const endpoint = (path: string) => request({ configuration, token, method: "GET", path });
    const [workflows, postScripts, agentSkills, severityRankers, modelProviders, modelCatalog] =
      yield* Effect.all([
        endpoint("/api/workflows"),
        endpoint("/api/post-scripts"),
        endpoint("/api/agent-skills"),
        endpoint("/api/severity-rankers"),
        endpoint("/api/model-providers"),
        endpoint("/api/model-catalog"),
      ]);
    return yield* Effect.try({
      try: () =>
        decodeOpenKrittCatalog({
          workflows: workflows.body,
          postScripts: postScripts.body,
          agentSkills: agentSkills.body,
          severityRankers: severityRankers.body,
          modelProviders: modelProviders.body,
          modelCatalog: modelCatalog.body,
        }),
      catch: () =>
        requestError("connection-failed", "Open Kritt returned an invalid catalog response."),
    });
  });

  /**
   * Open Kritt stores the ranking ruleset *body* on the scan, not a ranker id,
   * so a launch without it is rejected upstream. Resolving it here keeps the
   * 32 KB prompt off the client and always current with the installation.
   */
  const resolveSeverityRankerContent = (
    configuration: OpenKrittScanConfiguration,
  ): Effect.Effect<OpenKrittScanConfiguration, IntegrationRequestError> => {
    if (
      configuration.severityRankerContent !== undefined &&
      configuration.severityRankerContent.length > 0
    ) {
      return Effect.succeed(configuration);
    }
    if (configuration.severityRankerId === null) {
      return Effect.fail(
        requestError(
          "validation-failed",
          "Select an Open Kritt severity ranker before launching a scan.",
        ),
      );
    }
    return refreshCatalog.pipe(
      Effect.flatMap((catalog) => {
        const ranker = catalog.severityRankers.find(
          (item) => item.id === configuration.severityRankerId,
        );
        if (ranker?.content === undefined || ranker.content.length === 0) {
          return Effect.fail(
            requestError(
              "validation-failed",
              "The selected Open Kritt severity ranker is no longer available on this installation.",
            ),
          );
        }
        return Effect.succeed({ ...configuration, severityRankerContent: ranker.content });
      }),
    );
  };

  const launchScan: OpenKrittConnectorShape["launchScan"] = Effect.fn(
    "OpenKrittConnector.launchScan",
  )(function* (input) {
    const { configuration: settings, token } = yield* readConfiguration;
    if (settings.serverUrl.length === 0) {
      return yield* requestError("not-configured", "Configure Open Kritt before launching a scan.");
    }
    const configuration = yield* resolveSeverityRankerContent(input.configuration);
    const body =
      input.source.kind === "remote"
        ? buildOpenKrittLaunchRequestBody({
            source: {
              repoKind: "remote",
              repoFull: input.source.repoFull,
              commitSha: input.source.commitSha,
            },
            requestId: input.requestId,
            configuration,
            launchPolicy: input.launchPolicy,
          })
        : buildOpenKrittLocalScanRequestBody({
            snapshotFolderName: input.source.snapshotId,
            requestId: input.requestId,
            configuration,
            launchPolicy: input.launchPolicy,
          });
    const result = yield* request({
      configuration: settings,
      token,
      method: "POST",
      path: "/api/scans",
      body,
    }).pipe(
      Effect.catch((cause) =>
        isIntegrationRequestError(cause) && cause.code === "connection-failed"
          ? Effect.succeed({ status: 0, body: null })
          : Effect.fail(cause),
      ),
    );
    if (result.status === 0)
      return {
        run: `open-kritt:${input.requestId}`,
        externalScanId: null,
        launchResolution: "unknown" as const,
        policyChoices: [],
        fieldErrors: [],
      };
    const classification = yield* Effect.try({
      try: () => classifyOpenKrittLaunchResponse(result.status, result.body),
      catch: () =>
        requestError("connection-failed", "Open Kritt returned an invalid scan launch response."),
    }).pipe(Effect.option);
    // The POST completed but its answer cannot prove whether a scan exists.
    // Preserve the request marker for reconciliation rather than throwing a
    // preflight-shaped error that the orchestration layer may safely retire.
    if (Option.isNone(classification))
      return {
        run: `open-kritt:${input.requestId}`,
        externalScanId: null,
        launchResolution: "unknown" as const,
        policyChoices: [],
        fieldErrors: [],
      };
    const classified = classification.value;
    if (classified.kind === "accepted")
      return {
        run: `open-kritt:${classified.externalScanId}`,
        externalScanId: classified.externalScanId,
        launchResolution: "accepted" as const,
        policyChoices: [],
        fieldErrors: [],
      };
    // A 409 and a 422 are both *answers*, not transport failures: the user has
    // to elect a launch policy or correct a field. Collapsing either into an
    // opaque error would strand the launch with no way forward, so both are
    // returned as typed outcomes against the same durable request id.
    if (classified.kind === "policy-required")
      return {
        run: `open-kritt:${input.requestId}`,
        externalScanId: null,
        launchResolution: "policy-required" as const,
        policyChoices: classified.choices,
        fieldErrors: [],
      };
    return {
      run: `open-kritt:${input.requestId}`,
      externalScanId: null,
      launchResolution: "rejected" as const,
      policyChoices: [],
      fieldErrors: classified.fieldErrors,
    };
  });

  const inspectScan: OpenKrittConnectorShape["inspectScan"] = Effect.fn(
    "OpenKrittConnector.inspectScan",
  )(function* (input) {
    const { configuration, token } = yield* readConfiguration;
    if (configuration.serverUrl.length === 0) {
      return yield* requestError(
        "not-configured",
        "Configure Open Kritt before inspecting a scan.",
      );
    }
    const result = yield* request({
      configuration,
      token,
      method: "GET",
      path: `/api/scans/${encodeURIComponent(input.scanId)}`,
    });
    if (result.status === 404) return { kind: "missing" as const, scan: null };
    if (result.status !== 200) {
      return yield* requestError("connection-failed", "Open Kritt scan state is unavailable.");
    }
    return yield* Effect.try({
      try: () => ({ kind: "found" as const, scan: decodeOpenKrittScan(result.body) }),
      catch: () => requestError("connection-failed", "Open Kritt returned invalid scan state."),
    });
  });

  /**
   * Findings carry no target revision upstream, so it is read from the scan they
   * belong to. Presenting a finding without the revision it was found at would
   * let a user remediate against the wrong tree.
   */
  const scanFindingSource = (
    scanId: string,
  ): Effect.Effect<OpenKrittFindingSource, IntegrationRequestError> =>
    inspectScan({ scanId }).pipe(
      Effect.map((observation): OpenKrittFindingSource => {
        const source = observation.scan?.source ?? null;
        if (source === null) return { commitSha: null, snapshotId: null };
        return source.repoKind === "remote"
          ? { commitSha: source.commitSha, snapshotId: null }
          : { commitSha: null, snapshotId: source.repoFull };
      }),
    );

  const reconcileLaunch: OpenKrittConnectorShape["reconcileLaunch"] = Effect.fn(
    "OpenKrittConnector.reconcileLaunch",
  )(function* (input) {
    const { configuration, token } = yield* readConfiguration;
    if (configuration.serverUrl.length === 0) {
      return yield* requestError(
        "not-configured",
        "Configure Open Kritt before reconciling a launch.",
      );
    }
    // Bounded page walk. A busy installation can accumulate many scans after an
    // uncertain POST, so a single page would leave the run unresolved forever.
    // The bound is explicit and exhausting it is reported as a distinct outcome
    // rather than silently reading as "no matching scan".
    for (let page = 1; page <= OPEN_KRITT_RECONCILE_MAX_PAGES; page += 1) {
      const result = yield* request({
        configuration,
        token,
        method: "GET",
        path: `/api/scans?page=${page}&pageSize=${OPEN_KRITT_RECONCILE_PAGE_SIZE}`,
      });
      if (result.status !== 200) {
        return yield* requestError(
          "connection-failed",
          "Open Kritt scan reconciliation is unavailable.",
        );
      }
      const scans = yield* Effect.try({
        try: () => decodeOpenKrittScanList(result.body),
        catch: () =>
          requestError(
            "connection-failed",
            "Open Kritt returned invalid scan reconciliation data.",
          ),
      });
      const matching = scans.items.find(
        (scan) => readOpenKrittRequestMarker(scan.configuration) === input.requestId,
      );
      if (matching !== undefined) return { externalScanId: matching.id, exhausted: false as const };
      // `totalPages` is authoritative; the page-length fallback covers a server
      // that answered without the pagination envelope.
      const lastPage =
        scans.totalPages === null
          ? scans.items.length < OPEN_KRITT_RECONCILE_PAGE_SIZE
          : page >= scans.totalPages;
      if (lastPage) return { externalScanId: null, exhausted: false as const };
    }
    return { externalScanId: null, exhausted: true as const };
  });

  const controlScan: OpenKrittConnectorShape["controlScan"] = Effect.fn(
    "OpenKrittConnector.controlScan",
  )(function* (input) {
    const observation = yield* inspectScan({ scanId: input.scanId });
    if (observation.kind === "missing" || observation.scan === null) {
      return yield* requestError(
        "run-not-found",
        "The linked Open Kritt scan is no longer available.",
      );
    }
    const status = observation.scan.status;
    // Upstream answers an unauthorized transition with a 500, so the pinned
    // transition table is enforced here rather than probing for it.
    if (!isOpenKrittControlAuthorized(input.action, status)) {
      return yield* requestError(
        "validation-failed",
        `Open Kritt does not authorize ${input.action} while the scan is ${status}.`,
      );
    }
    const { configuration, token } = yield* readConfiguration;
    const result = yield* request({
      configuration,
      token,
      method: "PATCH",
      path: `/api/scans/${encodeURIComponent(input.scanId)}`,
      body: { status: openKrittControlStatus(input.action) },
    });
    if (result.status !== 200) {
      return yield* requestError(
        "connection-failed",
        "Open Kritt did not accept the scan operation.",
      );
    }
    const updated = yield* Effect.try({
      try: () => decodeOpenKrittScan(result.body),
      catch: () =>
        requestError("connection-failed", "Open Kritt returned invalid scan operation data."),
    });
    return { scanId: input.scanId, action: input.action, upstreamStatus: updated.status };
  });

  const listFindings: OpenKrittConnectorShape["listFindings"] = Effect.fn(
    "OpenKrittConnector.listFindings",
  )(function* (input) {
    const { configuration, token } = yield* readConfiguration;
    if (configuration.serverUrl.length === 0) {
      return yield* requestError("not-configured", "Configure Open Kritt before listing findings.");
    }
    const offset = yield* Effect.try({
      try: () => openKrittFindingOffset(input.cursor),
      catch: () => requestError("validation-failed", "Invalid Open Kritt finding cursor."),
    });
    const source = yield* scanFindingSource(input.scanId);
    const result = yield* request({
      configuration,
      token,
      method: "GET",
      path: `/api/scans/${encodeURIComponent(input.scanId)}/vulnerabilities${
        input.includeDuplicates ? "?includeDuplicates=1" : ""
      }`,
    });
    if (result.status !== 200)
      return yield* requestError("connection-failed", "Open Kritt findings are unavailable.");
    const decoded = yield* Effect.try({
      try: () => decodeOpenKrittFindings(result.body),
      catch: () => requestError("connection-failed", "Open Kritt returned invalid finding data."),
    });
    if (decoded.items.some((finding) => finding.scanId !== input.scanId)) {
      return yield* requestError(
        "connection-failed",
        "Open Kritt returned a finding for a different scan.",
      );
    }
    const filtered = decoded.items.filter(
      (finding) => input.includeDuplicates || finding.canonical,
    );
    if (offset > filtered.length) {
      return yield* requestError("validation-failed", "Invalid Open Kritt finding cursor.");
    }
    const nextOffset = Math.min(filtered.length, offset + input.limit);
    const items = yield* Effect.try({
      try: () =>
        filtered
          .slice(offset, nextOffset)
          .map((finding) =>
            toOpenKrittFindingContract(normalizeOpenKrittDecodedFinding(finding, source)),
          ),
      catch: () => requestError("connection-failed", "Open Kritt returned invalid finding data."),
    });
    return {
      items,
      nextCursor: nextOffset < filtered.length ? `offset:${nextOffset}` : null,
      stale: false,
    };
  });

  const getFinding: OpenKrittConnectorShape["getFinding"] = Effect.fn(
    "OpenKrittConnector.getFinding",
  )(function* (input) {
    const { configuration, token } = yield* readConfiguration;
    if (configuration.serverUrl.length === 0) {
      return yield* requestError(
        "not-configured",
        "Configure Open Kritt before reading a finding.",
      );
    }
    const source = yield* scanFindingSource(input.scanId);
    const result = yield* request({
      configuration,
      token,
      method: "GET",
      path: `/api/vulnerabilities/${encodeURIComponent(input.findingId)}`,
    });
    if (result.status !== 200)
      return yield* requestError("connection-failed", "Open Kritt finding detail is unavailable.");
    const finding = yield* Effect.try({
      try: () =>
        toOpenKrittFindingContract(
          normalizeOpenKrittDecodedFinding(decodeOpenKrittFindingDetail(result.body), source),
        ),
      catch: () => requestError("connection-failed", "Open Kritt returned invalid finding detail."),
    });
    if (finding.scanId !== input.scanId) {
      return yield* requestError(
        "connection-failed",
        "Open Kritt returned a finding for a different scan.",
      );
    }
    return {
      finding,
      upstreamUrl: buildOpenKrittFindingUrl(configuration.serverUrl, input.scanId, input.findingId),
      stale: false,
    };
  });

  return OpenKrittConnector.of({
    diagnostics,
    configure,
    testConnection,
    refreshCatalog,
    launchScan,
    inspectScan,
    reconcileLaunch,
    controlScan,
    listFindings,
    getFinding,
  });
});

export const OpenKrittConnectorLive = Layer.effect(OpenKrittConnector, makeOpenKrittConnector);
