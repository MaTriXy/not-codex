import { AutomationRequestError } from "@notcodex/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import { AutomationRepository } from "../../persistence/Services/AutomationRepository.ts";
import { AutomationScheduler } from "../Services/AutomationScheduler.ts";
import { AutomationService } from "../Services/AutomationService.ts";

const isAutomationRequestError = Schema.is(AutomationRequestError);

const makeAutomationScheduler = Effect.gen(function* () {
  const repository = yield* AutomationRepository;
  const automations = yield* AutomationService;

  const tick = Effect.gen(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    const due = yield* repository.listDueDefinitions({ now, limit: 100 });
    let queued = 0;

    for (const definition of due) {
      if (definition.nextRunAt === null) {
        continue;
      }
      const inserted = yield* automations
        .enqueueDefinition({
          definition,
          trigger: "scheduled",
          scheduledFor: definition.nextRunAt,
        })
        .pipe(
          Effect.as(true),
          Effect.catch((error) =>
            isAutomationRequestError(error) && error.code === "run-conflict"
              ? Effect.succeed(false)
              : Effect.fail(error),
          ),
        );
      if (inserted) {
        queued += 1;
      }
      // Advance from the current clock, not the stale scheduled instant. This
      // implements the bounded run-latest missed-schedule policy.
      yield* automations.advanceSchedule({ definition, after: now });
    }

    return queued;
  }).pipe(Effect.withSpan("AutomationScheduler.tick"));

  return AutomationScheduler.of({ tick });
});

export const AutomationSchedulerLive = Layer.effect(AutomationScheduler, makeAutomationScheduler);

export const AutomationSchedulerRuntimeLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const scheduler = yield* AutomationScheduler;
    yield* scheduler.tick.pipe(
      Effect.catch((error) =>
        Effect.logError("automation scheduler tick failed").pipe(
          Effect.annotateLogs({ error: String(error) }),
        ),
      ),
      Effect.repeat(Schedule.spaced("30 seconds")),
      Effect.forkScoped,
    );
  }),
);
