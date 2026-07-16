import type { AutomationRun } from "@notcodex/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class AutomationExecutionError extends Schema.TaggedErrorClass<AutomationExecutionError>()(
  "AutomationExecutionError",
  {
    phase: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface AutomationExecutorShape {
  readonly tick: () => Effect.Effect<number, AutomationExecutionError>;
  readonly executeRun: (run: AutomationRun) => Effect.Effect<void, AutomationExecutionError>;
}

export class AutomationExecutor extends Context.Service<
  AutomationExecutor,
  AutomationExecutorShape
>()("notcodex/automation/Services/AutomationExecutor") {}
