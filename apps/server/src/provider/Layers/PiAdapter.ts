import {
  EventId,
  type PiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  type ToolLifecycleItemType,
  TurnId,
} from "@notcodex/contracts";
import { getModelSelectionStringOptionValue } from "@notcodex/shared/model";
import type { PiRpcEvent, PiSessionState } from "effect-pi-rpc/schema";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { materializePiBridge, parsePiBridgeApproval } from "../piBridge.ts";
import { PiRuntime, type PiRuntimeProcess } from "../piRuntime.ts";
import type { PiAdapterShape } from "../Services/PiAdapter.ts";

const PROVIDER = ProviderDriverKind.make("pi");
const PI_RESUME_VERSION = 1 as const;
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

interface PiResumeCursor {
  readonly schemaVersion: typeof PI_RESUME_VERSION;
  readonly sessionId: string;
  readonly sessionFile?: string;
  readonly leafEntryId?: string;
}

interface PiTurnSnapshot {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface PendingPiUiRequest {
  readonly providerRequestId: string;
  readonly method: string;
  readonly requestType?:
    | "command_execution_approval"
    | "file_read_approval"
    | "file_change_approval"
    | "dynamic_tool_call";
}

interface PiSessionContext {
  session: ProviderSession;
  readonly process: PiRuntimeProcess;
  readonly scope: Scope.Closeable;
  readonly stopped: Ref.Ref<boolean>;
  readonly pendingUi: Map<string, PendingPiUiRequest>;
  readonly turns: Array<PiTurnSnapshot>;
  activeTurnId: TurnId | undefined;
  activeTurnResult:
    | {
        readonly state: "completed" | "failed" | "interrupted" | "cancelled";
        readonly stopReason?: string;
        readonly errorMessage?: string;
      }
    | undefined;
}

export interface PiAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

type EventBaseInput = {
  readonly threadId: ThreadId;
  readonly turnId?: TurnId | undefined;
  readonly itemId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly raw?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResumeCursor(value: unknown): PiResumeCursor | undefined {
  if (!isRecord(value) || value.schemaVersion !== PI_RESUME_VERSION) return undefined;
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) return undefined;
  return {
    schemaVersion: PI_RESUME_VERSION,
    sessionId: value.sessionId.trim(),
    ...(typeof value.sessionFile === "string" && value.sessionFile.trim()
      ? { sessionFile: value.sessionFile.trim() }
      : {}),
    ...(typeof value.leafEntryId === "string" && value.leafEntryId.trim()
      ? { leafEntryId: value.leafEntryId.trim() }
      : {}),
  };
}

function parseState(value: unknown): PiSessionState | undefined {
  if (!isRecord(value) || typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    return undefined;
  }
  return value as unknown as PiSessionState;
}

function cursorFromState(state: PiSessionState, leafEntryId?: string): PiResumeCursor {
  return {
    schemaVersion: PI_RESUME_VERSION,
    sessionId: state.sessionId,
    ...(typeof state.sessionFile === "string" && state.sessionFile.trim()
      ? { sessionFile: state.sessionFile.trim() }
      : {}),
    ...(leafEntryId ? { leafEntryId } : {}),
  };
}

function modelSlugFromState(state: PiSessionState): string | undefined {
  const model = state.model;
  return model?.provider && model.id ? `${model.provider}/${model.id}` : undefined;
}

function parseModelSlug(
  slug: string | undefined,
): { provider: string; modelId: string } | undefined {
  if (!slug) return undefined;
  const separator = slug.indexOf("/");
  if (separator <= 0 || separator === slug.length - 1) return undefined;
  return { provider: slug.slice(0, separator), modelId: slug.slice(separator + 1) };
}

function toolItemType(toolName: string): ToolLifecycleItemType {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("bash") || normalized.includes("command")) return "command_execution";
  if (normalized.includes("edit") || normalized.includes("write") || normalized.includes("patch")) {
    return "file_change";
  }
  if (normalized.includes("web")) return "web_search";
  if (normalized.includes("mcp")) return "mcp_tool_call";
  if (normalized.includes("image")) return "image_view";
  if (normalized.includes("task") || normalized.includes("agent")) {
    return "collab_agent_tool_call";
  }
  return "dynamic_tool_call";
}

