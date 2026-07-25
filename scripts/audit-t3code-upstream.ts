#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { collectProcessStreamAsString } from "./lib/process-output.ts";

const Revision = Schema.Struct({
  sha: Schema.String,
  tag: Schema.optional(Schema.String),
});

const CommitDisposition = Schema.Literals([
  "port",
  "already-present",
  "replaced",
  "defer",
  "reject",
]);
type CommitDisposition = typeof CommitDisposition.Type | "unclassified";

const T3CodeUpstreamState = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  source: Schema.Struct({
    repository: Schema.String,
    branch: Schema.String,
  }),
  importBaseline: Revision,
  localImport: Schema.Struct({ sha: Schema.String }),
  lastAudited: Revision,
  lastIntegrated: Revision,
  pathMappings: Schema.Array(
    Schema.Struct({
      upstreamPrefix: Schema.String,
      localPrefix: Schema.String,
    }),
  ),
  protectedPathPrefixes: Schema.Array(Schema.String),
  commitDispositions: Schema.Array(
    Schema.Struct({
      sha: Schema.String,
      disposition: CommitDisposition,
      notCodexPullRequest: Schema.optional(Schema.Number),
      notes: Schema.optional(Schema.String),
    }),
  ),
});

const T3CodeUpstreamStateFromJson = Schema.fromJsonString(T3CodeUpstreamState);
const decodeT3CodeUpstreamState = Schema.decodeUnknownEffect(T3CodeUpstreamStateFromJson);
type T3CodeUpstreamState = typeof T3CodeUpstreamState.Type;

export interface T3CodeUpstreamPathMapping {
  readonly upstreamPrefix: string;
  readonly localPrefix: string;
}

export interface T3CodeUpstreamCommit {
  readonly sha: string;
  readonly subject: string;
  readonly paths: ReadonlyArray<string>;
  readonly areas: ReadonlyArray<string>;
  readonly disposition: CommitDisposition;
}

export interface T3CodeUpstreamAuditReport {
  readonly source: string;
  readonly branch: string;
  readonly localHead: string;
  readonly from: string;
  readonly to: string;
  readonly commitCount: number;
  readonly unclassifiedCommitCount: number;
  readonly changedPathCount: number;
  readonly baselinePathOverlapCount: number;
  readonly postImportPathOverlapCount: number;
  readonly mergeConflictCount: number;
  readonly protectedPathChanges: ReadonlyArray<string>;
  readonly areaCommitCounts: Readonly<Record<string, number>>;
  readonly commits: ReadonlyArray<T3CodeUpstreamCommit>;
}

export interface AuditT3CodeUpstreamOptions {
  readonly rootDir?: string | undefined;
  readonly upstreamDir?: string | undefined;
  readonly statePath?: string | undefined;
}

export class T3CodeUpstreamStateError extends Schema.TaggedErrorClass<T3CodeUpstreamStateError>()(
  "T3CodeUpstreamStateError",
  {
    operation: Schema.Literals(["read", "parse"]),
    statePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `T3 Code upstream state operation "${this.operation}" failed for ${this.statePath}.`;
  }
}

export class T3CodeUpstreamSourceMismatchError extends Schema.TaggedErrorClass<T3CodeUpstreamSourceMismatchError>()(
  "T3CodeUpstreamSourceMismatchError",
  {
    expected: Schema.String,
    actual: Schema.String,
    upstreamDir: Schema.String,
  },
) {
  override get message(): string {
    return `The T3 Code reference at ${this.upstreamDir} points to an unexpected origin.`;
  }
}

export class T3CodeUpstreamLedgerError extends Schema.TaggedErrorClass<T3CodeUpstreamLedgerError>()(
  "T3CodeUpstreamLedgerError",
  {
    from: Schema.String,
    to: Schema.String,
    missingShas: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `The T3 Code upstream ledger is missing ${this.missingShas.length} audited commit disposition(s).`;
  }
}

