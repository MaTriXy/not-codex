import {
  AutomationId,
  AutomationRequestError,
  AutomationRunEventId,
  AutomationRunId,
  type AutomationDefinition,
  type AutomationDefinitionSnapshot,
  type AutomationRun,
  type AutomationRunEvent,
  type AutomationRunTrigger,
} from "@notcodex/contracts";
import { nextAutomationRunAt } from "@notcodex/shared/automationSchedule";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { AutomationRepository } from "../../persistence/Services/AutomationRepository.ts";
import { AUTOMATION_TEMPLATES } from "../templates.ts";
import { AutomationEventBus } from "../Services/AutomationEventBus.ts";
import { AutomationService, type AutomationServiceShape } from "../Services/AutomationService.ts";

const TERMINAL_STATUSES = new Set<AutomationRun["status"]>([
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
]);

function requestError(code: string, message: string): AutomationRequestError {
  return new AutomationRequestError({ code, message });
}

function definitionSnapshot(
  definition: AutomationDefinition,
  capturedAt: string,
): AutomationDefinitionSnapshot {
  return {
    id: definition.id,
    projectId: definition.projectId,
    name: definition.name,
    description: definition.description,
    enabled: definition.enabled,
    prompt: definition.prompt,
    modelSelection: definition.modelSelection,
    runtimeMode: definition.runtimeMode,
    schedule: definition.schedule,
    execution: definition.execution,
    completion: definition.completion,
    retry: definition.retry,
    publish: definition.publish,
    notifications: definition.notifications,
    capturedAt,
  };
}

function nextRunAt(
  definition: Pick<AutomationDefinition, "enabled" | "schedule">,
  now: DateTime.Utc,
) {
  if (!definition.enabled) {
    return Effect.succeed(null);
  }
  return Effect.try({
    try: () => nextAutomationRunAt(definition.schedule, now),
    catch: (cause) =>
      requestError(
        "invalid-schedule",
        cause instanceof Error ? cause.message : "The automation schedule is invalid.",
      ),
  });
}

