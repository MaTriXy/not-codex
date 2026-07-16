import type { AutomationChange } from "@notcodex/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

export interface AutomationEventBusShape {
  readonly publish: (change: AutomationChange) => Effect.Effect<void>;
  readonly changes: Stream.Stream<AutomationChange>;
}

export class AutomationEventBus extends Context.Service<
  AutomationEventBus,
  AutomationEventBusShape
>()("notcodex/automation/Services/AutomationEventBus") {}
