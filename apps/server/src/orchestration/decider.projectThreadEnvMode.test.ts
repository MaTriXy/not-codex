import { CommandId, EventId, ProjectId, type OrchestrationEvent } from "@notcodex/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-01-01T00:00:00.000Z";
const projectId = ProjectId.make("project-env-mode");

const seedProjectCreated = (sequence: number): OrchestrationEvent => ({
  sequence,
  eventId: EventId.make(`evt-project-env-mode-${sequence}`),
  aggregateKind: "project",
  aggregateId: projectId,
  type: "project.created",
  occurredAt: now,
  commandId: CommandId.make(`cmd-project-env-mode-${sequence}`),
  causationEventId: null,
  correlationId: CommandId.make(`cmd-project-env-mode-${sequence}`),
  metadata: {},
  payload: {
    projectId,
    title: "Env mode",
    workspaceRoot: "/tmp/env-mode",
    defaultModelSelection: null,
    scripts: [],
    createdAt: now,
    updatedAt: now,
  },
});

it.layer(NodeServices.layer)("decider project defaultThreadEnvMode", (it) => {
  it.effect("sets and clears the per-project workspace default", () =>
    Effect.gen(function* () {
      const readModel = yield* projectEvent(createEmptyReadModel(now), seedProjectCreated(1));
      expect(readModel.projects[0]?.defaultThreadEnvMode).toBeNull();

      const setResult = yield* decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-project-env-mode-set"),
          projectId,
          defaultThreadEnvMode: "worktree",
        },
        readModel,
      });
      const setEvent = Array.isArray(setResult) ? setResult[0] : setResult;
      const afterSet = yield* projectEvent(readModel, { ...setEvent, sequence: 2 });
      expect(afterSet.projects[0]?.defaultThreadEnvMode).toBe("worktree");

      const clearResult = yield* decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-project-env-mode-clear"),
          projectId,
          defaultThreadEnvMode: null,
        },
        readModel: afterSet,
      });
      const clearEvent = Array.isArray(clearResult) ? clearResult[0] : clearResult;
      const afterClear = yield* projectEvent(afterSet, { ...clearEvent, sequence: 3 });
      expect(afterClear.projects[0]?.defaultThreadEnvMode).toBeNull();
    }),
  );

  it.effect("does not overwrite the workspace default on unrelated updates", () =>
    Effect.gen(function* () {
      const readModel = yield* projectEvent(createEmptyReadModel(now), seedProjectCreated(1));
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-project-env-mode-title"),
          projectId,
          title: "Renamed",
        },
        readModel,
      });
      const event = Array.isArray(result) ? result[0] : result;
      expect("defaultThreadEnvMode" in (event.payload as object)).toBe(false);
    }),
  );
});
