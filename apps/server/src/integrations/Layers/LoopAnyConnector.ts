import {
  IntegrationRequestError,
  type IntegrationRun,
  type LoopAnyConnectorDiagnostics,
  type LoopAnyDiagnosticCode,
  type ModelSelection,
  type OrchestrationProjectShell,
  type ProjectId,
} from "@notcodex/contracts";
import { HostProcessArchitecture, HostProcessPlatform } from "@notcodex/shared/hostProcess";
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { AgentHarnessRunner } from "../../orchestration/Services/AgentHarnessRunner.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { IntegrationRunRepository } from "../../persistence/Services/IntegrationRunRepository.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { collectUint8StreamText } from "../../stream/collectUint8StreamText.ts";
import {
  appendIntegrationRunTimeline,
  buildInterruptedIntegrationRun,
  integrationRunRetentionCutoff,
  sanitizeIntegrationRunText,
} from "../integrationRun.ts";
import { LOOPANY_PROTOCOL_COMPATIBILITY } from "../loopanyCompatibility.ts";
import { normalizeLoopAnyServerUrl } from "../loopAnyUrl.ts";
import {
  appendLoopAnyDiagnosticEvent,
  loopAnyDisabledStatus,
  loopAnyDiagnosticEvent,
  loopAnyPollFailureState,
  loopAnyPollStartedStatus,
  loopAnyRetryAt,
  makeLoopAnyDiagnostics,
} from "../loopAnyDiagnostics.ts";
import { pruneMonkeyLoopyRecoveryCapsules } from "../monkeyLoopyRecovery.ts";
import { LOOPANY_DEVICE_TOKEN_SECRET } from "./IntegrationService.ts";
import { LoopAnyConnector } from "../Services/LoopAnyConnector.ts";

const {
  deliveries: MAX_DELIVERIES,
  deliveryRoots: MAX_DELIVERY_ROOTS,
  taskChars: MAX_TASK_CHARS,
  workflowChars: MAX_WORKFLOW_CHARS,
  pollBodyBytes: MAX_POLL_BODY_BYTES,
  reportTextChars: MAX_REPORT_TEXT_CHARS,
} = LOOPANY_PROTOCOL_COMPATIBILITY.limits;
export const LOOPANY_WORKFLOW_DISABLED_REASON =
  "Not Codex does not execute delivered LoopAny workflow JavaScript because Node permissions cannot isolate network access.";
const MAX_TASK_FILE_BYTES = 256 * 1_024;

const Delivery = Schema.Struct({
  runId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  runToken: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_096)),
  role: Schema.Literals(["exec", "evolve", "edit"]),
  loop: Schema.Struct({
    id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
    name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
    workdir: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4_096))),
    taskFile: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4_096))),
    workflow: Schema.NullOr(Schema.String.check(Schema.isMaxLength(MAX_WORKFLOW_CHARS))),
    model: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
    allowControl: Schema.Boolean,
    agent: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
  }),
  prevState: Schema.Unknown,
  roots: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMaxLength(4_096))).check(
      Schema.isMaxLength(MAX_DELIVERY_ROOTS),
    ),
  ),
  systemPrompt: Schema.String.check(Schema.isMaxLength(MAX_TASK_CHARS)),
  task: Schema.String.check(Schema.isMaxLength(MAX_TASK_CHARS)),
});
type Delivery = typeof Delivery.Type;

const PollResponse = Schema.Struct({
  deliveries: Schema.Array(Delivery).check(Schema.isMaxLength(MAX_DELIVERIES)),
  watchDigest: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))),
});

const decodePollResponse = Schema.decodeUnknownEffect(PollResponse);
const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString);

function connectorError(
  code: IntegrationRequestError["code"],
  message: string,
  cause?: unknown,
): IntegrationRequestError {
  return new IntegrationRequestError({ code, message, ...(cause === undefined ? {} : { cause }) });
}

export function isPathWithinRoots(candidate: string, roots: readonly string[], separator: string) {
  return roots.some(
    (root) =>
      candidate === root ||
      candidate.startsWith(root.endsWith(separator) ? root : `${root}${separator}`),
  );
}

