import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ThreadId,
  type OrchestrationMessage,
} from "@notcodex/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as OrchestrationEngine from "../Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../Services/ProjectionSnapshotQuery.ts";
import {
  AgentHarnessError,
  AgentHarnessRunner,
  type AgentHarnessRunRequest,
} from "../Services/AgentHarnessRunner.ts";

const POLL_INTERVAL = "250 millis";

function harnessError(phase: string, cause: unknown, threadId?: ThreadId): AgentHarnessError {
  const message =
    cause instanceof Error && cause.message.trim().length > 0
      ? cause.message
      : `Agent harness failed during ${phase}.`;
  return new AgentHarnessError({ phase, message, ...(threadId ? { threadId } : {}), cause });
}

function lastAssistantMessage(messages: ReadonlyArray<OrchestrationMessage>): string {
  return messages.findLast((message) => message.role === "assistant")?.text ?? "";
}

export const makeAgentHarnessRunner = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;

  const uuid = (phase: string, threadId?: ThreadId) =>
    crypto.randomUUIDv4.pipe(Effect.mapError((cause) => harnessError(phase, cause, threadId)));

  const createThread: AgentHarnessRunner["Service"]["createThread"] = Effect.fn(
    "AgentHarnessRunner.createThread",
  )(function* (request) {
    const threadId = ThreadId.make(yield* uuid("create-thread-id"));
    yield* engine
      .dispatch({
        type: "thread.create",
        commandId: CommandId.make(yield* uuid("create-thread-command", threadId)),
        threadId,
        projectId: request.projectId,
        title: request.title,
        modelSelection: request.modelSelection,
        runtimeMode: request.runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: request.branch,
        worktreePath: request.worktreePath,
        createdAt: DateTime.formatIso(yield* DateTime.now),
      })
      .pipe(Effect.mapError((cause) => harnessError("create-thread", cause, threadId)));
    return threadId;
  });

  const startTurn: AgentHarnessRunner["Service"]["startTurn"] = Effect.fn(
    "AgentHarnessRunner.startTurn",
  )(function* (request) {
    yield* engine
      .dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(yield* uuid("create-turn-command", request.threadId)),
        threadId: request.threadId,
        message: {
          messageId: MessageId.make(yield* uuid("create-turn-message", request.threadId)),
          role: "user",
          text: request.prompt,
          attachments: [],
        },
        modelSelection: request.modelSelection,
        ...(request.titleSeed ? { titleSeed: request.titleSeed } : {}),
        runtimeMode: request.runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: DateTime.formatIso(yield* DateTime.now),
      })
      .pipe(Effect.mapError((cause) => harnessError("start-turn", cause, request.threadId)));
  });

  const interrupt: AgentHarnessRunner["Service"]["interrupt"] = Effect.fn(
    "AgentHarnessRunner.interrupt",
  )(function* (threadId) {
    yield* engine
      .dispatch({
        type: "thread.turn.interrupt",
        commandId: CommandId.make(yield* uuid("interrupt-command", threadId)),
        threadId,
        createdAt: DateTime.formatIso(yield* DateTime.now),
      })
      .pipe(Effect.mapError((cause) => harnessError("interrupt", cause, threadId)));
  });

  const awaitTurn: AgentHarnessRunner["Service"]["awaitTurn"] = Effect.fn(
    "AgentHarnessRunner.awaitTurn",
  )(function* (input) {
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
      return yield* harnessError(
        "validate",
        new Error("Agent harness timeout must be a positive number of milliseconds."),
        input.threadId,
      );
    }
    const startedAt = yield* DateTime.now;
    const deadline = DateTime.add(startedAt, { milliseconds: input.timeoutMs });
    while (true) {
      const shell = yield* projections
        .getThreadShellById(input.threadId)
        .pipe(Effect.mapError((cause) => harnessError("read-thread", cause, input.threadId)));
      if (Option.isSome(shell)) {
        if (shell.value.hasPendingApprovals || shell.value.hasPendingUserInput) {
          if (input.approvalHandling === "fail") {
            const reason = shell.value.hasPendingApprovals ? "approval" : "user input";
            return yield* harnessError(
              "waiting-for-input",
              new Error(`Agent harness paused for ${reason}.`),
              input.threadId,
            );
          }
        } else if (shell.value.latestTurn?.state === "completed") {
          const detail = yield* projections
            .getThreadDetailById(input.threadId)
            .pipe(Effect.mapError((cause) => harnessError("read-output", cause, input.threadId)));
          return {
            threadId: input.threadId,
            turnId: shell.value.latestTurn.turnId,
            state: "completed",
            output: Option.isSome(detail) ? lastAssistantMessage(detail.value.messages) : "",
          };
        } else if (
          shell.value.latestTurn?.state === "error" ||
          shell.value.latestTurn?.state === "interrupted"
        ) {
          return yield* harnessError(
            "turn-failed",
            new Error(`Provider turn ended in state ${shell.value.latestTurn.state}.`),
            input.threadId,
          );
        }
      }

      const current = yield* DateTime.now;
      if (DateTime.toEpochMillis(current) >= DateTime.toEpochMillis(deadline)) {
        return yield* harnessError(
          "timeout",
          new Error("Agent harness exceeded its duration limit."),
          input.threadId,
        );
      }
      yield* Effect.sleep(POLL_INTERVAL);
    }
  });

  const run: AgentHarnessRunner["Service"]["run"] = Effect.fn("AgentHarnessRunner.run")(function* (
    request: AgentHarnessRunRequest,
  ) {
    const threadId = yield* createThread(request);
    yield* Effect.try({
      try: () => request.onThreadCreated?.(threadId),
      catch: (cause) => harnessError("track-thread", cause, threadId),
    });
    yield* startTurn({
      threadId,
      prompt: request.prompt,
      modelSelection: request.modelSelection,
      runtimeMode: request.runtimeMode,
      ...(request.titleSeed ? { titleSeed: request.titleSeed } : {}),
    });
    return yield* awaitTurn({
      threadId,
      timeoutMs: request.timeoutMs,
      approvalHandling: request.approvalHandling,
    }).pipe(
      Effect.tapError(() => interrupt(threadId).pipe(Effect.ignore)),
      Effect.onInterrupt(() => interrupt(threadId).pipe(Effect.ignore)),
    );
  });

  return AgentHarnessRunner.of({ createThread, startTurn, interrupt, awaitTurn, run });
});

export const AgentHarnessRunnerLive = Layer.effect(AgentHarnessRunner, makeAgentHarnessRunner);
