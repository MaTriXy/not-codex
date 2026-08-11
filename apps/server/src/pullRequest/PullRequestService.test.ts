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

function project(
  repository: string,
  options: {
    readonly id?: string;
    readonly title?: string;
    readonly workspaceRoot?: string;
    readonly provider?: "github" | "gitlab" | "unknown";
    readonly host?: string;
  } = {},
): OrchestrationProjectShell {
  const provider = options.provider ?? "github";
  const host = options.host ?? (provider === "gitlab" ? "gitlab.com" : "github.com");
  return {
    id: (options.id ?? "p1") as ProjectId,
    title: options.title ?? "Not Codex",
    workspaceRoot: options.workspaceRoot ?? "/workspace",
    repositoryIdentity: {
      canonicalKey: `${host}/${repository}`,
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: `https://${host}/${repository}.git`,
      },
      provider,
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

function makeService(
  pullRequests: PullRequestProviderApi,
  options: {
    readonly projects?: ReadonlyArray<OrchestrationProjectShell>;
    readonly resolveHandle?: SourceControlProviderRegistry.SourceControlProviderRegistry["Service"]["resolveHandle"];
  } = {},
) {
  const provider = sourceControlProvider(pullRequests);
  const registry = SourceControlProviderRegistry.SourceControlProviderRegistry.of({
    get: () => Effect.succeed(provider),
    resolveHandle: options.resolveHandle ?? (() => Effect.die("unused")),
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
              projects: options.projects ?? [project("MaTriXy/not-codex")],
              threads: [],
              updatedAt: "2026-07-01T00:00:00Z",
            }),
        }),
      ),
    ),
  );
}

it.effect("refines unknown self-hosted GitLab projects before listing merge requests", () =>
  Effect.gen(function* () {
    let refinementCalls = 0;
    const selfHosted = project("group/project", {
      title: "self-hosted",
      workspaceRoot: "/gitlab",
      provider: "unknown",
      host: "code.example.test",
    });
    const service = yield* makeService(fakePullRequests({ kind: "gitlab" }), {
      projects: [
        selfHosted,
        { ...selfHosted, id: "p2" as ProjectId, workspaceRoot: "/gitlab-worktree" },
      ],
      resolveHandle: ({ context }) => {
        refinementCalls += 1;
        assert.strictEqual(context?.remoteUrl, "https://code.example.test/group/project.git");
        return Effect.succeed({
          context: { ...context!, provider: { ...context!.provider, kind: "gitlab" } },
          provider: undefined as never,
        });
      },
    });

    const result = yield* service.list({ state: "open" });

    assert.strictEqual(refinementCalls, 1);
    assert.strictEqual(result.providers[0]?.host, "code.example.test");
    assert.strictEqual(result.providers[0]?.kind, "gitlab");
  }),
);

it.effect("tries another checkout when self-hosted provider refinement stays unknown", () =>
  Effect.gen(function* () {
    const asked: string[] = [];
    const selfHosted = project("group/project", {
      workspaceRoot: "/gone",
      provider: "unknown",
      host: "code.example.test",
    });
    const service = yield* makeService(fakePullRequests({ kind: "gitlab" }), {
      projects: [selfHosted, { ...selfHosted, id: "p2" as ProjectId, workspaceRoot: "/healthy" }],
      resolveHandle: ({ cwd, context }) => {
        asked.push(cwd);
        return cwd === "/gone"
          ? Effect.succeed({ context: context!, provider: undefined as never })
          : Effect.succeed({
              context: { ...context!, provider: { ...context!.provider, kind: "gitlab" } },
              provider: undefined as never,
            });
      },
    });

    const result = yield* service.list({ state: "open" });

    assert.deepStrictEqual(asked, ["/gone", "/healthy"]);
    assert.strictEqual(result.providers[0]?.kind, "gitlab");
  }),
);

it.effect("derives a legacy repository host after provider refinement", () =>
  Effect.gen(function* () {
    const current = project("group/project", {
      workspaceRoot: "/gitlab",
      provider: "unknown",
      host: "code.example.test",
    });
    const identity = current.repositoryIdentity!;
    const legacy = {
      ...current,
      repositoryIdentity: {
        locator: identity.locator,
        provider: identity.provider,
        displayName: identity.displayName,
      },
    } as unknown as OrchestrationProjectShell;
    const service = yield* makeService(fakePullRequests({ kind: "gitlab" }), {
      projects: [legacy],
      resolveHandle: ({ context }) =>
        Effect.succeed({
          context: { ...context!, provider: { ...context!.provider, kind: "gitlab" } },
          provider: undefined as never,
        }),
    });

    const result = yield* service.list({ state: "open", host: "gitlab" });

    assert.strictEqual(result.providers[0]?.host, "gitlab");
    assert.strictEqual(result.providers[0]?.kind, "gitlab");
  }),
);

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