export class T3CodeUpstreamGitError extends Schema.TaggedErrorClass<T3CodeUpstreamGitError>()(
  "T3CodeUpstreamGitError",
  {
    operation: Schema.String,
    cwd: Schema.String,
    argumentCount: Schema.Number,
    exitCode: Schema.optional(Schema.Number),
    stdoutLength: Schema.optional(Schema.Number),
    stderrLength: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Git operation "${this.operation}" failed while auditing T3 Code upstream.`;
  }
}

function normalizeRepositoryUrl(value: string): string {
  return value
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

export function classifyUpstreamPath(path: string): string {
  if (path.startsWith("apps/web/")) return "web";
  if (path.startsWith("apps/server/")) return "server";
  if (path.startsWith("apps/mobile/")) return "mobile";
  if (path.startsWith("apps/desktop/")) return "desktop";
  if (path.startsWith("apps/marketing/")) return "marketing";
  if (path.startsWith("packages/contracts/")) return "contracts";
  if (path.startsWith("packages/client-runtime/")) return "client-runtime";
  if (path.startsWith("packages/shared/")) return "shared";
  if (path.startsWith("scripts/")) return "scripts";
  if (path.startsWith("docs/")) return "docs";
  if (path.startsWith("assets/")) return "assets";
  if (path.startsWith(".github/")) return "ci";
  return "root-and-tooling";
}

export function parseUpstreamGitLog(output: string): ReadonlyArray<T3CodeUpstreamCommit> {
  const commits: Array<T3CodeUpstreamCommit> = [];
  let current: { sha: string; subject: string; paths: Array<string> } | undefined;

  const finishCurrent = () => {
    if (!current) return;
    commits.push({
      ...current,
      areas: [...new Set(current.paths.map(classifyUpstreamPath))].sort(),
      disposition: "unclassified",
    });
  };

  const tokens = output.split("\0");
  for (let index = 0; index < tokens.length; ) {
    const rawToken = tokens[index++] ?? "";
    if (rawToken.length === 0) continue;
    const token = rawToken.startsWith("\n") ? rawToken.slice(1) : rawToken;
    if (token === "NC-COMMIT") {
      finishCurrent();
      current = {
        sha: tokens[index++] ?? "",
        subject: tokens[index++] ?? "",
        paths: [],
      };
      continue;
    }
    const pathCount = nameStatusPathCount(token);
    if (!current || pathCount === undefined) continue;
    for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
      const path = tokens[index++];
      if (path !== undefined) current.paths.push(path);
    }
  }
  finishCurrent();
  return commits;
}

function nameStatusPathCount(status: string): 1 | 2 | undefined {
  if (/^[RC]\d+$/.test(status)) return 2;
  if (/^[ABDMRTUX]$/.test(status)) return 1;
  return undefined;
}

function applyCommitDispositions(
  commits: ReadonlyArray<T3CodeUpstreamCommit>,
  state: T3CodeUpstreamState,
): ReadonlyArray<T3CodeUpstreamCommit> {
  const dispositions = new Map(
    state.commitDispositions.map((entry) => [entry.sha, entry.disposition] as const),
  );
  return commits.map((commit) => ({
    ...commit,
    disposition: dispositions.get(commit.sha) ?? "unclassified",
  }));
}

function parseLines(output: string): ReadonlyArray<string> {
  return [...new Set(output.split(/\r?\n/).filter((path) => path.length > 0))].sort();
}

export function parseNameStatusPaths(output: string): ReadonlyArray<string> {
  const paths = new Set<string>();
  const tokens = output.split("\0");
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++] ?? "";
    const pathCount = nameStatusPathCount(status);
    if (pathCount === undefined) continue;
    for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
      const path = tokens[index++];
      if (path !== undefined) paths.add(path);
    }
  }
  return [...paths].sort();
}

export function findMissingCommitDispositions(
  auditedCommitShas: ReadonlyArray<string>,
  commitDispositions: ReadonlyArray<{ readonly sha: string }>,
): ReadonlyArray<string> {
  const dispositionShas = new Set(commitDispositions.map(({ sha }) => sha));
  return [...new Set(auditedCommitShas)].filter((sha) => !dispositionShas.has(sha)).sort();
}

export function collectCommitPaths(
  commits: ReadonlyArray<Pick<T3CodeUpstreamCommit, "paths">>,
): ReadonlyArray<string> {
  return [...new Set(commits.flatMap(({ paths }) => paths))].sort();
}

export function translateUpstreamPath(
  path: string,
  mappings: ReadonlyArray<T3CodeUpstreamPathMapping>,
): string {
  const mapping = mappings
    .filter(({ upstreamPrefix }) => path.startsWith(upstreamPrefix))
    .sort(
      (left, right) =>
        right.upstreamPrefix.length - left.upstreamPrefix.length ||
        left.upstreamPrefix.localeCompare(right.upstreamPrefix),
    )[0];
  return mapping ? `${mapping.localPrefix}${path.slice(mapping.upstreamPrefix.length)}` : path;
}

export function countPathOverlap(
  upstreamPaths: ReadonlyArray<string>,
  localPaths: ReadonlyArray<string>,
  mappings: ReadonlyArray<T3CodeUpstreamPathMapping>,
): number {
  const localPathSet = new Set(localPaths);
  return [...new Set(upstreamPaths)].reduce((count, upstreamPath) => {
    const translatedPath = translateUpstreamPath(upstreamPath, mappings);
    return count + (localPathSet.has(upstreamPath) || localPathSet.has(translatedPath) ? 1 : 0);
  }, 0);
}

function countAreas(
  commits: ReadonlyArray<T3CodeUpstreamCommit>,
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const commit of commits) {
    for (const area of commit.areas) {
      counts[area] = (counts[area] ?? 0) + 1;
    }
  }
  return Object.fromEntries(
    Object.entries(counts).sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    ),
  );
}

export function renderT3CodeUpstreamAudit(report: T3CodeUpstreamAuditReport): string {
  const lines = [
    "# T3 Code upstream audit",
    "",
    `- Source: ${report.source} (${report.branch})`,
    `- Range: ${report.from}..${report.to}`,
    `- Local head: ${report.localHead}`,
    `- Commits in range: ${report.commitCount}`,
    `- Unclassified commits: ${report.unclassifiedCommitCount}`,
    `- Changed upstream paths: ${report.changedPathCount}`,
    `- Path overlap since the T3 baseline (after configured mappings): ${report.baselinePathOverlapCount}`,
    `- Path overlap with post-import Not Codex work (after configured mappings): ${report.postImportPathOverlapCount}`,
    `- Simulated merge conflicts: ${report.mergeConflictCount}`,
    `- Protected-path changes: ${report.protectedPathChanges.length}`,
    "",
    "## Commits by affected area",
    "",
    "| Area | Commits |",
    "| --- | ---: |",
    ...Object.entries(report.areaCommitCounts).map(([area, count]) => `| ${area} | ${count} |`),
    "",
  ];

  if (report.protectedPathChanges.length > 0) {
    lines.push(
      "## Protected paths changed upstream",
      "",
      ...report.protectedPathChanges.map((path) => `- \`${path}\``),
      "",
    );
  }

  lines.push(
    "## Unclassified commits",
    "",
    ...report.commits
      .filter((commit) => commit.disposition === "unclassified")
      .map(
        (commit) =>
          `- \`${commit.sha.slice(0, 10)}\` ${commit.subject} (${commit.areas.join(", ") || "no paths"})`,
      ),
    "",
  );
  return `${lines.join("\n")}\n`;
}

