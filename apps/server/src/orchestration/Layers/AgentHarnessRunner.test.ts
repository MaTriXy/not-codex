import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationThread,
  type OrchestrationThreadShell,
} from "@notcodex/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";

import { AgentHarnessRunner } from "../Services/AgentHarnessRunner.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { AgentHarnessRunnerLive } from "./AgentHarnessRunner.ts";

const timestamp = "2026-07-17T00:00:00.000Z";
const projectId = ProjectId.make("project-1");
const turnId = TurnId.make("turn-1");
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5",
};

function makeShell(
  threadId: ThreadId,
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell {
  return {
    id: threadId,
    projectId,
    title: "Integration run",
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: {
      turnId,
      state: "completed",
      requestedAt: timestamp,
      startedAt: timestamp,
      completedAt: timestamp,
      assistantMessageId: MessageId.make("message-1"),
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    session: null,
    latestUserMessageAt: timestamp,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function makeDetail(threadId: ThreadId): OrchestrationThread {
  return {
    ...makeShell(threadId),
    deletedAt: null,
    messages: [
      {
        id: MessageId.make("message-1"),
        role: "assistant",
        text: "finished from Not Codex",
        turnId,
        streaming: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
  };
}

function makeHarnessLayer(input: {
  readonly commands: OrchestrationCommand[];
  readonly shell: (threadId: ThreadId) => OrchestrationThreadShell;
}) {
  let randomByte = 0;
  const dependencies = Layer.mergeAll(
    Layer.succeed(
      Crypto.Crypto,
      Crypto.make({
        randomBytes: (size) => {
          randomByte += 1;
          return new Uint8Array(size).fill(randomByte);
        },
        digest: (_algorithm, data) => Effect.succeed(data),
      }),
    ),
    Layer.succeed(OrchestrationEngineService, {
      readEvents: () => Stream.empty,
      dispatch: (command) =>
        Effect.sync(() => {
          input.commands.push(command);
          return { sequence: input.commands.length };
        }),
      streamDomainEvents: Stream.empty,
    }),
    Layer.succeed(ProjectionSnapshotQuery, {
      getCommandReadModel: () => Effect.die("unused"),
      getSnapshot: () => Effect.die("unused"),
      getShellSnapshot: () => Effect.die("unused"),
      getArchivedShellSnapshot: () => Effect.die("unused"),
      getSnapshotSequence: () => Effect.die("unused"),
      getCounts: () => Effect.die("unused"),
      getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
      getProjectShellById: () => Effect.succeed(Option.none()),
      getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
      getThreadCheckpointContext: () => Effect.succeed(Option.none()),
      getFullThreadDiffContext: () => Effect.succeed(Option.none()),
      getThreadShellById: (threadId) => Effect.succeed(Option.some(input.shell(threadId))),
      getThreadDetailById: (threadId) => Effect.succeed(Option.some(makeDetail(threadId))),
      getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
    }),
  );
  return AgentHarnessRunnerLive.pipe(Layer.provide(dependencies));
}

describe("AgentHarnessRunner", () => {
  it("creates an ordinary thread, starts a turn, and returns the final assistant output", async () => {
    const commands: OrchestrationCommand[] = [];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const harness = yield* AgentHarnessRunner;
        return yield* harness.run({
          projectId,
          title: "[Integration] Loopy run",
          prompt: "Perform the next bounded loop step.",
          modelSelection,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          timeoutMs: 5_000,
          approvalHandling: "fail",
        });
      }).pipe(Effect.provide(makeHarnessLayer({ commands, shell: (id) => makeShell(id) }))),
    );

    expect(commands.map((command) => command.type)).toEqual(["thread.create", "thread.turn.start"]);
    expect(result.output).toBe("finished from Not Codex");
    expect(result.state).toBe("completed");
  });

  it("fails closed when an unattended integration turn requests approval", async () => {
    const commands: OrchestrationCommand[] = [];
    const threadId = ThreadId.make("thread-approval");
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const harness = yield* AgentHarnessRunner;
        return yield* harness
          .awaitTurn({ threadId, timeoutMs: 5_000, approvalHandling: "fail" })
          .pipe(Effect.flip);
      }).pipe(
        Effect.provide(
          makeHarnessLayer({
            commands,
            shell: (id) => makeShell(id, { hasPendingApprovals: true }),
          }),
        ),
      ),
    );

    expect(error.phase).toBe("waiting-for-input");
    expect(error.message).toContain("approval");
  });
});
