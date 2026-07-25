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
import { fromYaml } from "@notcodex/shared/schemaYaml";

import { referenceRepos, type ReferenceRepo } from "./lib/reference-repos.ts";
import { collectProcessStreamAsString } from "./lib/process-output.ts";

export type ReferenceRepoSyncAction = "clone" | "update";

export interface ReferenceRepoSyncOptions {
  readonly rootDir?: string | undefined;
  readonly repoId?: string | undefined;
  readonly latest?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
}

export interface ReferenceRepoSyncPlan {
  readonly repo: ReferenceRepo;
  readonly action: ReferenceRepoSyncAction;
  readonly ref: string;
  readonly commands: ReadonlyArray<ReadonlyArray<string>>;
}

export class ReferenceRepoSelectionError extends Schema.TaggedErrorClass<ReferenceRepoSelectionError>()(
  "ReferenceRepoSelectionError",
  {
    repoId: Schema.String,
    expectedRepoIds: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `Unknown reference repo "${this.repoId}". Expected one of: ${this.expectedRepoIds.join(", ")}.`;
  }
}

export class ReferenceRepoRefSourceError extends Schema.TaggedErrorClass<ReferenceRepoRefSourceError>()(
  "ReferenceRepoRefSourceError",
  {
    operation: Schema.Literals(["read", "parse"]),
    repoId: Schema.String,
    sourcePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Reference repo "${this.repoId}" ref source operation "${this.operation}" failed for ${this.sourcePath}.`;
  }
}

export class ReferenceRepoRefResolutionError extends Schema.TaggedErrorClass<ReferenceRepoRefResolutionError>()(
  "ReferenceRepoRefResolutionError",
  {
    repoId: Schema.String,
    sourcePath: Schema.String,
    valuePath: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `No ref was found for reference repo "${this.repoId}" at ${this.sourcePath}:${this.valuePath.join(".")}.`;
  }
}

export class ReferenceRepoGitError extends Schema.TaggedErrorClass<ReferenceRepoGitError>()(
  "ReferenceRepoGitError",
  {
    operation: Schema.Literals(["spawn", "communicate", "exit"]),
    repoId: Schema.String,
    action: Schema.Literals(["clone", "update"]),
    repository: Schema.String,
    ref: Schema.String,
    rootDir: Schema.String,
    argumentCount: Schema.Number,
    exitCode: Schema.optional(Schema.Number),
    stdoutLength: Schema.optional(Schema.Number),
    stderrLength: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Git ${this.action} for local reference repo "${this.repoId}" failed during "${this.operation}".`;
  }
}

export const ReferenceRepoSyncError = Schema.Union([
  ReferenceRepoSelectionError,
  ReferenceRepoRefSourceError,
  ReferenceRepoRefResolutionError,
  ReferenceRepoGitError,
]);
export type ReferenceRepoSyncError = typeof ReferenceRepoSyncError.Type;
export const isReferenceRepoSyncError = Schema.is(ReferenceRepoSyncError);

const decodeJsonSource = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString);
const decodeYamlSource = Schema.decodeEffect(fromYaml(Schema.Unknown));

