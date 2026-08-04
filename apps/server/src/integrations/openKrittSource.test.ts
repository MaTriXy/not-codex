import { describe, expect, it } from "vite-plus/test";

import { FULL_COMMIT_SHA } from "./test/openKrittTestFixtures.ts";
import {
  buildOpenKrittRemoteSource,
  validateOpenKrittRemoteIdentity,
  verifyOpenKrittCommit,
} from "./openKrittSource.ts";

describe("Open Kritt remote source identity", () => {
  it.each([
    ["https://github.com/Kritt-ai/open-kritt.git", "Kritt-ai/open-kritt"],
    ["git@github.com:Kritt-ai/open-kritt.git", "Kritt-ai/open-kritt"],
    ["ssh://git@github.com/Kritt-ai/open-kritt.git", "Kritt-ai/open-kritt"],
  ])("normalizes supported remote %s", (remote, expected) => {
    expect(validateOpenKrittRemoteIdentity(remote)).toMatchObject({ repoFull: expected });
  });

  it.each([
    "https://user:pass@github.com/Kritt-ai/open-kritt.git",
    "https://github.com/Kritt-ai/open-kritt.git?token=secret",
    "https://github.com/Kritt-ai/open-kritt.git#fragment",
    "https://gitlab.com/Kritt-ai/open-kritt.git",
    "github.com/Kritt-ai/open-kritt",
    "https://github.com//open-kritt.git",
    "https://github.com/Kritt-ai/open kritt.git",
  ])("rejects unsafe or unsupported remote %s", (remote) => {
    expect(() => validateOpenKrittRemoteIdentity(remote)).toThrow();
  });

  it("constructs a remote scan source with only normalized identity and a full SHA", () => {
    expect(
      buildOpenKrittRemoteSource({
        remoteUrl: "https://github.com/Kritt-ai/open-kritt.git",
        commitSha: FULL_COMMIT_SHA,
      }),
    ).toEqual({
      repoKind: "remote",
      repoFull: "Kritt-ai/open-kritt",
      commitSha: FULL_COMMIT_SHA,
    });
    expect(() =>
      buildOpenKrittRemoteSource({
        remoteUrl: "https://github.com/Kritt-ai/open-kritt.git",
        commitSha: "dabd3d5",
      }),
    ).toThrow(/full|immutable|SHA/i);
  });

  it("verifies the selected object is a commit and reports dirty/unpushed state without file content", async () => {
    const git = {
      revParse: async () => "commit",
      status: async () => ({ dirty: true, unpushed: true, changedPaths: ["src/secret.ts"] }),
    };
    await expect(verifyOpenKrittCommit(git, FULL_COMMIT_SHA)).resolves.toEqual({
      commitSha: FULL_COMMIT_SHA,
      dirty: true,
      unpushed: true,
      warning: expect.stringContaining("uncommitted/unpushed"),
    });
    const result = await verifyOpenKrittCommit(git, FULL_COMMIT_SHA);
    expect(JSON.stringify(result)).not.toContain("src/secret.ts");
  });

  it("rejects a project/repository mismatch and never accepts an arbitrary client workspace path", () => {
    expect(() =>
      buildOpenKrittRemoteSource({
        remoteUrl: "https://github.com/other-owner/other-repo.git",
        expectedRepoFull: "Kritt-ai/open-kritt",
        commitSha: FULL_COMMIT_SHA,
      }),
    ).toThrow(/project|repository|mismatch/i);
    expect(() =>
      buildOpenKrittRemoteSource({
        remoteUrl: "https://github.com/Kritt-ai/open-kritt.git",
        commitSha: FULL_COMMIT_SHA,
        workspacePath: "/Users/alice/project",
      }),
    ).toThrow(/path|workspace|client/i);
  });
});