const makeAutomationService = Effect.gen(function* () {
  const repository = yield* AutomationRepository;
  const eventBus = yield* AutomationEventBus;
  const crypto = yield* Crypto.Crypto;
  const randomUuid = crypto.randomUUIDv4.pipe(
    Effect.mapError(() =>
      requestError("identifier-generation-failed", "Could not generate an identifier."),
    ),
  );

  const getRequiredDefinition = Effect.fn("AutomationService.getRequiredDefinition")(function* (
    id: AutomationId,
  ) {
    const definition = yield* repository.getDefinition(id);
    if (Option.isNone(definition)) {
      return yield* requestError("definition-not-found", `Automation ${id} was not found.`);
    }
    return definition.value;
  });

  const getRequiredRun = Effect.fn("AutomationService.getRequiredRun")(function* (
    id: AutomationRunId,
  ) {
    const run = yield* repository.getRun(id);
    if (Option.isNone(run)) {
      return yield* requestError("run-not-found", `Automation run ${id} was not found.`);
    }
    return run.value;
  });

  const publishRun = (run: AutomationRun) => eventBus.publish({ type: "run-upserted", run });

  const appendEvent = Effect.fn("AutomationService.appendEvent")(function* (
    run: AutomationRun,
    kind: AutomationRunEvent["kind"],
    message: string | null,
    payload: unknown,
    createdAt: string,
  ) {
    const event: AutomationRunEvent = {
      id: AutomationRunEventId.make(yield* randomUuid),
      runId: run.id,
      kind,
      message,
      payload,
      createdAt,
    };
    yield* repository.appendRunEvent(event);
    yield* eventBus.publish({ type: "run-event-appended", event });
  });

  const makeQueuedRun = Effect.fn("AutomationService.makeQueuedRun")(function* (
    definition: AutomationDefinition,
    trigger: AutomationRunTrigger,
    scheduledFor: string,
    now: string,
    attempt = 1,
  ) {
    return {
      id: AutomationRunId.make(yield* randomUuid),
      automationId: definition.id,
      definitionSnapshot: definitionSnapshot(definition, now),
      trigger,
      status: "queued",
      scheduledFor,
      attempt,
      threadId: null,
      turnId: null,
      worktreePath: null,
      branch: null,
      baseRevision: null,
      headRevision: null,
      pullRequestUrl: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      startedAt: null,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    } satisfies AutomationRun;
  });

  const insertRun = Effect.fn("AutomationService.insertRun")(function* (run: AutomationRun) {
    const inserted = yield* repository.insertRun(run);
    if (Option.isNone(inserted)) {
      return yield* requestError(
        "run-conflict",
        "This automation already has an active or duplicate scheduled run.",
      );
    }
    yield* appendEvent(inserted.value, "queued", "Automation run queued.", {}, run.createdAt);
    yield* publishRun(inserted.value);
    return inserted.value;
  });

  const enqueueDefinition: AutomationServiceShape["enqueueDefinition"] = ({
    definition,
    trigger,
    scheduledFor,
    attempt = 1,
  }) =>
    Effect.gen(function* () {
      const now = DateTime.formatIso(yield* DateTime.now);
      return yield* insertRun(
        yield* makeQueuedRun(definition, trigger, scheduledFor, now, attempt),
      );
    });

  const advanceSchedule: AutomationServiceShape["advanceSchedule"] = ({ definition, after }) =>
    Effect.gen(function* () {
      const afterDateTime = DateTime.makeUnsafe(after);
      const next = yield* nextRunAt(definition, afterDateTime);
      const updated: AutomationDefinition = {
        ...definition,
        enabled: definition.schedule.type === "once" && next === null ? false : definition.enabled,
        nextRunAt: next,
        updatedAt: DateTime.formatIso(yield* DateTime.now),
      };
      yield* repository.upsertDefinition(updated);
      yield* eventBus.publish({ type: "definition-upserted", definition: updated });
      return updated;
    });

  return AutomationService.of({
    listDefinitions: (input) =>
      repository.listDefinitions({
        ...input,
        includeDisabled: input.includeDisabled ?? true,
      }),
    getDefinition: ({ id }) => repository.getDefinition(id).pipe(Effect.map(Option.getOrNull)),
    createDefinition: (input) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const nowIso = DateTime.formatIso(now);
        const definition: AutomationDefinition = {
          ...input,
          id: AutomationId.make(yield* randomUuid),
          nextRunAt: yield* nextRunAt(input, now),
          createdAt: nowIso,
          updatedAt: nowIso,
          deletedAt: null,
        };
        yield* repository.upsertDefinition(definition);
        yield* eventBus.publish({ type: "definition-upserted", definition });
        return definition;
      }),
    updateDefinition: ({ id, patch }) =>
      Effect.gen(function* () {
        const current = yield* getRequiredDefinition(id);
        const now = yield* DateTime.now;
        const updated: AutomationDefinition = {
          ...current,
          ...patch,
          id,
          updatedAt: DateTime.formatIso(now),
          nextRunAt: yield* nextRunAt(
            {
              enabled: patch.enabled ?? current.enabled,
              schedule: patch.schedule ?? current.schedule,
            },
            now,
          ),
        };
        yield* repository.upsertDefinition(updated);
        yield* eventBus.publish({ type: "definition-upserted", definition: updated });
        return updated;
      }),
    deleteDefinition: ({ id }) =>
      Effect.gen(function* () {
        yield* getRequiredDefinition(id);
        const deletedAt = DateTime.formatIso(yield* DateTime.now);
        yield* repository.softDeleteDefinition({ automationId: id, deletedAt });
        yield* eventBus.publish({ type: "definition-deleted", automationId: id });
      }),
    runNow: ({ id }) =>
      Effect.gen(function* () {
        const definition = yield* getRequiredDefinition(id);
        const now = DateTime.formatIso(yield* DateTime.now);
        return yield* enqueueDefinition({ definition, trigger: "manual", scheduledFor: now });
      }),
    cancelRun: ({ runId }) =>
      Effect.gen(function* () {
        const current = yield* getRequiredRun(runId);
        if (TERMINAL_STATUSES.has(current.status)) {
          return current;
        }
        const now = DateTime.formatIso(yield* DateTime.now);
        const cancelled: AutomationRun = {
          ...current,
          status: "cancelled",
          leaseOwner: null,
          leaseExpiresAt: null,
          finishedAt: now,
          updatedAt: now,
        };
        yield* repository.upsertRun(cancelled);
        yield* appendEvent(cancelled, "cancelled", "Automation run cancelled.", {}, now);
        yield* publishRun(cancelled);
        return cancelled;
      }),
    retryRun: ({ runId }) =>
      Effect.gen(function* () {
        const previous = yield* getRequiredRun(runId);
        if (!TERMINAL_STATUSES.has(previous.status)) {
          return yield* requestError("run-not-terminal", "Only a terminal run can be retried.");
        }
        const definition = yield* getRequiredDefinition(previous.automationId);
        const now = DateTime.formatIso(yield* DateTime.now);
        return yield* enqueueDefinition({
          definition,
          trigger: "retry",
          scheduledFor: now,
          attempt: previous.attempt + 1,
        });
      }),
    listRuns: (input) =>
      repository.listRuns({
        ...input,
        limit: input.limit ?? 50,
      }),
    getRun: ({ runId }) =>
      Effect.gen(function* () {
        const run = yield* repository.getRun(runId);
        if (Option.isNone(run)) {
          return null;
        }
        return { run: run.value, events: yield* repository.listRunEvents(runId) };
      }),
    listTemplates: () => Effect.succeed(AUTOMATION_TEMPLATES),
    enqueueDefinition,
    advanceSchedule,
    updateRun: (run) => repository.upsertRun(run).pipe(Effect.andThen(publishRun(run))),
    appendRunEvent: (input) =>
      appendEvent(input.run, input.kind, input.message, input.payload, input.createdAt),
    get changes() {
      return eventBus.changes;
    },
  } satisfies AutomationServiceShape);
});

export const AutomationServiceLive = Layer.effect(AutomationService, makeAutomationService);
