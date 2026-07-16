import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { AutomationEventBus } from "../Services/AutomationEventBus.ts";

export const AutomationEventBusLive = Layer.effect(
  AutomationEventBus,
  Effect.gen(function* () {
    const pubsub =
      yield* PubSub.unbounded<Parameters<AutomationEventBus["Service"]["publish"]>[0]>();
    return AutomationEventBus.of({
      publish: (change) => PubSub.publish(pubsub, change).pipe(Effect.asVoid),
      get changes() {
        return Stream.fromPubSub(pubsub);
      },
    });
  }),
);
