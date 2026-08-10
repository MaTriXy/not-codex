import type { PullRequestListEntry, PullRequestListResult } from "@notcodex/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  groupPullRequestsByInvolvement,
  matchesPullRequestQuery,
  readPullRequestListSnapshot,
  writePullRequestListSnapshot,
} from "./pullRequestList.logic";

const entry = (overrides: Partial<PullRequestListEntry> = {}): PullRequestListEntry =>
  ({
    provider: "github",
    host: "github.com",
    projectId: "project-1",
    projectTitle: "Not Codex",
    repository: "matrixy/not-codex",
    number: 43,
    title: "Add the pull request browser",
    url: "https://github.com/matrixy/not-codex/pull/43",
    author: { login: "matrixy", name: "Matrixy", avatarUrl: null },
    headBranch: "feat/pull-requests",
    baseBranch: "main",
    state: "open",
    isDraft: false,
    mergeability: "mergeable",
    additions: 120,
    deletions: 12,
    createdAt: "2026-08-10T12:00:00.000Z",
    updatedAt: "2026-08-10T13:00:00.000Z",
    viewerReviewRequested: false,
    labels: [],
    ...overrides,
  }) as PullRequestListEntry;

const listResult = (entries: ReadonlyArray<PullRequestListEntry>): PullRequestListResult => ({
  viewers: { "github.com": "matrixy" },
  providers: [
    {
      host: "github.com",
      kind: "github",
      searchesOnHost: true,
      projectCount: 1,
      configured: true,
      detail: null,
    },
  ],
  entries,
  errors: [],
  truncated: false,
  nextCursors: {},
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("pull request list presentation", () => {
  it("matches the row fields people can see", () => {
    const pullRequest = entry();
    expect(matchesPullRequestQuery(pullRequest, "#43")).toBe(true);
    expect(matchesPullRequestQuery(pullRequest, "pull request browser")).toBe(true);
    expect(matchesPullRequestQuery(pullRequest, "feat/pull")).toBe(true);
    expect(matchesPullRequestQuery(pullRequest, "unrelated")).toBe(false);
  });

  it("puts authored work ahead of review requests without duplicating rows", () => {
    const authored = entry();
    const reviewing = entry({
      number: 44,
      author: { login: "octocat", name: null, avatarUrl: null },
      viewerReviewRequested: true,
    });
    const groups = groupPullRequestsByInvolvement([reviewing, authored], {
      "github.com": "matrixy",
    });
    expect(groups.map((group) => [group.key, group.entries.map((item) => item.number)])).toEqual([
      ["reviewRequested", [44]],
      ["authored", [43]],
    ]);
  });
});

describe("pull request list snapshot", () => {
  it("uses the Not Codex namespace and rejects expired data", () => {
    const storage = memoryStorage();
    writePullRequestListSnapshot(storage, "environment-1", {
      scope: "open:all",
      data: listResult([entry()]),
    });

    const key = "notcodex.pullRequests.list:environment-1";
    expect(storage.values.has(key)).toBe(true);
    expect(readPullRequestListSnapshot(storage, "environment-1")?.data.entries).toHaveLength(1);

    const stored = JSON.parse(storage.values.get(key)!) as Record<string, unknown>;
    storage.values.set(key, JSON.stringify({ ...stored, savedAt: 0 }));
    expect(readPullRequestListSnapshot(storage, "environment-1", 7 * 60 * 60 * 1_000)).toBeNull();
  });
});
