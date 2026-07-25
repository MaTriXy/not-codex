import type {
  OrchestrationCommand,
  OrchestrationProject,
  OrchestrationReadModel,
} from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export const WORKSPACE_IDENTITY_RESOLUTION_TIMEOUT = "1 second";

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const resolve = Effect.fn("WorkspaceIdentity.resolve")(function* (workspaceRoot: string) {
    const normalizedWorkspaceRoot = path.resolve(workspaceRoot.trim());
    return yield* fileSystem.realPath(normalizedWorkspaceRoot).pipe(
      Effect.timeoutOption(WORKSPACE_IDENTITY_RESOLUTION_TIMEOUT),
      Effect.map((resolved) =>
        resolved._tag === "Some" ? resolved.value : normalizedWorkspaceRoot,
      ),
      Effect.orElseSucceed(() => normalizedWorkspaceRoot),
    );
  });

  const canonicalizeCommand = Effect.fn("WorkspaceIdentity.canonicalizeCommand")(function* (
    command: OrchestrationCommand,
  ): Effect.fn.Return<OrchestrationCommand> {
    if (command.type === "project.create") {
      return {
        ...command,
        workspaceRoot: yield* resolve(command.workspaceRoot),
      };
    }
    if (command.type === "project.meta.update" && command.workspaceRoot !== undefined) {
      return {
        ...command,
        workspaceRoot: yield* resolve(command.workspaceRoot),
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

  const findActiveProject = Effect.fn("WorkspaceIdentity.findActiveProject")(function* (
    projects: ReadonlyArray<OrchestrationProject>,
    workspaceRoot: string,
  ) {
    const workspaceIdentity = yield* resolve(workspaceRoot);
    const activeProjects = projects.filter((project) => project.deletedAt === null);
    const projectIdentities = yield* Effect.forEach(
      activeProjects,
      (project) => resolve(project.workspaceRoot),
      { concurrency: "unbounded" },
    );
    return activeProjects.find((_, index) => projectIdentities[index] === workspaceIdentity);
  });

  return { resolve, canonicalizeCommand, canonicalizeReadModel, findActiveProject } as const;
});