export function isPathWithinRootGroups(
  candidate: string,
  rootGroups: ReadonlyArray<readonly string[]>,
  separator: string,
): boolean {
  return rootGroups.every(
    (roots) => roots.length === 0 || isPathWithinRoots(candidate, roots, separator),
  );
}

export function loopAnyTaskFileReadWindow(size: bigint): {
  readonly offset: bigint;
  readonly bytesToRead: bigint;
  readonly truncated: boolean;
} {
  const limit = BigInt(MAX_TASK_FILE_BYTES);
  const truncated = size > limit;
  return {
    offset: truncated ? size - limit : 0n,
    bytesToRead: truncated ? limit : size,
    truncated,
  };
}

export function formatLoopAnyTaskFileContent(value: string, truncated: boolean): string {
  const sanitized = value.replaceAll("\u0000", "");
  return truncated
    ? `[truncated to the last ${MAX_TASK_FILE_BYTES} bytes]\n${sanitized}`
    : sanitized;
}

export function buildLoopAnyPollBody(
  info: Readonly<Record<string, string>>,
  inFlight: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    ...info,
    ...(inFlight.size === 0 ? { wait: true } : {}),
    ...(inFlight.size > 0
      ? {
          progress: [...inFlight].map((runId) => ({
            runId,
            step: 0,
            label: "Running in Not Codex",
          })),
        }
      : {}),
  };
}

export function acceptUniqueLoopAnyDeliveries<T extends { readonly runId: string }>(
  deliveries: readonly T[],
  inFlight: Set<string>,
): T[] {
  return deliveries.filter((delivery) => {
    if (inFlight.has(delivery.runId)) return false;
    inFlight.add(delivery.runId);
    return true;
  });
}

export function shouldRetryLoopAnyReport(code: IntegrationRequestError["code"]): boolean {
  return code === "connection-failed";
}

function clip(
  value: string | undefined,
  maximum: number = MAX_REPORT_TEXT_CHARS,
): string | undefined {
  if (value === undefined) return undefined;
  return value.length <= maximum ? value : `${value.slice(0, maximum)}\n[truncated]`;
}

export function buildLoopAnyWorkflowFallbackTask(
  originalTask: string,
  error: string,
  source: string,
): string {
  return [
    originalTask,
    "",
    "---",
    "IMPORTANT — LoopAny workflow security fallback.",
    "The delivered JavaScript workflow was not executed locally. Complete the original task first",
    "so this scheduled tick still delivers useful work. Then explain that Not Codex requires a",
    "vetted network-isolated runtime before it can execute this workflow.",
    "The workflow cursor must not be advanced.",
    "",
    "Workflow error:",
    "```",
    clip(error, 4_000),
    "```",
    "",
    "Workflow source:",
    "```js",
    clip(source, 20_000),
    "```",
  ].join("\n");
}

export function buildLoopAnyDeliveryTask(
  role: "exec" | "evolve" | "edit",
  originalTask: string,
  workflow: string | null,
): string {
  if (role !== "exec" || workflow === null) return originalTask;

  // Delivered workflow source is untrusted. Node's permission model does not isolate network access,
  // so evaluating it here would expose local services and inherited process capabilities.
  return buildLoopAnyWorkflowFallbackTask(originalTask, LOOPANY_WORKFLOW_DISABLED_REASON, workflow);
}

export function buildLoopAnyIntegrationRunId(runId: string): string {
  const digest = NodeCrypto.createHash("sha256").update(runId, "utf8").digest("hex");
  return `loopany-${digest}`;
}

export function buildLoopAnyRunningRun(
  run: IntegrationRun,
  projectId: ProjectId,
  startedAt: string,
): IntegrationRun {
  return {
    ...run,
    state: "running",
    projectId,
    startedAt: run.startedAt ?? startedAt,
    timeline: appendIntegrationRunTimeline(run, "running", startedAt),
    updatedAt: startedAt,
  };
}

export function buildLoopAnyRecoveredTerminalReport(
  role: Delivery["role"],
  run: IntegrationRun,
): Record<string, unknown> {
  return {
    ok: run.state === "succeeded",
    durationMs: 0,
    ...(run.state === "succeeded" ? { outcome: role === "evolve" ? "evolve" : "exec" } : {}),
    ...(run.outputSummary === null ? {} : { finalText: run.outputSummary }),
    ...(run.failure === null ? {} : { error: run.failure }),
    ...(run.threadIds[0] === undefined ? {} : { sessionId: run.threadIds[0] }),
  };
}