function readNestedString(input: unknown, keys: ReadonlyArray<string>): string | undefined {
  let value = input;
  for (const key of keys) {
    if (typeof value !== "object" || value === null || !(key in value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function decodeRefSource(
  repo: ReferenceRepo,
  sourcePath: string,
  content: string,
): Effect.Effect<unknown, ReferenceRepoSyncError> {
  const decode =
    repo.refSource.sourcePath.endsWith(".yaml") || repo.refSource.sourcePath.endsWith(".yml")
      ? decodeYamlSource
      : decodeJsonSource;
  return decode(content).pipe(
    Effect.mapError(
      (cause) =>
        new ReferenceRepoRefSourceError({
          operation: "parse",
          repoId: repo.id,
          sourcePath,
          cause,
        }),
    ),
  );
}

function getSelectedRepos(
  repoId: string | undefined,
): Effect.Effect<ReadonlyArray<ReferenceRepo>, ReferenceRepoSyncError> {
  if (!repoId) {
    return Effect.succeed(referenceRepos.filter((repo) => repo.includeInDefaultSync));
  }

  const repo = referenceRepos.find((candidate) => candidate.id === repoId);
  return repo
    ? Effect.succeed([repo])
    : Effect.fail(
        new ReferenceRepoSelectionError({
          repoId,
          expectedRepoIds: referenceRepos.map((candidate) => candidate.id),
        }),
      );
}

export const resolveReferenceRepoRef = Effect.fn("resolveReferenceRepoRef")(function* (
  repo: ReferenceRepo,
  rootDir: string,
  latest: boolean,
) {
  if (latest) {
    return repo.latestRef;
  }

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const refSourcePath = path.join(rootDir, repo.refSource.sourcePath);
  const refSourceContent = yield* fs.readFileString(refSourcePath).pipe(
    Effect.mapError(
      (cause) =>
        new ReferenceRepoRefSourceError({
          operation: "read",
          repoId: repo.id,
          sourcePath: refSourcePath,
          cause,
        }),
    ),
  );
  const refSource = yield* decodeRefSource(repo, refSourcePath, refSourceContent);
  const ref = readNestedString(refSource, repo.refSource.valuePath);

  if (!ref) {
    return yield* new ReferenceRepoRefResolutionError({
      repoId: repo.id,
      sourcePath: refSourcePath,
      valuePath: repo.refSource.valuePath,
    });
  }

  return `${repo.refSource.tagPrefix ?? ""}${ref}`;
});

export const planReferenceRepoSync = Effect.fn("planReferenceRepoSync")(function* (
  repo: ReferenceRepo,
  rootDir: string,
  latest: boolean,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const action: ReferenceRepoSyncAction = (yield* fs.exists(path.join(rootDir, repo.prefix)))
    ? "update"
    : "clone";
  const ref = yield* resolveReferenceRepoRef(repo, rootDir, latest);
  if (repo.history === "full" && !latest) {
    const commands =
      action === "clone"
        ? [
            ["clone", repo.repository, repo.prefix],
            ["-C", repo.prefix, "checkout", "--detach", ref],
          ]
        : [
            ["-C", repo.prefix, "fetch", "origin"],
            ["-C", repo.prefix, "checkout", "--detach", ref],
          ];
    return { repo, action, ref, commands } satisfies ReferenceRepoSyncPlan;
  }

  const cloneArgs = ["clone"];
  const fetchArgs = ["-C", repo.prefix, "fetch"];
  if (repo.history === "shallow") {
    cloneArgs.push("--depth=1");
    fetchArgs.push("--depth=1");
  }
  cloneArgs.push("--branch", ref, repo.repository, repo.prefix);
  fetchArgs.push("origin", ref);
  const commands =
    action === "clone"
      ? [cloneArgs]
      : [fetchArgs, ["-C", repo.prefix, "checkout", "--detach", "FETCH_HEAD"]];

  return {
    repo,
    action,
    ref,
    commands,
  } satisfies ReferenceRepoSyncPlan;
});

const runGit = Effect.fn("runGit")(function* (rootDir: string, plan: ReferenceRepoSyncPlan) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  for (const args of plan.commands) {
    const errorContext = {
      repoId: plan.repo.id,
      action: plan.action,
      repository: plan.repo.repository,
      ref: plan.ref,
      rootDir,
      argumentCount: args.length,
    } as const;
    const child = yield* spawner
      .spawn(ChildProcess.make("git", args, { cwd: rootDir }))
      .pipe(
        Effect.mapError(
          (cause) => new ReferenceRepoGitError({ ...errorContext, operation: "spawn", cause }),
        ),
      );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectProcessStreamAsString(child.stdout),
        collectProcessStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) => new ReferenceRepoGitError({ ...errorContext, operation: "communicate", cause }),
      ),
    );

    if (exitCode !== 0) {
      return yield* new ReferenceRepoGitError({
        ...errorContext,
        operation: "exit",
        exitCode,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      });
    }

    if (stdout.trim().length > 0) {
      yield* Console.log(stdout.trim());
    }
  }
});

export const syncReferenceRepos = Effect.fn("syncReferenceRepos")(function* (
  options: ReferenceRepoSyncOptions = {},
) {
  const path = yield* Path.Path;
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const repos = yield* getSelectedRepos(options.repoId);
  const plans: Array<ReferenceRepoSyncPlan> = [];

  for (const repo of repos) {
    const plan = yield* planReferenceRepoSync(repo, rootDir, options.latest ?? false);
    plans.push(plan);
    yield* Console.log(
      `Syncing ignored local reference ${repo.id} from ${plan.ref} (${plan.action}).`,
    );
    if (!(options.dryRun ?? false)) {
      yield* runGit(rootDir, plan).pipe(Effect.scoped);
    }
  }

  return plans;
});

export const syncReferenceReposCommand = Command.make(
  "sync-reference-repos",
  {
    repo: Flag.string("repo").pipe(
      Flag.withDescription("Sync only the named reference repo. Defaults to all configured repos."),
      Flag.optional,
    ),
    latest: Flag.boolean("latest").pipe(
      Flag.withDescription(
        "Sync each repo from its latest branch instead of the installed version.",
      ),
      Flag.withDefault(false),
    ),
    root: Flag.string("root").pipe(
      Flag.withDescription("Workspace root used to resolve versions and local clone paths."),
      Flag.optional,
    ),
    dryRun: Flag.boolean("dry-run").pipe(
      Flag.withDescription("Print planned local clone operations without running git."),
      Flag.withDefault(false),
    ),
  },
  ({ repo, latest, root, dryRun }) =>
    syncReferenceRepos({
      repoId: Option.getOrUndefined(repo),
      rootDir: Option.getOrUndefined(root),
      latest,
      dryRun,
    }),
).pipe(Command.withDescription("Sync ignored, read-only reference repositories under .repos/."));

if (import.meta.main) {
  Command.run(syncReferenceReposCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
