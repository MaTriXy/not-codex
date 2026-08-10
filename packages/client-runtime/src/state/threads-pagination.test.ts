import {
  EnvironmentId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationMessage,
  type OrchestrationThread,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadStreamItem,
} from "@notcodex/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as Persistence from "../platform/persistence.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import * as RpcSession from "../rpc/session.ts";
import type { ThreadSnapshotWindow } from "./threadSnapshotHttp.ts";
import {
  INITIAL_THREAD_USER_TURN_LIMIT,
  makeEnvironmentThreadState,
  requestOlderThreadTurns,
  ThreadSnapshotLoader,
  type EnvironmentThreadState,
} from "./threads.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-pagination"),
  label: "Pagination test",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const THREAD_ID = ThreadId.make("thread-pagination");
const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: TARGET.wsBaseUrl,
  httpAuthorization: null,
  target: TARGET,
};

function message(id: string, turnId: string, createdAt: string): OrchestrationMessage {
  return {
    id: id as OrchestrationMessage["id"],
    role: "assistant",
    text: id,
    turnId: TurnId.make(turnId),
    streaming: false,
    createdAt,
    updatedAt: createdAt,
  };
}

const OLDER_MESSAGE = message("message-old", "turn-1", "2026-08-01T00:00:00.000Z");
const RECENT_MESSAGE = message("message-recent", "turn-2", "2026-08-01T01:00:00.000Z");
const BASE_THREAD: OrchestrationThread = {
  id: THREAD_ID,
  projectId: ProjectId.make("project-pagination"),
  title: "Windowed thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "main",
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T01:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [RECENT_MESSAGE],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};
const WINDOWED_SNAPSHOT: OrchestrationThreadDetailSnapshot = {
  snapshotSequence: 10,
  thread: BASE_THREAD,
  page: { beforeCursor: "cursor-1", hasMore: true, snapshotSequence: 10 },
};
const OLDER_PAGE: OrchestrationThreadDetailSnapshot = {
  snapshotSequence: 10,
  thread: { ...BASE_THREAD, messages: [OLDER_MESSAGE] },
  page: { beforeCursor: null, hasMore: false, snapshotSequence: 10 },
};

type LoaderResponse = Option.Option<OrchestrationThreadDetailSnapshot>;

const makeHarness = Effect.fn("ThreadPaginationTest.makeHarness")(function* (options?: {
  readonly paginationCapability?: boolean;
  readonly initialResponse?: LoaderResponse;
}) {
  const inputs = yield* Queue.unbounded<OrchestrationThreadStreamItem>();
  const observed = yield* Queue.unbounded<EnvironmentThreadState>();
  const loaderWindows = yield* Ref.make<ReadonlyArray<ThreadSnapshotWindow | undefined>>([]);
  const lastSubscribeInput = yield* Ref.make<Record<string, unknown> | undefined>(undefined);
  const pendingPageResponses = yield* Queue.unbounded<Deferred.Deferred<LoaderResponse>>();
  const supervisorState = yield* SubscriptionRef.make<SupervisorConnectionState>(
    AVAILABLE_CONNECTION_STATE,
  );
  const client = {
    [ORCHESTRATION_WS_METHODS.subscribeThread]: (input: Record<string, unknown>) =>
      Stream.unwrap(Ref.set(lastSubscribeInput, input).pipe(Effect.as(Stream.fromQueue(inputs)))),
  } as unknown as WsRpcProtocolClient;
  const session: RpcSession.RpcSession = {
    client,
    initialConfig: Effect.succeed({
      threadSnapshotPagination: options?.paginationCapability !== false,
    } as never),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  const supervisorSession = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
    Option.some(session),
  );
  const prepared = yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(
    Option.some(PREPARED),
  );
  const snapshotLoader = ThreadSnapshotLoader.of({
    load: (_prepared, _threadId, window) =>
      Ref.update(loaderWindows, (current) => [...current, window]).pipe(
        Effect.andThen(
          window?.beforeCursor === undefined
            ? Effect.succeed(
                options?.initialResponse ?? Option.none<OrchestrationThreadDetailSnapshot>(),
              )
            : Deferred.make<LoaderResponse>().pipe(
                Effect.tap((deferred) => Queue.offer(pendingPageResponses, deferred)),
                Effect.flatMap(Deferred.await),
              ),
        ),
      ),
  });
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: supervisorState,
    session: supervisorSession,
    prepared,
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
  const cache = Persistence.EnvironmentCacheStore.of({
    loadShell: () => Effect.succeed(Option.none()),
    saveShell: () => Effect.void,
    loadThread: () => Effect.succeed(Option.none()),
    saveThread: () => Effect.void,
    removeThread: () => Effect.void,
    loadServerConfig: () => Effect.succeed(Option.none()),
    saveServerConfig: () => Effect.void,
    loadVcsRefs: () => Effect.succeed(Option.none()),
    saveVcsRefs: () => Effect.void,
    clear: () => Effect.void,
  });
  const threadState = yield* makeEnvironmentThreadState(THREAD_ID).pipe(
    Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    Effect.provideService(Persistence.EnvironmentCacheStore, cache),
    Effect.provideService(ThreadSnapshotLoader, snapshotLoader),
  );
  yield* SubscriptionRef.changes(threadState).pipe(
    Stream.runForEach((state) => Queue.offer(observed, state)),
    Effect.forkScoped,
  );
  const awaitState = (predicate: (state: EnvironmentThreadState) => boolean) =>
    Queue.take(observed).pipe(Effect.repeat({ until: predicate }));
  const resolveNextPage = (response: LoaderResponse) =>
    Queue.take(pendingPageResponses).pipe(
      Effect.flatMap((deferred) => Deferred.succeed(deferred, response)),
    );
  return { awaitState, resolveNextPage, loaderWindows, lastSubscribeInput };
});

