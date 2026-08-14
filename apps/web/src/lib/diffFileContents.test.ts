import type { FileDiffMetadata } from "@pierre/diffs";
import {
  EnvironmentId,
  ProjectId,
  type PullRequestDiffFileContentsResult,
} from "@notcodex/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { createPullRequestDiffFileContentsLoader } from "./diffFileContents";

const SOURCE = {
  environmentId: EnvironmentId.make("environment-1"),
  reference: {
    projectId: ProjectId.make("project-1"),
    repository: "matrixy/not-codex",
    number: 43,
  },
  commit: "abc123",
  cacheKey: "comparison-1",
};

function fileDiff(type: FileDiffMetadata["type"] = "rename-changed"): FileDiffMetadata {
  return {
    type,
    prevName: "a/src/old-name.ts",
    name: "b/src/new-name.ts",
  } as FileDiffMetadata;
}

describe("createPullRequestDiffFileContentsLoader", () => {
  it("loads both sides with normalized paths and comparison-scoped cache keys", async () => {
    const getDiffFileContents = vi.fn(async () =>
      AsyncResult.success({ oldContents: "before\n", newContents: "after\n" }),
    );
    const load = createPullRequestDiffFileContentsLoader(getDiffFileContents, SOURCE);

    await expect(load(fileDiff())).resolves.toEqual({
      oldFile: {
        name: "src/old-name.ts",
        contents: "before\n",
        cacheKey: "comparison-1:old:src/old-name.ts",
      },
      newFile: {
        name: "src/new-name.ts",
        contents: "after\n",
        cacheKey: "comparison-1:new:src/new-name.ts",
      },
    });
    expect(getDiffFileContents).toHaveBeenCalledWith({
      environmentId: "environment-1",
      input: {
        projectId: "project-1",
        repository: "matrixy/not-codex",
        number: 43,
        commit: "abc123",
        changeType: "rename-changed",
        oldPath: "src/old-name.ts",
        newPath: "src/new-name.ts",
      },
    });
  });

  it("loads a pure rename from its one shared file", async () => {
    const getDiffFileContents = vi.fn(async () =>
      AsyncResult.success({ oldContents: "same\n", newContents: "same\n" }),
    );
    const load = createPullRequestDiffFileContentsLoader(getDiffFileContents, SOURCE);

    await expect(load(fileDiff("rename-pure"))).resolves.toMatchObject({
      oldFile: null,
      newFile: { name: "src/new-name.ts", contents: "same\n" },
    });
  });

  it("passes command failures through to Pierre's expansion handling", async () => {
    const failure = new Error("revision is not available locally");
    const getDiffFileContents = vi.fn(async () =>
      AsyncResult.failure<PullRequestDiffFileContentsResult, Error>(Cause.fail(failure)),
    );
    const load = createPullRequestDiffFileContentsLoader(getDiffFileContents, SOURCE);

    await expect(load(fileDiff())).rejects.toBe(failure);
  });
});