function eventDetail(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.content)) {
    const text = value.content
      .filter(isRecord)
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  try {
    return JSON.stringify(value).slice(0, 20_000);
  } catch {
    return undefined;
  }
}

function messageRole(value: unknown): string | undefined {
  return isRecord(value) && typeof value.role === "string" ? value.role : undefined;
}

function messagesFromResponse(value: unknown): ReadonlyArray<unknown> {
  return isRecord(value) && Array.isArray(value.messages) ? value.messages : [];
}

function forkMessagesFromResponse(
  value: unknown,
): ReadonlyArray<{ entryId: string; text: string }> {
  if (!isRecord(value) || !Array.isArray(value.messages)) return [];
  return value.messages.flatMap((message) => {
    if (!isRecord(message) || typeof message.entryId !== "string") return [];
    return [
      { entryId: message.entryId, text: typeof message.text === "string" ? message.text : "" },
    ];
  });
}

function leafFromEntries(value: unknown): string | undefined {
  return isRecord(value) && typeof value.leafId === "string" ? value.leafId : undefined;
}

function updateSession(
  context: PiSessionContext,
  patch: Partial<ProviderSession>,
  options?: { readonly clearActiveTurnId?: boolean; readonly clearLastError?: boolean },
): Effect.Effect<ProviderSession> {
  return Effect.gen(function* () {
    const next = { ...context.session, ...patch, updatedAt: yield* nowIso } as ProviderSession &
      Record<string, unknown>;
    const mutable = next as Record<string, unknown>;
    if (options?.clearActiveTurnId) delete mutable.activeTurnId;
    if (options?.clearLastError) delete mutable.lastError;
    context.session = next;
    return next;
  });
}

