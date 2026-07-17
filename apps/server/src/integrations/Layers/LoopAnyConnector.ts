import {
  IntegrationRequestError,
  type ModelSelection,
  type OrchestrationProjectShell,
} from "@notcodex/contracts";
import { HostProcessArchitecture, HostProcessPlatform } from "@notcodex/shared/hostProcess";
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
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { AgentHarnessRunner } from "../../orchestration/Services/AgentHarnessRunner.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { LOOPANY_DEVICE_TOKEN_SECRET } from "./IntegrationService.ts";
import { LoopAnyConnector, type LoopAnyConnectorStatus } from "../Services/LoopAnyConnector.ts";

const MAX_DELIVERIES = 8;
const MAX_TASK_CHARS = 500_000;
const MAX_WORKFLOW_CHARS = 250_000;
const MAX_REPORT_TEXT_CHARS = 200_000;
const WORKFLOW_MARKER = "__NOT_CODEX_LOOPANY_RESULT__";

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
  roots: Schema.optional(Schema.Array(Schema.String.check(Schema.isMaxLength(4_096)))),
  systemPrompt: Schema.String.check(Schema.isMaxLength(MAX_TASK_CHARS)),
  task: Schema.String.check(Schema.isMaxLength(MAX_TASK_CHARS)),
});
type Delivery = typeof Delivery.Type;

const PollResponse = Schema.Struct({
  deliveries: Schema.Array(Delivery).check(Schema.isMaxLength(MAX_DELIVERIES)),
  watchDigest: Schema.optional(Schema.String),
});

const WorkflowOutput = Schema.Struct({
  message: Schema.optional(Schema.String.check(Schema.isMaxLength(MAX_REPORT_TEXT_CHARS))),
  state: Schema.optional(Schema.Unknown),
  agentCalls: Schema.Array(
    Schema.Struct({
      message: Schema.optional(Schema.String.check(Schema.isMaxLength(MAX_TASK_CHARS))),
      data: Schema.optional(Schema.Unknown),
    }),
  ),
});
type WorkflowOutput = typeof WorkflowOutput.Type;

const decodeWorkflowOutput = Schema.decodeUnknownEffect(WorkflowOutput);
const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString);
const encodeUnknownJson = Schema.encodeUnknownEffect(Schema.UnknownFromJsonString);
const encodeUnknownJsonSync = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);

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

function clip(value: string | undefined, maximum = MAX_REPORT_TEXT_CHARS): string | undefined {
  if (value === undefined) return undefined;
  return value.length <= maximum ? value : `${value.slice(0, maximum)}\n[truncated]`;
}

export function buildLoopAnyWorkflowWrapper(body: string): string {
  return `
const prev = JSON.parse(Buffer.from(process.argv[1], "base64url").toString("utf8"));
const calls = [];
const agent = (message, data) => { calls.push(data === undefined ? { message } : { message, data }); };
const tools = { call: async () => { throw new Error("tools.call is unavailable in the Not Codex LoopAny connector"); } };
const run = async (prev) => {
${body}
};
try {
  const value = await run(prev);
  const direct = typeof value === "string" ? { message: value } : (value ?? {});
  process.stdout.write("${WORKFLOW_MARKER}" + JSON.stringify({ ...direct, agentCalls: calls }));
} catch (error) {
  process.stderr.write(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}
`;
}

