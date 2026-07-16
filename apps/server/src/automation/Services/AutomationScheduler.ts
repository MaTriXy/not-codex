import type { AutomationServiceError } from "./AutomationService.ts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface AutomationSchedulerShape {
  readonly tick: Effect.Effect<number, AutomationServiceError>;
}

export class AutomationScheduler extends Context.Service<
  AutomationScheduler,
  AutomationSchedulerShape
>()("notcodex/automation/Services/AutomationScheduler") {}