export function loopAnyDeliveryFailureDiagnostic(
  error: IntegrationRequestError,
): "root-rejected" | "execution-failed" {
  return /(?:root|work directory)/i.test(error.message) ? "root-rejected" : "execution-failed";
}

export const makeLoopAnyConnector = Effect.gen(function* () {
  const settingsService = yield* ServerSettingsService;
  const secrets = yield* ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;
  const harness = yield* AgentHarnessRunner;
  const projections = yield* ProjectionSnapshotQuery;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runs = yield* IntegrationRunRepository;
  const hostPlatform = yield* HostProcessPlatform;
  const hostArchitecture = yield* HostProcessArchitecture;
  const inFlight = new Set<string>();
  const deliverySlots = yield* Semaphore.make(2);
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const initialNow = yield* now;
  const persistedDiagnostics = yield* runs.getLoopAnyConnectorDiagnostics().pipe(
    Effect.map(Option.getOrUndefined),
    Effect.catch(() =>
      Effect.logWarning("Persisted LoopAny diagnostics could not be loaded").pipe(
        Effect.as(undefined),
      ),
    ),
  );
  const initialDiagnostics = makeLoopAnyDiagnostics({
    now: initialNow,
    persisted: persistedDiagnostics,
  });
  const statusRef = yield* Ref.make<LoopAnyConnectorDiagnostics>(initialDiagnostics);
  const statusLock = yield* Semaphore.make(1);
  const textDecoder = new TextDecoder();
  const updateStatusIfChanged = Effect.fn("LoopAnyConnector.updateStatusIfChanged")(function* (
    update: (current: LoopAnyConnectorDiagnostics) => LoopAnyConnectorDiagnostics | null,
  ) {
    return yield* statusLock.withPermits(1)(
      Effect.gen(function* () {
        const next = update(yield* Ref.get(statusRef));
        if (next === null) return false;
        yield* runs.putLoopAnyConnectorDiagnostics(next).pipe(
          Effect.catch(() =>
            Effect.logWarning("LoopAny diagnostics could not be persisted", {
              message: "Diagnostics persistence failed.",
            }),
          ),
        );
        yield* Ref.set(statusRef, next);
        return true;
      }),
    );
  });
  const updateStatus = Effect.fn("LoopAnyConnector.updateStatus")(
    (update: (current: LoopAnyConnectorDiagnostics) => LoopAnyConnectorDiagnostics) =>
      updateStatusIfChanged(update).pipe(Effect.asVoid),
  );
  const recordEvent = Effect.fn("LoopAnyConnector.recordEvent")(function* (
    code: LoopAnyDiagnosticCode,
    runId: string | null,
  ) {
    const occurredAt = yield* now;
    const event = loopAnyDiagnosticEvent({
      id: NodeCrypto.randomUUID(),
      code,
      runId,
      occurredAt,
    });
    yield* updateStatus((current) => ({
      ...current,
      recentEvents: appendLoopAnyDiagnosticEvent(current.recentEvents, event),
      updatedAt: occurredAt,
    }));
  });
  const asRunError = (cause: { readonly message: string }) =>
    connectorError("execution-failed", cause.message, cause);
  const transitionRun = (run: IntegrationRun, from: ReadonlyArray<IntegrationRun["state"]>) =>
    runs.transition(run, from).pipe(Effect.mapError(asRunError));

  const prepareRun = Effect.fn("LoopAnyConnector.prepareRun")(function* (delivery: Delivery) {
    const createdAt = yield* now;
    const runId = buildLoopAnyIntegrationRunId(delivery.runId);
    const prunedRunIds = yield* runs
      .pruneCompletedBefore(integrationRunRetentionCutoff(createdAt))
      .pipe(Effect.mapError(asRunError));
    yield* pruneMonkeyLoopyRecoveryCapsules(secrets, prunedRunIds).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not prune private Monkey.D.Loopy recovery metadata", {
          message: cause.message,
        }),
      ),
    );
    const queued: IntegrationRun = {
      id: runId,
      source: "loopany",
      state: "queued",
      projectId: null,
      parentRunId: null,
      attempt: 0,
      threadIds: [],
      journalRef: null,
      outputSummary: null,
      failure: null,
      verification: null,
      timeline: [{ sequence: 0, state: "queued", occurredAt: createdAt, summary: "Run queued" }],
      createdAt,
      startedAt: null,
      completedAt: null,
      updatedAt: createdAt,
    };
    if (yield* runs.insertIfAbsent(queued).pipe(Effect.mapError(asRunError))) {
      yield* recordEvent("delivery-accepted", runId);
      return queued;
    }
    yield* recordEvent("delivery-duplicate", runId);
    const existing = yield* runs.get(queued.id).pipe(Effect.mapError(asRunError));
    return yield* Option.match(existing, {
      onNone: () => connectorError("execution-failed", "Could not recover the LoopAny run."),
      onSome: Effect.succeed,
    });
  });

  const resolveDeliveryContext = Effect.fn("LoopAnyConnector.resolveDeliveryContext")(function* (
    delivery: Delivery,
    allowedRoots: readonly string[],
  ) {
    if (!delivery.loop.workdir) {
      return yield* connectorError(
        "invalid-config",
        "LoopAny delivery did not declare a work directory.",
      );
    }
    const realWorkdir = yield* fileSystem
      .realPath(delivery.loop.workdir)
      .pipe(
        Effect.mapError((cause) =>
          connectorError("invalid-config", "LoopAny work directory does not exist.", cause),
        ),
      );
    const localRoots = yield* Effect.forEach(allowedRoots, (root) =>
      fileSystem
        .realPath(root)
        .pipe(
          Effect.mapError((cause) =>
            connectorError(
              "invalid-config",
              "A configured LoopAny allowed root is unavailable.",
              cause,
            ),
          ),
        ),
    );
    if (!isPathWithinRoots(realWorkdir, localRoots, path.sep)) {
      return yield* connectorError(
        "unauthorized",
        "LoopAny work directory is outside the locally allowed roots.",
      );
    }
    const deliveryRoots =
      delivery.roots && delivery.roots.length > 0
        ? yield* Effect.forEach(delivery.roots, (root) =>
            fileSystem
              .realPath(root)
              .pipe(
                Effect.mapError((cause) =>
                  connectorError(
                    "invalid-config",
                    "A delivery-authorized root is unavailable.",
                    cause,
                  ),
                ),
              ),
          )
        : [];
    if (deliveryRoots.length > 0) {
      if (!isPathWithinRoots(realWorkdir, deliveryRoots, path.sep)) {
        return yield* connectorError(
          "unauthorized",
          "LoopAny work directory is outside the roots authorized by this delivery.",
        );
      }
    }
    const shell = yield* projections
      .getShellSnapshot()
      .pipe(
        Effect.mapError((cause) =>
          connectorError("execution-failed", "Could not resolve a Not Codex project.", cause),
        ),
      );
    const project = shell.projects
      .filter((candidate) =>
        isPathWithinRoots(realWorkdir, [path.resolve(candidate.workspaceRoot)], path.sep),
      )
      .sort((left, right) => right.workspaceRoot.length - left.workspaceRoot.length)[0];
    if (!project) {
      return yield* connectorError(
        "not-configured",
        "No active Not Codex project owns the LoopAny work directory.",
      );
    }
    return {
      project,
      realWorkdir,
      taskFileRootGroups: [
        [realWorkdir, ...localRoots],
        ...(deliveryRoots.length > 0 ? [[realWorkdir, ...deliveryRoots]] : []),
      ],
    };
  });

  const readTaskFile = Effect.fn("LoopAnyConnector.readTaskFile")(function* (
    taskFile: string | null,
    context: {
      readonly realWorkdir: string;
      readonly taskFileRootGroups: ReadonlyArray<readonly string[]>;
    },
  ) {
    if (taskFile === null || taskFile.trim().length === 0) return undefined;
    const expanded =
      taskFile === "~"
        ? NodeOS.homedir()
        : taskFile.startsWith("~/")
          ? path.join(NodeOS.homedir(), taskFile.slice(2))
          : taskFile;
    const candidate = path.resolve(context.realWorkdir, expanded);
    const resolved = Option.getOrUndefined(
      yield* fileSystem.realPath(candidate).pipe(Effect.option),
    );
    if (
      resolved === undefined ||
      !isPathWithinRootGroups(resolved, context.taskFileRootGroups, path.sep)
    ) {
      return undefined;
    }
    const info = Option.getOrUndefined(yield* fileSystem.stat(resolved).pipe(Effect.option));
    if (info === undefined || info.type !== "File") return undefined;

    const window = loopAnyTaskFileReadWindow(info.size);
    const content = Option.getOrUndefined(
      yield* collectUint8StreamText({
        stream: fileSystem.stream(resolved, {
          offset: window.offset,
          bytesToRead: window.bytesToRead,
        }),
        maxBytes: MAX_TASK_FILE_BYTES,
        truncatedMarker: null,
      }).pipe(Effect.option),
    );
    return content === undefined
      ? undefined
      : formatLoopAnyTaskFileContent(content.text, window.truncated);
  });

  const chooseModel = (
    project: OrchestrationProjectShell,
    fallback: ModelSelection,
    requested: string | null,
  ): ModelSelection => {
    const selected = project.defaultModelSelection ?? fallback;
    return requested ? { ...selected, model: requested } : selected;
  };

  const sendReportAttempt = Effect.fn("LoopAnyConnector.sendReportAttempt")(function* (
    serverUrl: string,
    delivery: Delivery,
    report: Record<string, unknown>,
  ) {
    const response = yield* httpClient
      .execute(
        HttpClientRequest.post(
          `${serverUrl}${LOOPANY_PROTOCOL_COMPATIBILITY.endpoints.report}`,
        ).pipe(
          HttpClientRequest.bearerToken(delivery.runToken),
          HttpClientRequest.bodyJsonUnsafe({ runId: delivery.runId, ...report }),
        ),
      )
      .pipe(
        Effect.timeout("15 seconds"),
        Effect.mapError((cause) =>
          connectorError("connection-failed", "Could not report the LoopAny run.", cause),
        ),
      );
    if (response.status < 200 || response.status >= 300) {
      return yield* connectorError(
        response.status === 401 || response.status === 403 ? "unauthorized" : "connection-failed",
        `LoopAny report returned HTTP ${response.status}.`,
      );
    }
  });

  const sendReport = Effect.fn("LoopAnyConnector.sendReport")(function* (
    serverUrl: string,
    delivery: Delivery,
    report: Record<string, unknown>,
  ) {
    return yield* sendReportAttempt(serverUrl, delivery, report).pipe(
      Effect.catch((error) =>
        shouldRetryLoopAnyReport(error.code)
          ? Effect.sleep("500 millis").pipe(
              Effect.andThen(sendReportAttempt(serverUrl, delivery, report)),
            )
          : Effect.fail(error),
      ),
    );
  });

  const sendTerminalReport = (
    delivery: Delivery,
    serverUrl: string,
    report: Record<string, unknown>,
  ) =>
    sendReport(serverUrl, delivery, report).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        recordEvent("report-failed", buildLoopAnyIntegrationRunId(delivery.runId)).pipe(
          Effect.andThen(
            Effect.logWarning("LoopAny terminal report could not be delivered", {
              runId: buildLoopAnyIntegrationRunId(delivery.runId),
              code: error.code,
              message: "Terminal report delivery failed.",
            }),
          ),
          Effect.as(false),
        ),
      ),
    );

  const executeDelivery = Effect.fn("LoopAnyConnector.executeDelivery")(function* (
    delivery: Delivery,
    context: {
      readonly project: OrchestrationProjectShell;
      readonly realWorkdir: string;
      readonly taskFileRootGroups: ReadonlyArray<readonly string[]>;
    },
    fallbackModel: ModelSelection,
  ) {
    const startedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
    const task = buildLoopAnyDeliveryTask(delivery.role, delivery.task, delivery.loop.workflow);
    const prompt = [delivery.systemPrompt, task]
      .filter((part) => part.trim().length > 0)
      .join("\n\n");
    const result = yield* harness
      .run({
        projectId: context.project.id,
        title: `[LoopAny] ${delivery.loop.name}`,
        prompt,
        modelSelection: chooseModel(context.project, fallbackModel, delivery.loop.model),
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: context.realWorkdir,
        timeoutMs: 4 * 60 * 60 * 1_000,
        approvalHandling: "fail",
        titleSeed: delivery.loop.name,
      })
      .pipe(
        Effect.mapError((cause) =>
          connectorError("execution-failed", `LoopAny agent turn failed: ${cause.message}`, cause),
        ),
      );
    const finishedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
    return { context, result, durationMs: finishedAt - startedAt };
  });

  const executeAndReport = Effect.fn("LoopAnyConnector.executeAndReport")(function* (
    serverUrl: string,
    delivery: Delivery,
    allowedRoots: readonly string[],
    fallbackModel: ModelSelection,
  ) {
    const startedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
    const internalRunId = buildLoopAnyIntegrationRunId(delivery.runId);
    let currentRun: IntegrationRun | undefined;
    const markCurrentRunInterrupted = Effect.fn("LoopAnyConnector.markCurrentRunInterrupted")(
      function* () {
        if (
          currentRun === undefined ||
          currentRun.state === "succeeded" ||
          currentRun.state === "failed" ||
          currentRun.state === "cancelled"
        ) {
          return;
        }
        const completedAt = yield* now;
        const interruptedRun = buildInterruptedIntegrationRun(currentRun, completedAt);
        const persisted = yield* transitionRun(interruptedRun, [
          "queued",
          "running",
          "waiting",
        ]).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Interrupted LoopAny run could not be persisted", {
              runId: delivery.runId,
              message: error.message,
            }),
          ),
        );
        if (persisted === true) {
          currentRun = interruptedRun;
        } else if (persisted === false) {
          yield* Effect.logWarning("Interrupted LoopAny run had already advanced", {
            runId: delivery.runId,
          });
        }
      },
    );
    const execute = Effect.gen(function* () {
      currentRun = yield* prepareRun(delivery);
      if (
        currentRun.state === "succeeded" ||
        currentRun.state === "failed" ||
        currentRun.state === "cancelled"
      ) {
        yield* sendTerminalReport(
          delivery,
          serverUrl,
          buildLoopAnyRecoveredTerminalReport(delivery.role, currentRun),
        );
        return;
      }
      const context = yield* resolveDeliveryContext(delivery, allowedRoots);
      if (delivery.role === "exec" && delivery.loop.workflow !== null) {
        yield* recordEvent("workflow-fallback", internalRunId);
      }
      const startedAtIso = yield* now;
      const running = buildLoopAnyRunningRun(currentRun, context.project.id, startedAtIso);
      if (!(yield* transitionRun(running, ["queued", "running", "waiting"]))) {
        return yield* connectorError("execution-failed", "Could not start the LoopAny run.");
      }
      currentRun = running;
      yield* recordEvent("delivery-running", internalRunId);
      const executed = yield* executeDelivery(delivery, context, fallbackModel);
      const completedAt = yield* now;
      const succeeded: IntegrationRun = {
        ...running,
        state: "succeeded",
        threadIds: [executed.result.threadId],
        outputSummary: sanitizeIntegrationRunText(executed.result.output, 16_384),
        timeline: appendIntegrationRunTimeline(running, "succeeded", completedAt),
        completedAt,
        updatedAt: completedAt,
      };
      if (!(yield* transitionRun(succeeded, ["running"]))) {
        return yield* connectorError("execution-failed", "Could not complete the LoopAny run.");
      }
      currentRun = succeeded;
      yield* recordEvent("delivery-succeeded", internalRunId);
      const taskFileContent = yield* readTaskFile(delivery.loop.taskFile, executed.context);
      yield* sendTerminalReport(delivery, serverUrl, {
        ok: true,
        durationMs: executed.durationMs,
        outcome: delivery.role === "evolve" ? "evolve" : "exec",
        finalText: clip(executed.result.output),
        sessionId: executed.result.threadId,
        ...(taskFileContent === undefined ? {} : { taskFileContent }),
      });
    });
    yield* execute.pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const finishedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
          const diagnosticCode = loopAnyDeliveryFailureDiagnostic(error);
          if (
            currentRun !== undefined &&
            currentRun.state !== "succeeded" &&
            currentRun.state !== "failed" &&
            currentRun.state !== "cancelled"
          ) {
            const completedAt = yield* now;
            const failed: IntegrationRun = {
              ...currentRun,
              state: "failed",
              failure:
                diagnosticCode === "root-rejected"
                  ? "Delivery rejected by the configured allowed-root policy."
                  : "LoopAny delivery execution failed. Inspect the linked thread when available.",
              timeline: appendIntegrationRunTimeline(currentRun, "failed", completedAt),
              completedAt,
              updatedAt: completedAt,
            };
            const persisted = yield* transitionRun(failed, ["queued", "running", "waiting"]).pipe(
              Effect.catch((_persistenceError) =>
                Effect.logWarning("LoopAny run failure could not be persisted", {
                  runId: internalRunId,
                  message: "Run failure persistence failed.",
                }),
              ),
            );
            if (persisted === true) {
              currentRun = failed;
            } else if (persisted === false) {
              yield* Effect.logWarning("LoopAny run failure lost its lifecycle transition race", {
                runId: internalRunId,
              });
            }
          }
          yield* recordEvent(diagnosticCode, internalRunId);
          yield* sendTerminalReport(delivery, serverUrl, {
            ok: false,
            durationMs: Math.max(0, finishedAt - startedAt),
            error: clip(error.message, 8_000),
          });
        }),
      ),
      Effect.onInterrupt(() => markCurrentRunInterrupted()),
      Effect.ensuring(
        Effect.sync(() => void inFlight.delete(delivery.runId)).pipe(
          Effect.andThen(
            Effect.gen(function* () {
              const updatedAt = yield* now;
              yield* updateStatus((status) => ({
                ...status,
                inFlight: inFlight.size,
                updatedAt,
              }));
            }),
          ),
        ),
      ),
    );
  });

  const pollOnce: LoopAnyConnector["Service"]["pollOnce"] = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError((cause) => connectorError("invalid-config", cause.message, cause)),
    );
    const loopAny = settings.integrations.loopAny;
    if (!loopAny.enabled) {
      const updatedAt = yield* now;
      const event = loopAnyDiagnosticEvent({
        id: NodeCrypto.randomUUID(),
        code: "connector-disabled",
        runId: null,
        occurredAt: updatedAt,
      });
      yield* updateStatusIfChanged((status) => loopAnyDisabledStatus(status, updatedAt, event));
      return 0;
    }
    const serverUrl = yield* Effect.try({
      try: () => normalizeLoopAnyServerUrl(loopAny.serverUrl),
      catch: (cause) =>
        connectorError(
          "invalid-config",
          "The persisted LoopAny server URL is unsafe. Save a valid HTTPS or loopback URL.",
          cause,
        ),
    });
    const tokenOption = yield* secrets
      .get(LOOPANY_DEVICE_TOKEN_SECRET)
      .pipe(Effect.mapError((cause) => connectorError("not-configured", cause.message, cause)));
    if (Option.isNone(tokenOption) || serverUrl.length === 0) {
      return yield* connectorError(
        "not-configured",
        "LoopAny is enabled without a server URL or device token.",
      );
    }
    const pollStartedAt = yield* now;
    yield* updateStatus((status) => loopAnyPollStartedStatus(status, pollStartedAt, inFlight.size));
    const request = HttpClientRequest.post(
      `${serverUrl}${LOOPANY_PROTOCOL_COMPATIBILITY.endpoints.poll}`,
    ).pipe(
      HttpClientRequest.bearerToken(textDecoder.decode(tokenOption.value)),
      HttpClientRequest.bodyJsonUnsafe(
        buildLoopAnyPollBody(
          {
            host: "not-codex",
            platform: hostPlatform,
            arch: hostArchitecture,
            version: "not-codex/0.0.28",
          },
          inFlight,
        ),
      ),
    );
    const response = yield* httpClient.execute(request).pipe(
      Effect.timeout(`${loopAny.pollWaitSeconds + 10} seconds`),
      Effect.mapError((cause) =>
        connectorError("connection-failed", "LoopAny poll failed.", cause),
      ),
    );
    if (response.status === 401 || response.status === 403) {
      return yield* connectorError("unauthorized", "LoopAny rejected the device token.");
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* connectorError(
        "connection-failed",
        `LoopAny poll returned HTTP ${response.status}.`,
      );
    }
    const collectedBody = yield* collectUint8StreamText({
      stream: response.stream,
      maxBytes: MAX_POLL_BODY_BYTES,
      truncatedMarker: null,
    }).pipe(
      Effect.timeout("10 seconds"),
      Effect.mapError((cause) =>
        connectorError("connection-failed", "Could not read the LoopAny poll response.", cause),
      ),
    );
    if (collectedBody.truncated) {
      return yield* connectorError(
        "validation-failed",
        "LoopAny poll response exceeded the 2 MiB local limit.",
      );
    }
    const unknownBody = yield* decodeUnknownJson(collectedBody.text).pipe(
      Effect.mapError((cause) =>
        connectorError("validation-failed", "LoopAny poll returned invalid JSON.", cause),
      ),
    );
    const body = yield* decodePollResponse(unknownBody).pipe(
      Effect.mapError((cause) =>
        connectorError("validation-failed", "LoopAny poll returned an invalid payload.", cause),
      ),
    );
    const accepted: Array<Delivery> = [];
    for (const delivery of body.deliveries) {
      if (inFlight.has(delivery.runId)) {
        yield* recordEvent("delivery-duplicate", buildLoopAnyIntegrationRunId(delivery.runId));
        continue;
      }
      inFlight.add(delivery.runId);
      accepted.push(delivery);
    }
    const succeededAt = yield* now;
    const succeededEvent = loopAnyDiagnosticEvent({
      id: NodeCrypto.randomUUID(),
      code: "poll-succeeded",
      runId: null,
      occurredAt: succeededAt,
    });
    yield* updateStatus((status) => ({
      ...status,
      health: "healthy",
      lastPollAt: succeededAt,
      lastSuccessAt: succeededAt,
      nextRetryAt: null,
      consecutiveFailures: 0,
      inFlight: inFlight.size,
      lastError: null,
      recentEvents: appendLoopAnyDiagnosticEvent(status.recentEvents, succeededEvent),
      updatedAt: succeededAt,
    }));
    // Deliveries run in scoped background fibers so a multi-minute agent turn cannot stop the
    // polling heartbeat. The semaphore preserves a predictable local concurrency ceiling.
    yield* Effect.forEach(
      accepted,
      (delivery) =>
        deliverySlots
          .withPermits(1)(
            executeAndReport(
              serverUrl,
              delivery,
              loopAny.allowedRoots,
              settings.textGenerationModelSelection,
            ),
          )
          .pipe(Effect.forkScoped),
      { discard: true },
    );
    return accepted.length;
  });

  const guardedPollOnce = pollOnce.pipe(
    Effect.tapError((error) =>
      Effect.gen(function* () {
        const occurredAt = yield* now;
        const failure = loopAnyPollFailureState(error);
        const event = loopAnyDiagnosticEvent({
          id: NodeCrypto.randomUUID(),
          code: failure.code,
          runId: null,
          occurredAt,
        });
        yield* updateStatus((status) => ({
          ...status,
          health: failure.health,
          lastPollAt: occurredAt,
          nextRetryAt: loopAnyRetryAt(occurredAt),
          consecutiveFailures: status.consecutiveFailures + 1,
          inFlight: inFlight.size,
          lastError: { code: failure.code, message: failure.message, occurredAt },
          recentEvents: appendLoopAnyDiagnosticEvent(status.recentEvents, event),
          updatedAt: occurredAt,
        }));
      }),
    ),
  );

  return LoopAnyConnector.of({ pollOnce: guardedPollOnce, status: Ref.get(statusRef) });
});

export const LoopAnyConnectorLive = Layer.effect(LoopAnyConnector, makeLoopAnyConnector);

export const LoopAnyConnectorRuntimeLive = Layer.effectDiscard(
  LoopAnyConnector.use((connector) =>
    connector.pollOnce.pipe(
      Effect.catch((error) =>
        Effect.logWarning("LoopAny connector poll failed", {
          code: error.code,
          message: loopAnyPollFailureState(error).message,
        }),
      ),
      Effect.repeat(Schedule.spaced("3 seconds")),
      Effect.forkScoped,
    ),
  ),
);
