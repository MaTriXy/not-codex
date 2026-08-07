const FULL_SHA = /^[0-9a-f]{40}$/;
const REPO_PART = /^[A-Za-z0-9_.-]+$/;

export type OpenKrittRemoteIdentity = {
  readonly repoFull: string;
  readonly commitSha: string;
  readonly dirty?: boolean;
  readonly unpushed?: boolean;
};

function repoFromParts(owner: string, repository: string): string {
  const repo = repository.replace(/\.git$/i, "");
  if (!REPO_PART.test(owner) || !REPO_PART.test(repo) || owner.length === 0 || repo.length === 0) {
    throw new Error("Invalid Open Kritt repository owner/repository.");
  }
  return `${owner}/${repo}`;
}

export function validateOpenKrittRemoteIdentity(remote: string): { readonly repoFull: string } {
  if (remote.trim() !== remote || remote.includes(" "))
    throw new Error("Invalid repository remote.");
  if (remote.includes("?") || remote.includes("#"))
    throw new Error("Repository remotes cannot contain query strings or fragments.");
  let owner: string | undefined;
  let repository: string | undefined;
  if (remote.startsWith("git@github.com:")) {
    [owner, repository] = remote.slice("git@github.com:".length).split("/", 2);
  } else if (remote.startsWith("ssh://git@github.com/")) {
    const parsed = new URL(remote);
    if (parsed.username !== "git" || parsed.hostname !== "github.com" || parsed.password !== "")
      throw new Error("Unsupported GitHub SSH remote.");
    [owner, repository] = parsed.pathname.replace(/^\//, "").split("/", 2);
  } else if (remote.startsWith("https://")) {
    const parsed = new URL(remote);
    if (
      parsed.hostname !== "github.com" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname.split("/").filter(Boolean).length !== 2
    ) {
      throw new Error("Unsupported or credential-bearing GitHub remote.");
    }
    [owner, repository] = parsed.pathname.replace(/^\//, "").split("/", 2);
  } else {
    throw new Error("Open Kritt accepts only canonical GitHub HTTPS, SSH, or SCP remotes.");
  }
  if (owner === undefined || repository === undefined || remote.includes("//open-kritt")) {
    throw new Error("Malformed GitHub repository remote.");
  }
  return { repoFull: repoFromParts(owner, repository) };
}

export function buildOpenKrittRemoteSource(input: {
  readonly remoteUrl: string;
  readonly commitSha: string;
  readonly expectedRepoFull?: string;
  readonly workspacePath?: string;
}): { readonly repoKind: "remote"; readonly repoFull: string; readonly commitSha: string } {
  if (input.workspacePath !== undefined)
    throw new Error("Open Kritt remote source cannot accept a client workspace path.");
  if (!FULL_SHA.test(input.commitSha))
    throw new Error("Open Kritt requires a full immutable commit SHA.");
  const identity = validateOpenKrittRemoteIdentity(input.remoteUrl);
  if (input.expectedRepoFull !== undefined && identity.repoFull !== input.expectedRepoFull) {
    throw new Error("Project repository does not match the scanned repository.");
  }
  return { repoKind: "remote", repoFull: identity.repoFull, commitSha: input.commitSha };
}

export async function verifyOpenKrittCommit(
  git: {
    readonly revParse: (commitSha: string) => Promise<string>;
    readonly status: () => Promise<{
      readonly dirty: boolean;
      readonly unpushed: boolean;
      readonly changedPaths?: ReadonlyArray<string>;
    }>;
  },
  commitSha: string,
): Promise<{
  readonly commitSha: string;
  readonly dirty: boolean;
  readonly unpushed: boolean;
  readonly warning: string | null;
}> {
  if (!FULL_SHA.test(commitSha))
    throw new Error("Open Kritt requires a full immutable commit SHA.");
  const objectType = await git.revParse(commitSha);
  if (objectType !== "commit") throw new Error("Selected Open Kritt revision is not a commit.");
  const state = await git.status();
  const warning =
    state.dirty || state.unpushed
      ? "Local uncommitted/unpushed changes are excluded from this immutable scan."
      : null;
  return { commitSha, dirty: state.dirty, unpushed: state.unpushed, warning };
}
