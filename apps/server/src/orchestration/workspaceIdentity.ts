import type {
  OrchestrationCommand,
  OrchestrationProject,
  OrchestrationReadModel,
} from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { resolveWorkspaceRootInput } from "../workspace/WorkspacePaths.ts";

export const WORKSPACE_IDENTITY_RESOLUTION_TIMEOUT = "1 second";

export class WorkspaceIdentityResolutionError extends Schema.TaggedErrorClass<WorkspaceIdentityResolutionError>()(
  "WorkspaceIdentityResolutionError",
  {
    workspaceRoot: Schema.String,
    normalizedWorkspaceRoot: Schema.String,
  },
) {
  override get message(): string {
    return `Timed out resolving workspace identity for '${this.normalizedWorkspaceRoot}'.`;
  }
}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const resolveRequired = Effect.fn("WorkspaceIdentity.resolveRequired")(function* (
    workspaceRoot: string,
  ) {
    const normalizedWorkspaceRoot = resolveWorkspaceRootInput(workspaceRoot, path);
    const resolved = yield* fileSystem.realPath(normalizedWorkspaceRoot).pipe(
      Effect.map((value) => ({ _tag: "Resolved" as const, value })),
      Effect.orElseSucceed(() => ({ _tag: "Unavailable" as const })),
      Effect.timeoutOption(WORKSPACE_IDENTITY_RESOLUTION_TIMEOUT),
    );
    if (resolved._tag === "None") {
      return yield* new WorkspaceIdentityResolutionError({
        workspaceRoot,
        normalizedWorkspaceRoot,
      });
    }
    return resolved.value._tag === "Resolved" ? resolved.value.value : normalizedWorkspaceRoot;
  });

  const resolve = Effect.fn("WorkspaceIdentity.resolve")((workspaceRoot: string) => {
    const normalizedWorkspaceRoot = resolveWorkspaceRootInput(workspaceRoot, path);
    return resolveRequired(workspaceRoot).pipe(Effect.orElseSucceed(() => normalizedWorkspaceRoot));
  });

  const canonicalizeCommand = Effect.fn("WorkspaceIdentity.canonicalizeCommand")(function* (
    command: OrchestrationCommand,
  ): Effect.fn.Return<OrchestrationCommand, WorkspaceIdentityResolutionError> {
    if (command.type === "project.create") {
      return {
        ...command,
        workspaceRoot: yield* resolveRequired(command.workspaceRoot),
      };
    }
    if (command.type === "project.meta.update" && command.workspaceRoot !== undefined) {
      return {
        ...command,
        workspaceRoot: yield* resolveRequired(command.workspaceRoot),
      };
    }
    return command;
  });

  const canonicalizeReadModel = Effect.fn("WorkspaceIdentity.canonicalizeReadModel")(function* (
    readModel: OrchestrationReadModel,
  ) {
    return {
      ...readModel,
      projects: yield* Effect.forEach(
        readModel.projects,
        (project) =>
          project.deletedAt !== null
            ? Effect.succeed(project)
            : resolve(project.workspaceRoot).pipe(
                Effect.map((workspaceRoot) => ({
                  ...project,
                  workspaceRoot,
                })),
              ),
        { concurrency: "unbounded" },
      ),
    } satisfies OrchestrationReadModel;
  });

  const canonicalizeReadModelRequired = Effect.fn(
    "WorkspaceIdentity.canonicalizeReadModelRequired",
  )(function* (readModel: OrchestrationReadModel) {
    return {
      ...readModel,
      projects: yield* Effect.forEach(
        readModel.projects,
        (project) =>
          project.deletedAt !== null
            ? Effect.succeed(project)
            : resolveRequired(project.workspaceRoot).pipe(
                Effect.map((workspaceRoot) => ({
                  ...project,
                  workspaceRoot,
                })),
              ),
        { concurrency: "unbounded" },
      ),
    } satisfies OrchestrationReadModel;
  });

  const findActiveProject = Effect.fn("WorkspaceIdentity.findActiveProject")(function* (
    projects: ReadonlyArray<OrchestrationProject>,
    workspaceRoot: string,
  ) {
    const workspaceIdentity = yield* resolveRequired(workspaceRoot);
    const activeProjects = projects.filter((project) => project.deletedAt === null);
    const projectIdentities = yield* Effect.forEach(
      activeProjects,
      (project) => resolveRequired(project.workspaceRoot),
      { concurrency: "unbounded" },
    );
    return activeProjects.find((_, index) => projectIdentities[index] === workspaceIdentity);
  });

  return {
    resolve,
    resolveRequired,
    canonicalizeCommand,
    canonicalizeReadModel,
    canonicalizeReadModelRequired,
    findActiveProject,
  } as const;
});