const runGit = Effect.fn("auditT3CodeUpstream.runGit")(function* (
  operation: string,
  cwd: string,
  args: ReadonlyArray<string>,
  acceptedExitCodes: ReadonlyArray<number> = [0],
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const context = { operation, cwd, argumentCount: args.length } as const;
  const child = yield* spawner
    .spawn(ChildProcess.make("git", args, { cwd }))
    .pipe(Effect.mapError((cause) => new T3CodeUpstreamGitError({ ...context, cause })));
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      collectProcessStreamAsString(child.stdout),
      collectProcessStreamAsString(child.stderr),
      child.exitCode.pipe(Effect.map(Number)),
    ],
    { concurrency: "unbounded" },
  ).pipe(Effect.mapError((cause) => new T3CodeUpstreamGitError({ ...context, cause })));

  if (!acceptedExitCodes.includes(exitCode)) {
    return yield* new T3CodeUpstreamGitError({
      ...context,
      exitCode,
      stdoutLength: stdout.length,
      stderrLength: stderr.length,
    });
  }
  return { stdout: stdout.trimEnd(), exitCode };
});

const runGitScoped = (
  operation: string,
  cwd: string,
  args: ReadonlyArray<string>,
  acceptedExitCodes?: ReadonlyArray<number>,
) => runGit(operation, cwd, args, acceptedExitCodes).pipe(Effect.scoped);