describe("thread pagination state", () => {
  it.effect("windows initial loads only when the server advertises support", () =>
    Effect.gen(function* () {
      const supported = yield* makeHarness({ initialResponse: Option.some(WINDOWED_SNAPSHOT) });
      const state = yield* supported.awaitState((value) => Option.isSome(value.page));
      expect(Option.getOrThrow(state.page)).toEqual({
        beforeCursor: "cursor-1",
        hasMore: true,
        loadingOlder: false,
      });
      expect((yield* Ref.get(supported.loaderWindows))[0]?.turnLimit).toBe(
        INITIAL_THREAD_USER_TURN_LIMIT,
      );
      expect((yield* Ref.get(supported.lastSubscribeInput))?.turnLimit).toBe(
        INITIAL_THREAD_USER_TURN_LIMIT,
      );
    }),
  );

  it.effect("keeps legacy servers on full unwindowed reads", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        paginationCapability: false,
        initialResponse: Option.some({ snapshotSequence: 10, thread: BASE_THREAD }),
      });
      const state = yield* harness.awaitState((value) => Option.isSome(value.data));
      expect(Option.isNone(state.page)).toBe(true);
      expect((yield* Ref.get(harness.loaderWindows))[0]).toBeUndefined();
      expect((yield* Ref.get(harness.lastSubscribeInput))?.turnLimit).toBeUndefined();
    }),
  );

  it.effect("prepends and deduplicates older history without advancing live metadata", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ initialResponse: Option.some(WINDOWED_SNAPSHOT) });
      yield* harness.awaitState((value) => Option.isSome(value.page));
      expect(requestOlderThreadTurns(TARGET.environmentId, THREAD_ID)).toBe(true);
      yield* harness.awaitState((value) =>
        Option.match(value.page, { onNone: () => false, onSome: (page) => page.loadingOlder }),
      );
      yield* harness.resolveNextPage(
        Option.some({
          ...OLDER_PAGE,
          thread: { ...OLDER_PAGE.thread, messages: [OLDER_MESSAGE, RECENT_MESSAGE] },
        }),
      );
      const state = yield* harness.awaitState((value) =>
        Option.match(value.data, {
          onNone: () => false,
          onSome: (thread) => thread.messages.some(({ id }) => id === OLDER_MESSAGE.id),
        }),
      );
      expect(Option.getOrThrow(state.data).messages.map(({ id }) => id)).toEqual([
        "message-old",
        "message-recent",
      ]);
      expect(Option.getOrThrow(state.page)).toEqual({
        beforeCursor: null,
        hasMore: false,
        loadingOlder: false,
      });
    }),
  );
});