export function makePiAdapter(settings: PiSettings, options?: PiAdapterLiveOptions) {
  return Effect.gen(function* () {
    const runtime = yield* PiRuntime;
    const crypto = yield* Crypto.Crypto;
    const fileSystem = yield* FileSystem.FileSystem;
    const serverConfig = yield* ServerConfig;
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("pi");
    const bridge = yield* materializePiBridge(serverConfig.stateDir).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "bridge/materialize",
            detail: `Failed to prepare the Pi permission bridge: ${String(cause)}`,
            cause,
          }),
      ),
    );
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const startSessionMutex = yield* Semaphore.make(1);
    const sessions = new Map<ThreadId, PiSessionContext>();
    const randomId = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate a Pi runtime identifier.",
            cause,
          }),
      ),
    );
    const buildEventBase = (input: EventBaseInput) =>
      Effect.all({ eventId: randomId.pipe(Effect.map(EventId.make)), createdAt: nowIso }).pipe(
        Effect.map(({ eventId, createdAt }) => ({
          eventId,
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          createdAt,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          ...(input.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
          ...(input.requestId ? { requestId: RuntimeRequestId.make(input.requestId) } : {}),
          ...(input.raw !== undefined
            ? { raw: { source: "pi.rpc" as const, payload: input.raw } }
            : {}),
        })),
      );
    const emit = (event: ProviderRuntimeEvent) =>
      Queue.offer(runtimeEvents, event).pipe(Effect.asVoid);

    const requireSession = Effect.fn("PiAdapter.requireSession")(function* (threadId: ThreadId) {
      const context = sessions.get(threadId);
      if (!context)
        return yield* new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
      if (yield* Ref.get(context.stopped)) {
        return yield* new ProviderAdapterSessionClosedError({ provider: PROVIDER, threadId });
      }
      return context;
    });

    const request = <A extends PiSessionContext>(context: A, command: Record<string, unknown>) =>
      context.process.client.request(command as { readonly type: string }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: String(command.type ?? "unknown"),
              detail:
                "detail" in cause && typeof cause.detail === "string"
                  ? cause.detail
                  : String(cause),
              cause,
            }),
        ),
      );

    const stopContext = Effect.fn("PiAdapter.stopContext")(function* (context: PiSessionContext) {
      if (yield* Ref.getAndSet(context.stopped, true)) return false;
      yield* context.process.kill;
      yield* Scope.close(context.scope, Exit.void).pipe(Effect.ignore);
      return true;
    });

    const handleEvent = Effect.fn("PiAdapter.handleEvent")(function* (
      context: PiSessionContext,
      event: PiRpcEvent,
    ) {
      if (options?.nativeEventLogger) {
        yield* options.nativeEventLogger
          .write({ observedAt: yield* nowIso, event }, context.session.threadId)
          .pipe(Effect.catchCause(() => Effect.void));
      }
      const turnId = context.activeTurnId;
      switch (event.type) {
        case "message_end": {
          const message = isRecord(event.message) ? event.message : undefined;
          if (message?.role !== "assistant" || !turnId) return;
          const stopReason =
            typeof message.stopReason === "string" ? message.stopReason : undefined;
          const errorMessage =
            typeof message.errorMessage === "string" && message.errorMessage.trim()
              ? message.errorMessage.trim()
              : undefined;
          context.activeTurnResult = {
            state:
              stopReason === "error"
                ? "failed"
                : stopReason === "aborted"
                  ? "interrupted"
                  : "completed",
            ...(stopReason ? { stopReason } : {}),
            ...(errorMessage ? { errorMessage } : {}),
          };
          return;
        }
        case "message_update": {
          const update = isRecord(event.assistantMessageEvent)
            ? event.assistantMessageEvent
            : undefined;
          const updateType = typeof update?.type === "string" ? update.type : "";
          const delta = typeof update?.delta === "string" ? update.delta : "";
          if (!delta || (updateType !== "text_delta" && updateType !== "thinking_delta")) return;
          yield* emit({
            ...(yield* buildEventBase({ threadId: context.session.threadId, turnId, raw: event })),
            type: "content.delta",
            payload: {
              streamKind: updateType === "thinking_delta" ? "reasoning_text" : "assistant_text",
              delta,
              ...(typeof update?.contentIndex === "number"
                ? { contentIndex: update.contentIndex }
                : {}),
            },
          });
          return;
        }
        case "tool_execution_start":
        case "tool_execution_update":
        case "tool_execution_end": {
          const toolCallId =
            typeof event.toolCallId === "string" ? event.toolCallId : `pi-tool-${yield* randomId}`;
          const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
          const source = event.type === "tool_execution_end" ? event.result : event.partialResult;
          const detail = eventDetail(source);
          const status =
            event.type === "tool_execution_end"
              ? event.isError === true
                ? "failed"
                : "completed"
              : "inProgress";
          const payload = {
            itemType: toolItemType(toolName),
            status,
            title: toolName,
            ...(detail ? { detail } : {}),
            data: event,
          } as const;
          if (turnId) {
            const turn = context.turns.find((candidate) => candidate.id === turnId);
            turn?.items.push(event);
          }
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              itemId: toolCallId,
              raw: event,
            })),
            type:
              event.type === "tool_execution_start"
                ? "item.started"
                : event.type === "tool_execution_end"
                  ? "item.completed"
                  : "item.updated",
            payload,
          });
          return;
        }
        case "extension_ui_request": {
          const providerRequestId = typeof event.id === "string" ? event.id : undefined;
          const method = typeof event.method === "string" ? event.method : "";
          if (!providerRequestId || !["select", "confirm", "input", "editor"].includes(method))
            return;
          const approval = parsePiBridgeApproval(event.title);
          context.pendingUi.set(providerRequestId, {
            providerRequestId,
            method,
            ...(approval ? { requestType: approval.requestType } : {}),
          });
          if (approval) {
            yield* emit({
              ...(yield* buildEventBase({
                threadId: context.session.threadId,
                turnId,
                requestId: providerRequestId,
                raw: event,
              })),
              type: "request.opened",
              payload: {
                requestType: approval.requestType,
                detail: approval.toolName,
                args: approval.args,
              },
            });
            return;
          }
          const optionsList = Array.isArray(event.options)
            ? event.options.filter((option): option is string => typeof option === "string")
            : method === "confirm"
              ? ["Yes", "No"]
              : [];
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              requestId: providerRequestId,
              raw: event,
            })),
            type: "user-input.requested",
            payload: {
              questions: [
                {
                  id: providerRequestId,
                  header: "Pi",
                  question:
                    typeof event.message === "string"
                      ? `${typeof event.title === "string" ? `${event.title}\n` : ""}${event.message}`
                      : typeof event.title === "string"
                        ? event.title
                        : "Pi requires input.",
                  options: optionsList.map((option) => ({ label: option, description: option })),
                },
              ],
            },
          });
          return;
        }
        case "agent_settled": {
          if (!turnId) return;
          const result = context.activeTurnResult ?? { state: "completed" as const };
          context.activeTurnId = undefined;
          context.activeTurnResult = undefined;
          const entries = yield* request(context, { type: "get_entries" }).pipe(Effect.option);
          const leafEntryId =
            entries._tag === "Some" ? leafFromEntries(entries.value.data) : undefined;
          const stateResponse = yield* request(context, { type: "get_state" }).pipe(Effect.option);
          const state =
            stateResponse._tag === "Some" ? parseState(stateResponse.value.data) : undefined;
          yield* updateSession(
            context,
            {
              status: result.state === "failed" ? "error" : "ready",
              ...(result.errorMessage ? { lastError: result.errorMessage } : {}),
              ...(state
                ? {
                    resumeCursor: cursorFromState(state, leafEntryId),
                    ...(modelSlugFromState(state) ? { model: modelSlugFromState(state) } : {}),
                  }
                : {}),
            },
            { clearActiveTurnId: true, clearLastError: result.state !== "failed" },
          );
          yield* emit({
            ...(yield* buildEventBase({ threadId: context.session.threadId, turnId, raw: event })),
            type: "turn.completed",
            payload: result,
          });
          if (result.state === "failed") {
            yield* emit({
              ...(yield* buildEventBase({
                threadId: context.session.threadId,
                turnId,
                raw: event,
              })),
              type: "runtime.error",
              payload: {
                message: result.errorMessage ?? "Pi model request failed.",
                class: "provider_error",
              },
            });
          }
          return;
        }
        case "extension_error": {
          const message = typeof event.error === "string" ? event.error : "Pi extension failed.";
          yield* emit({
            ...(yield* buildEventBase({ threadId: context.session.threadId, turnId, raw: event })),
            type: "runtime.error",
            payload: { message, class: "provider_error" },
          });
          return;
        }
      }
    });

    const emitUnexpectedExit = Effect.fn("PiAdapter.emitUnexpectedExit")(function* (
      context: PiSessionContext,
      detail: string,
    ) {
      if (yield* Ref.getAndSet(context.stopped, true)) return;
      sessions.delete(context.session.threadId);
      yield* emit({
        ...(yield* buildEventBase({
          threadId: context.session.threadId,
          turnId: context.activeTurnId,
        })),
        type: "runtime.error",
        payload: { message: detail, class: "transport_error" },
      }).pipe(Effect.ignore);
      yield* emit({
        ...(yield* buildEventBase({
          threadId: context.session.threadId,
          turnId: context.activeTurnId,
        })),
        type: "session.exited",
        payload: { reason: detail, recoverable: true, exitKind: "error" },
      }).pipe(Effect.ignore);
      yield* Scope.close(context.scope, Exit.void).pipe(Effect.ignore);
    });

    const startPumps = (context: PiSessionContext) =>
      Effect.all(
        [
          context.process.client.events.pipe(
            Stream.runForEach((event) => handleEvent(context, event)),
            Effect.catchCause((cause) =>
              emitUnexpectedExit(
                context,
                `Pi RPC event stream failed: ${String(Cause.squash(cause))}`,
              ),
            ),
            Effect.forkIn(context.scope),
          ),
          context.process.exitCode.pipe(
            Effect.flatMap((code) =>
              emitUnexpectedExit(context, `Pi process exited unexpectedly with code ${code}.`),
            ),
            Effect.catchCause((cause) =>
              emitUnexpectedExit(
                context,
                `Pi process exit watcher failed: ${String(Cause.squash(cause))}`,
              ),
            ),
            Effect.forkIn(context.scope),
          ),
        ],
        { discard: true },
      );

    const startSessionUnlocked: PiAdapterShape["startSession"] = Effect.fn(
      "PiAdapter.startSessionUnlocked",
    )(function* (input) {
      const existing = sessions.get(input.threadId);
      if (existing && !(yield* Ref.get(existing.stopped))) return existing.session;

      const resume = parseResumeCursor(input.resumeCursor);
      const sessionScope = yield* Scope.make();
      const startExit = yield* Effect.exit(
        Effect.gen(function* () {
          const newSessionId = resume?.sessionId ?? (yield* randomId);
          const process = yield* runtime.start({
            binaryPath: settings.binaryPath,
            cwd: input.cwd ?? serverConfig.cwd,
            environment: {
              ...options?.environment,
              ...(settings.agentDir ? { PI_CODING_AGENT_DIR: settings.agentDir } : {}),
              NOTCODEX_PI_RUNTIME_MODE: input.runtimeMode,
            },
            args: [
              "--mode",
              "rpc",
              "--extension",
              bridge.path,
              settings.projectTrust === "trust" ? "--approve" : "--no-approve",
              ...(resume
                ? ["--session", resume.sessionFile ?? resume.sessionId]
                : ["--session-id", newSessionId]),
            ],
          });
          const stateResponse = yield* process.client
            .request({ type: "get_state" })
            .pipe(Effect.timeout("10 seconds"));
          const state = parseState(stateResponse.data);
          if (!state) {
            return yield* new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: input.threadId,
              detail: "Pi RPC returned an invalid initial session state.",
            });
          }
          return { process, state };
        }).pipe(Effect.provideService(Scope.Scope, sessionScope)),
      );
      if (Exit.isFailure(startExit)) {
        yield* Scope.close(sessionScope, Exit.void).pipe(Effect.ignore);
        const cause = Cause.squash(startExit.cause);
        return yield* new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: input.threadId,
          detail: `Failed to start Pi RPC: ${String(cause)}`,
          cause,
        });
      }

      const createdAt = yield* nowIso;
      const model = input.modelSelection?.model ?? modelSlugFromState(startExit.value.state);
      const session: ProviderSession = {
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        cwd: input.cwd ?? serverConfig.cwd,
        ...(model ? { model } : {}),
        threadId: input.threadId,
        resumeCursor: cursorFromState(startExit.value.state),
        createdAt,
        updatedAt: createdAt,
      };
      const context: PiSessionContext = {
        session,
        process: startExit.value.process,
        scope: sessionScope,
        stopped: yield* Ref.make(false),
        pendingUi: new Map(),
        turns: [],
        activeTurnId: undefined,
        activeTurnResult: undefined,
      };
      sessions.set(input.threadId, context);
      yield* startPumps(context);
      yield* emit({
        ...(yield* buildEventBase({ threadId: input.threadId })),
        type: "session.started",
        payload: { message: "Pi session started", resume: session.resumeCursor },
      });
      yield* emit({
        ...(yield* buildEventBase({ threadId: input.threadId })),
        type: "thread.started",
        payload: { providerThreadId: startExit.value.state.sessionId },
      });
      return session;
    });
    const startSession: PiAdapterShape["startSession"] = (input) =>
      startSessionMutex.withPermit(startSessionUnlocked(input));

    const resolveAttachment = Effect.fn("PiAdapter.resolveAttachment")(function* (
      attachment: NonNullable<ProviderSendTurnInput["attachments"]>[number],
    ) {
      const attachmentPath = resolveAttachmentPath({
        attachmentsDir: serverConfig.attachmentsDir,
        attachment,
      });
      if (!attachmentPath) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "prompt",
          detail: `Invalid attachment id '${attachment.id}'.`,
        });
      }
      const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "prompt",
              detail: `Failed to read attachment '${attachment.name}': ${cause.message}`,
              cause,
            }),
        ),
      );
      return {
        type: "image",
        data: Buffer.from(bytes).toString("base64"),
        mimeType: attachment.mimeType,
      };
    });

    const sendTurn: PiAdapterShape["sendTurn"] = Effect.fn("PiAdapter.sendTurn")(function* (input) {
      const context = yield* requireSession(input.threadId);
      const text = input.input?.trim();
      const images = yield* Effect.forEach(input.attachments ?? [], resolveAttachment, {
        concurrency: 1,
      });
      if (!text && images.length === 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Pi turns require text input or at least one image.",
        });
      }
      const selection = input.modelSelection;
      if (selection && selection.instanceId !== boundInstanceId) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: `Pi model selection is bound to '${selection.instanceId}', expected '${boundInstanceId}'.`,
        });
      }
      const parsedModel = parseModelSlug(selection?.model ?? context.session.model);
      if (selection && !parsedModel) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Pi model selection must use the 'provider/model' format.",
        });
      }
      if (parsedModel && selection) {
        yield* request(context, {
          type: "set_model",
          provider: parsedModel.provider,
          modelId: parsedModel.modelId,
        });
      }
      const thinking = selection
        ? getModelSelectionStringOptionValue(selection, "thinking")
        : undefined;
      if (thinking) yield* request(context, { type: "set_thinking_level", level: thinking });

      const steeringTurnId = context.activeTurnId;
      const turnId = steeringTurnId ?? TurnId.make(`pi-turn-${yield* randomId}`);
      if (!steeringTurnId) context.turns.push({ id: turnId, items: [] });
      context.activeTurnId = turnId;
      if (!steeringTurnId) context.activeTurnResult = undefined;
      yield* updateSession(
        context,
        {
          status: "running",
          activeTurnId: turnId,
          ...(selection ? { model: selection.model } : {}),
        },
        { clearLastError: true },
      );
      if (!steeringTurnId) {
        yield* emit({
          ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
          type: "turn.started",
          payload: {
            model: selection?.model ?? context.session.model,
            ...(thinking ? { effort: thinking } : {}),
          },
        });
      }
      yield* request(context, {
        type: "prompt",
        message: text ?? "",
        ...(images.length > 0 ? { images } : {}),
        ...(steeringTurnId ? { streamingBehavior: "steer" } : {}),
      }).pipe(
        Effect.tapError((error) =>
          steeringTurnId
            ? Effect.void
            : Effect.gen(function* () {
                context.activeTurnId = undefined;
                context.activeTurnResult = undefined;
                yield* updateSession(
                  context,
                  { status: "ready", lastError: error.detail },
                  { clearActiveTurnId: true },
                );
                yield* emit({
                  ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
                  type: "turn.aborted",
                  payload: { reason: error.detail },
                });
              }),
        ),
      );
      return { threadId: input.threadId, turnId, resumeCursor: context.session.resumeCursor };
    });

    const interruptTurn: PiAdapterShape["interruptTurn"] = Effect.fn("PiAdapter.interruptTurn")(
      function* (threadId, requestedTurnId) {
        const context = yield* requireSession(threadId);
        yield* request(context, { type: "abort" });
        const turnId = requestedTurnId ?? context.activeTurnId;
        context.activeTurnId = undefined;
        context.activeTurnResult = undefined;
        yield* updateSession(context, { status: "ready" }, { clearActiveTurnId: true });
        if (turnId) {
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId })),
            type: "turn.aborted",
            payload: { reason: "Interrupted by user." },
          });
        }
      },
    );

    const respondToRequest: PiAdapterShape["respondToRequest"] = Effect.fn(
      "PiAdapter.respondToRequest",
    )(function* (threadId, requestId, decision) {
      const context = yield* requireSession(threadId);
      const pending = context.pendingUi.get(requestId);
      if (!pending?.requestType) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "extension_ui_response",
          detail: `Unknown Pi approval request '${requestId}'.`,
        });
      }
      context.pendingUi.delete(requestId);
      yield* context.process.client
        .notify({
          type: "extension_ui_response",
          id: pending.providerRequestId,
          ...(decision === "cancel" ? { cancelled: true } : { value: decision }),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "extension_ui_response",
                detail: String(cause),
                cause,
              }),
          ),
        );
      yield* emit({
        ...(yield* buildEventBase({ threadId, turnId: context.activeTurnId, requestId })),
        type: "request.resolved",
        payload: { requestType: pending.requestType, decision },
      });
    });

    const respondToUserInput: PiAdapterShape["respondToUserInput"] = Effect.fn(
      "PiAdapter.respondToUserInput",
    )(function* (threadId, requestId, answers) {
      const context = yield* requireSession(threadId);
      const pending = context.pendingUi.get(requestId);
      if (!pending || pending.requestType) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "extension_ui_response",
          detail: `Unknown Pi user-input request '${requestId}'.`,
        });
      }
      context.pendingUi.delete(requestId);
      const answer = answers[requestId] ?? Object.values(answers)[0];
      const text = Array.isArray(answer) ? String(answer[0] ?? "") : String(answer ?? "");
      yield* context.process.client
        .notify({
          type: "extension_ui_response",
          id: pending.providerRequestId,
          ...(pending.method === "confirm"
            ? { confirmed: text.toLowerCase() === "yes" || text === "true" }
            : text
              ? { value: text }
              : { cancelled: true }),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "extension_ui_response",
                detail: String(cause),
                cause,
              }),
          ),
        );
      yield* emit({
        ...(yield* buildEventBase({ threadId, turnId: context.activeTurnId, requestId })),
        type: "user-input.resolved",
        payload: { answers },
      });
    });

    const stopSession: PiAdapterShape["stopSession"] = Effect.fn("PiAdapter.stopSession")(
      function* (threadId) {
        const context = sessions.get(threadId);
        if (!context)
          return yield* new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
        sessions.delete(threadId);
        if (!(yield* stopContext(context))) return;
        yield* emit({
          ...(yield* buildEventBase({ threadId })),
          type: "session.exited",
          payload: { reason: "Session stopped.", recoverable: false, exitKind: "graceful" },
        });
      },
    );

    const readThread: PiAdapterShape["readThread"] = Effect.fn("PiAdapter.readThread")(
      function* (threadId) {
        const context = yield* requireSession(threadId);
        const response = yield* request(context, { type: "get_messages" });
        const turns = messagesFromResponse(response.data)
          .filter((message) => messageRole(message) === "assistant")
          .map((message, index) => ({
            id: TurnId.make(`pi-history-${index + 1}`),
            items: [message],
          }));
        return { threadId, turns };
      },
    );

    const rollbackThread: PiAdapterShape["rollbackThread"] = Effect.fn("PiAdapter.rollbackThread")(
      function* (threadId, numTurns) {
        const context = yield* requireSession(threadId);
        if (!Number.isInteger(numTurns) || numTurns <= 0) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be a positive integer.",
          });
        }
        const forkMessagesResponse = yield* request(context, { type: "get_fork_messages" });
        const forkMessages = forkMessagesFromResponse(forkMessagesResponse.data);
        const targetIndex = forkMessages.length - numTurns;
        const target = targetIndex >= 0 ? forkMessages[targetIndex] : undefined;
        if (!target) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: `Pi cannot roll back ${numTurns} turn(s) from a ${forkMessages.length}-turn session.`,
          });
        }
        yield* request(context, { type: "fork", entryId: target.entryId });
        const stateResponse = yield* request(context, { type: "get_state" });
        const entriesResponse = yield* request(context, { type: "get_entries" });
        const state = parseState(stateResponse.data);
        if (!state) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "get_state",
            detail: "Pi returned invalid state after a fork.",
          });
        }
        const cursor = cursorFromState(state, leafFromEntries(entriesResponse.data));
        context.turns.splice(Math.max(0, context.turns.length - numTurns));
        yield* updateSession(
          context,
          { resumeCursor: cursor, status: "ready" },
          { clearActiveTurnId: true },
        );
        context.activeTurnId = undefined;
        context.activeTurnResult = undefined;
        return yield* readThread(threadId);
      },
    );

    const stopAll: PiAdapterShape["stopAll"] = () =>
      Effect.gen(function* () {
        const contexts = [...sessions.values()];
        sessions.clear();
        yield* Effect.forEach(contexts, (context) => stopContext(context).pipe(Effect.ignore), {
          concurrency: "unbounded",
          discard: true,
        });
      });

    yield* Effect.addFinalizer(() =>
      stopAll().pipe(Effect.ignore, Effect.ensuring(Queue.shutdown(runtimeEvents))),
    );

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session" },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions: () =>
        Effect.sync(() => [...sessions.values()].map((context) => context.session)),
      hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
      readThread,
      rollbackThread,
      stopAll,
      get streamEvents() {
        return Stream.fromQueue(runtimeEvents);
      },
    } satisfies PiAdapterShape;
  });
}
