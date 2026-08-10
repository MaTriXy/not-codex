import { assert, it } from "@effect/vitest";
import type { OrchestrationProjectShell, ProjectId } from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as SourceControlProvider from "../sourceControl/SourceControlProvider.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import type { PullRequestProviderApi } from "./PullRequestProvider.ts";
import * as PullRequestService from "./PullRequestService.ts";
import * as PullRequestWorkBudget from "./PullRequestWorkBudget.ts";

function project(repository: string): OrchestrationProjectShell {
  return {
    id: "p1" as ProjectId,
    title: "Not Codex",
    workspaceRoot: "/workspace",
    repositoryIdentity: {
      canonicalKey: `github.com/${repository}`,
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: `https://github.com/${repository}.git`,
      },
      provider: "github",
      displayName: repository,
    },
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };
}

function fakePullRequests(overrides: Partial<PullRequestProviderApi> = {}): PullRequestProviderApi {
  return {
    kind: "github",
    capabilities: {
      diff: true,
      comment: true,
      actions: ["merge", "ready", "draft", "close", "reopen"],
      mergeMethods: ["merge"],
      search: true,
      review: {
        inlineComment: true,
        reply: true,
        resolve: true,
        verdicts: ["comment", "approve", "request-changes"],
      },
      reviewers: { request: true, listCandidates: true },
    },
    getViewer: () => Effect.succeed("matrixy"),
    getViewerPermissions: () =>
      Effect.succeed({
        actions: ["merge", "ready", "draft", "close", "reopen"],
        comment: true,
        resolve: true,
        verdicts: ["comment", "approve", "request-changes"],
        requestReviewers: true,
      }),
    listChangeRequests: () => Effect.succeed({ items: [], truncated: false, continues: true }),
    getChangeRequest: () => Effect.die("unused"),
    getChangeRequestActivity: () => Effect.die("unused"),
    getDiff: () => Effect.die("unused"),
    runAction: () => Effect.void,
    comment: () => Effect.void,
    submitReview: () => Effect.void,
    replyToThread: () => Effect.void,
    setThreadResolution: () => Effect.void,
    listReviewerCandidates: () => Effect.succeed({ candidates: [], truncated: false }),
    setReviewerRequest: () => Effect.void,
    ...overrides,
  };
}

function sourceControlProvider(pullRequests: PullRequestProviderApi) {
  return SourceControlProvider.SourceControlProvider.of({
    kind: pullRequests.kind,
    pullRequests,
    listChangeRequests: () => Effect.die("unused"),
    getChangeRequest: () => Effect.die("unused"),
    createChangeRequest: () => Effect.die("unused"),
    getRepositoryCloneUrls: () => Effect.die("unused"),
    createRepository: () => Effect.die("unused"),
    getDefaultBranch: () => Effect.die("unused"),
    checkoutChangeRequest: () => Effect.die("unused"),
  });
}

function makeService(pullRequests: PullRequestProviderApi) {
  const provider = sourceControlProvider(pullRequests);
  const registry = SourceControlProviderRegistry.SourceControlProviderRegistry.of({
    get: () => Effect.succeed(provider),
    resolveHandle: () => Effect.die("unused"),
    resolve: () => Effect.die("unused"),
    discover: Effect.succeed([]),
  });
  return PullRequestService.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(SourceControlProviderRegistry.SourceControlProviderRegistry, registry),
        Layer.succeed(
          PullRequestWorkBudget.PullRequestWorkBudget,
          PullRequestWorkBudget.PullRequestWorkBudget.of({
            runRead: (_host, effect) => effect,
          }),
        ),
        Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
          getShellSnapshot: () =>
            Effect.succeed({
              snapshotSequence: 1,
              projects: [project("MaTriXy/not-codex")],
              threads: [],
              updatedAt: "2026-07-01T00:00:00Z",
            }),
        }),
      ),
    ),
  );
}

it.effect("binds every detail operation to the repository recorded for its project", () =>
  Effect.gen(function* () {
    const service = yield* makeService(fakePullRequests());
    const error = yield* service
      .diff({ projectId: "p1" as ProjectId, repository: "attacker/repo", number: 1 })
      .pipe(Effect.flip);

    assert.strictEqual(error._tag, "PullRequestOperationError");
  }),
);

it.effect("shares a cached listing between equivalent readers", () =>
  Effect.gen(function* () {
    let listCalls = 0;
    const service = yield* makeService(
      fakePullRequests({
        listChangeRequests: () => {
          listCalls += 1;
          return Effect.succeed({ items: [], truncated: false, continues: true });
        },
      }),
    );

    yield* service.list({ state: "open" });
    yield* service.list({ state: "open" });

    assert.strictEqual(listCalls, 1);
  }),
);