const readState = Effect.fn("auditT3CodeUpstream.readState")(function* (statePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const content = yield* fs
    .readFileString(statePath)
    .pipe(
      Effect.mapError(
        (cause) => new T3CodeUpstreamStateError({ operation: "read", statePath, cause }),
      ),
    );
  return yield* decodeT3CodeUpstreamState(content).pipe(
    Effect.mapError(
      (cause) => new T3CodeUpstreamStateError({ operation: "parse", statePath, cause }),
    ),
  );
});

export const auditT3CodeUpstream = Effect.fn("auditT3CodeUpstream")(function* (
  options: AuditT3CodeUpstreamOptions = {},
) {
  const path = yield* Path.Path;
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const upstreamDir = path.resolve(rootDir, options.upstreamDir ?? ".repos/t3code-upstream");
  const statePath = path.resolve(rootDir, options.statePath ?? "docs/upstream/t3code-sync.json");
  const state: T3CodeUpstreamState = yield* readState(statePath);

  const origin = yield* runGitScoped("verify-origin", upstreamDir, ["remote", "get-url", "origin"]);
  if (normalizeRepositoryUrl(origin.stdout) !== normalizeRepositoryUrl(state.source.repository)) {
    return yield* new T3CodeUpstreamSourceMismatchError({
      expected: state.source.repository,
      actual: origin.stdout,
      upstreamDir,
    });
  }

  const upstreamBranchRef = `refs/remotes/origin/${state.source.branch}`;
  const upstreamHead = yield* runGitScoped("resolve-upstream-head", upstreamDir, [
    "rev-parse",
    "--verify",
    `${upstreamBranchRef}^{commit}`,
  ]);
  const auditRef = "refs/notcodex/upstream/t3code/audit";
  yield* runGitScoped("import-upstream-history", rootDir, [
    "fetch",
    "--no-tags",
    upstreamDir,
    `${upstreamBranchRef}:${auditRef}`,
  ]);
  const auditedCommits = yield* Effect.all(
    [
      runGitScoped("verify-audit-range", upstreamDir, [
        "merge-base",
        "--is-ancestor",
        state.lastAudited.sha,
        upstreamHead.stdout,
      ]),
      runGitScoped("verify-classified-range", upstreamDir, [
        "merge-base",
        "--is-ancestor",
        state.importBaseline.sha,
        state.lastAudited.sha,
      ]),
      runGitScoped("list-audited-commits", upstreamDir, [
        "rev-list",
        "--reverse",
        `${state.importBaseline.sha}..${state.lastAudited.sha}`,
      ]),
    ],
    { concurrency: "unbounded" },
  ).pipe(Effect.map(([, , commits]) => commits));
  const missingDispositionShas = findMissingCommitDispositions(
    parseLines(auditedCommits.stdout),
    state.commitDispositions,
  );
  if (missingDispositionShas.length > 0) {
    return yield* new T3CodeUpstreamLedgerError({
      from: state.importBaseline.sha,
      to: state.lastAudited.sha,
      missingShas: missingDispositionShas,
    });
  }

  const range = `${state.lastAudited.sha}..${upstreamHead.stdout}`;
  const [log, localHead, localBaselinePathsOutput, localImportPathsOutput] = yield* Effect.all(
    [
      runGitScoped("list-upstream-commits", upstreamDir, [
        "log",
        "--reverse",
        "--diff-merges=first-parent",
        "--format=NC-COMMIT%x00%H%x00%s%x00",
        "--name-status",
        "--find-renames",
        "--find-copies-harder",
        "-z",
        range,
      ]),
      runGitScoped("resolve-local-head", rootDir, ["rev-parse", "HEAD"]),
      runGitScoped("list-local-baseline-paths", rootDir, [
        "diff",
        "--name-status",
        "--find-renames",
        "--find-copies-harder",
        "-z",
        `${state.importBaseline.sha}..HEAD`,
      ]),
      runGitScoped("list-local-post-import-paths", rootDir, [
        "diff",
        "--name-status",
        "--find-renames",
        "--find-copies-harder",
        "-z",
        `${state.localImport.sha}..HEAD`,
      ]),
    ],
    { concurrency: "unbounded" },
  );
  const mergeTree = yield* runGitScoped(
    "simulate-merge",
    rootDir,
    ["merge-tree", "--write-tree", `--merge-base=${state.importBaseline.sha}`, "HEAD", auditRef],
    [0, 1],
  );

  const commits = applyCommitDispositions(parseUpstreamGitLog(log.stdout), state);
  const upstreamPaths = collectCommitPaths(commits);
  const localBaselinePaths = parseNameStatusPaths(localBaselinePathsOutput.stdout);
  const localImportPaths = parseNameStatusPaths(localImportPathsOutput.stdout);
  const protectedPathChanges = upstreamPaths.filter((changedPath) =>
    state.protectedPathPrefixes.some((prefix) => changedPath.startsWith(prefix)),
  );

  return {
    source: state.source.repository,
    branch: state.source.branch,
    localHead: localHead.stdout,
    from: state.lastAudited.sha,
    to: upstreamHead.stdout,
    commitCount: commits.length,
    unclassifiedCommitCount: commits.filter((commit) => commit.disposition === "unclassified")
      .length,
    changedPathCount: upstreamPaths.length,
    baselinePathOverlapCount: countPathOverlap(
      upstreamPaths,
      localBaselinePaths,
      state.pathMappings,
    ),
    postImportPathOverlapCount: countPathOverlap(
      upstreamPaths,
      localImportPaths,
      state.pathMappings,
    ),
    mergeConflictCount: mergeTree.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("CONFLICT")).length,
    protectedPathChanges,
    areaCommitCounts: countAreas(commits),
    commits,
  } satisfies T3CodeUpstreamAuditReport;
});

export const auditT3CodeUpstreamCommand = Command.make(
  "audit-t3code-upstream",
  {
    root: Flag.string("root").pipe(
      Flag.withDescription("Workspace root containing Not Codex and the ignored upstream clone."),
      Flag.optional,
    ),
    json: Flag.boolean("json").pipe(
      Flag.withDescription("Print the audit report as JSON instead of Markdown."),
      Flag.withDefault(false),
    ),
  },
  ({ root, json }) =>
    auditT3CodeUpstream({ rootDir: Option.getOrUndefined(root) }).pipe(
      Effect.flatMap((report) =>
        Console.log(json ? JSON.stringify(report, null, 2) : renderT3CodeUpstreamAudit(report)),
      ),
    ),
).pipe(
  Command.withDescription(
    "Audit unclassified T3 Code commits without modifying source files or sync state.",
  ),
);

if (import.meta.main) {
  Command.run(auditT3CodeUpstreamCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