export const makeLoopAnyConnector = Effect.gen(function* () {
  const settingsService = yield* ServerSettingsService;
  const secrets = yield* ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;
  const harness = yield* AgentHarnessRunner;
  const projections = yield* ProjectionSnapshotQuery;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processes = yield* ProcessRunner.ProcessRunner;
  const hostPlatform = yield* HostProcessPlatform;
  const hostArchitecture = yield* HostProcessArchitecture;
  const inFlight = new Set<string>();
  const deliverySlots = yield* Semaphore.make(2);
  const statusRef = yield* Ref.make<LoopAnyConnectorStatus>({
    state: "disconnected",
    lastActivityAt: null,
    error: null,
    inFlight: 0,
  });
  const textDecoder = new TextDecoder();

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
              `Allowed LoopAny root '${root}' is unavailable.`,
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
    if (delivery.roots && delivery.roots.length > 0) {
      const deliveryRoots = yield* Effect.forEach(delivery.roots, (root) =>
        fileSystem
          .realPath(root)
          .pipe(
            Effect.mapError((cause) =>
              connectorError("invalid-config", `Delivery root '${root}' is unavailable.`, cause),
            ),
          ),
      );
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
    return { project, realWorkdir };
  });

  const runWorkflow = Effect.fn("LoopAnyConnector.runWorkflow")(function* (
    delivery: Delivery,
    cwd: string,
  ) {
    if (!delivery.loop.workflow) return undefined;
    const previousState = yield* encodeUnknownJson(delivery.prevState).pipe(
      Effect.mapError((cause) =>
        connectorError("execution-failed", "Could not encode LoopAny workflow state.", cause),
      ),
    );
    const result = yield* processes
      .run({
        command: process.execPath,
        args: [
          "--permission",
          "--disable-warning=ExperimentalWarning",
          "--eval",
          buildLoopAnyWorkflowWrapper(delivery.loop.workflow),
          Buffer.from(previousState).toString("base64url"),
        ],
        cwd,
        timeout: "15 seconds",
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: 512 * 1024,
        outputMode: "truncate",
        truncatedMarker: "\n[workflow output truncated]\n",
        env: {},
      })
      .pipe(
        Effect.mapError((cause) =>
          connectorError("execution-failed", "LoopAny workflow process failed.", cause),
        ),
      );
    if (result.timedOut) {
      return yield* connectorError("execution-failed", "LoopAny workflow exceeded 15 seconds.");
    }
    if (result.code !== 0) {
      return yield* connectorError(
        "execution-failed",
        `LoopAny workflow failed: ${clip(result.stderr, 4_000) ?? "unknown error"}`,
      );
    }
    const markerIndex = result.stdout.lastIndexOf(WORKFLOW_MARKER);
    if (markerIndex < 0) {
      return yield* connectorError(
        "execution-failed",
        "LoopAny workflow did not return a structured result.",
      );
    }
    const encoded = result.stdout.slice(markerIndex + WORKFLOW_MARKER.length);
    const unknown = yield* decodeUnknownJson(encoded).pipe(
      Effect.mapError((cause) =>
        connectorError("execution-failed", "LoopAny workflow returned invalid JSON.", cause),
      ),
    );
    return yield* decodeWorkflowOutput(unknown).pipe(
      Effect.mapError((cause) =>
        connectorError("execution-failed", "LoopAny workflow result has an invalid shape.", cause),
      ),
    );
  });

  const chooseModel = (
    project: OrchestrationProjectShell,
    fallback: ModelSelection,
    requested: string | null,
  ): ModelSelection => {
    const selected = project.defaultModelSelection ?? fallback;
    return requested ? { ...selected, model: requested } : selected;
  };

  const sendReport = Effect.fn("LoopAnyConnector.sendReport")(function* (
    serverUrl: string,
    delivery: Delivery,
    report: Record<string, unknown>,
  ) {
    const response = yield* httpClient
      .execute(
        HttpClientRequest.post(`${serverUrl}/machine/report`).pipe(
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

  const executeDelivery = Effect.fn("LoopAnyConnector.executeDelivery")(function* (
    serverUrl: string,
    delivery: Delivery,
    allowedRoots: readonly string[],
    fallbackModel: ModelSelection,
  ) {
    const startedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
    const context = yield* resolveDeliveryContext(delivery, allowedRoots);
    const workflow = yield* runWorkflow(delivery, context.realWorkdir);
    if (workflow && workflow.agentCalls.length === 0) {
      const finishedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
      yield* sendReport(serverUrl, delivery, {
        ok: true,
        durationMs: finishedAt - startedAt,
        outcome: workflow.message ? "direct" : "silent",
        ...(workflow.message ? { message: clip(workflow.message) } : {}),
        ...(workflow.state === undefined ? {} : { cursor: workflow.state }),
      });
      return;
    }
    const escalation = (workflow?.agentCalls ?? [])
      .map((call) =>
        [call.message, call.data === undefined ? undefined : encodeUnknownJsonSync(call.data)]
          .filter((part): part is string => Boolean(part))
          .join("\n"),
      )
      .filter(Boolean)
      .join("\n\n");
    const prompt = [delivery.systemPrompt, delivery.task, escalation]
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
        worktreePath: null,
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
    yield* sendReport(serverUrl, delivery, {
      ok: true,
      durationMs: finishedAt - startedAt,
      outcome: delivery.role === "evolve" ? "evolve" : "exec",
      finalText: clip(result.output),
      sessionId: result.threadId,
      ...(workflow?.state === undefined ? {} : { cursor: workflow.state }),
    });
  });

  const executeAndReport = Effect.fn("LoopAnyConnector.executeAndReport")(function* (
    serverUrl: string,
    delivery: Delivery,
    allowedRoots: readonly string[],
    fallbackModel: ModelSelection,
  ) {
    const startedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
    yield* executeDelivery(serverUrl, delivery, allowedRoots, fallbackModel).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const finishedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
          yield* sendReport(serverUrl, delivery, {
            ok: false,
            durationMs: Math.max(0, finishedAt - startedAt),
            error: clip(error.message, 8_000),
          }).pipe(Effect.catch(() => Effect.void));
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => void inFlight.delete(delivery.runId)).pipe(
          Effect.andThen(
            Ref.update(statusRef, (status) => ({
              ...status,
              inFlight: inFlight.size,
            })),
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
      yield* Ref.set(statusRef, {
        state: "disconnected",
        lastActivityAt: null,
        error: null,
        inFlight: 0,
      });
      return 0;
    }
    const tokenOption = yield* secrets
      .get(LOOPANY_DEVICE_TOKEN_SECRET)
      .pipe(Effect.mapError((cause) => connectorError("not-configured", cause.message, cause)));
    if (Option.isNone(tokenOption) || loopAny.serverUrl.length === 0) {
      return yield* connectorError(
        "not-configured",
        "LoopAny is enabled without a server URL or device token.",
      );
    }
    const serverUrl = loopAny.serverUrl.replace(/\/$/, "");
    yield* Ref.update(statusRef, (status) => ({
      ...status,
      state: status.lastActivityAt === null ? "connecting" : status.state,
      error: null,
      inFlight: inFlight.size,
    }));
    const request = HttpClientRequest.post(`${serverUrl}/api/machine/poll`).pipe(
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
    const body = yield* HttpClientResponse.schemaBodyJson(PollResponse)(response).pipe(
      Effect.mapError((cause) =>
        connectorError("connection-failed", "LoopAny poll returned an invalid payload.", cause),
      ),
    );
    const accepted = body.deliveries.filter((delivery) => {
      if (inFlight.has(delivery.runId)) return false;
      inFlight.add(delivery.runId);
      return true;
    });
    yield* Ref.set(statusRef, {
      state: "ready",
      lastActivityAt: yield* DateTime.now,
      error: null,
      inFlight: inFlight.size,
    });
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
      Ref.update(statusRef, (status) => ({
        ...status,
        state: "error" as const,
        error: error.message,
        inFlight: inFlight.size,
      })),
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
          message: error.message,
        }),
      ),
      Effect.repeat(Schedule.spaced("3 seconds")),
      Effect.forkScoped,
    ),
  ),
);
