import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, type OrchestrationProject } from "@notcodex/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { createEmptyReadModel } from "./projector.ts";
import * as WorkspaceIdentity from "./workspaceIdentity.ts";

const TestLayer = Layer.empty.pipe(Layer.provideMerge(NodeServices.layer));

const makeProject = (
  id: string,
  workspaceRoot: string,
  deletedAt: string | null,
): OrchestrationProject => ({
  id: ProjectId.make(id),
  title: id,
  workspaceRoot,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt,
});

it.layer(TestLayer)("WorkspaceIdentity", (it) => {
  it.effect("bounds filesystem identity resolution", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const identity = yield* WorkspaceIdentity.make.pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fileSystem,
          realPath: () => Effect.never,
        }),
      );
      const pending = yield* identity.resolve(" ./slow-workspace ").pipe(Effect.forkChild);

      yield* TestClock.adjust(WorkspaceIdentity.WORKSPACE_IDENTITY_RESOLUTION_TIMEOUT);

      expect(yield* Fiber.join(pending)).toBe(path.resolve("./slow-workspace"));
    }),
  );

  it.effect("canonicalizes active projects without touching deleted roots", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const calls = yield* Ref.make<ReadonlyArray<string>>([]);
      const identity = yield* WorkspaceIdentity.make.pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fileSystem,
          realPath: (workspaceRoot) =>
            Ref.update(calls, (current) => [...current, String(workspaceRoot)]).pipe(
              Effect.as(`/canonical${workspaceRoot}`),
            ),
        }),
      );
      const readModel = {
        ...createEmptyReadModel("2026-01-01T00:00:00.000Z"),
        projects: [
          makeProject("active", "/workspace/active", null),
          makeProject("deleted", "/workspace/deleted", "2026-01-02T00:00:00.000Z"),
        ],
      };

      const canonical = yield* identity.canonicalizeReadModel(readModel);

      expect(canonical.projects.map((project) => project.workspaceRoot)).toEqual([
        "/canonical/workspace/active",
        "/workspace/deleted",
      ]);
      expect(yield* Ref.get(calls)).toEqual(["/workspace/active"]);
    }),
  );
});
