import type { IntegrationRequestError } from "@notcodex/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface LoopAnyConnectorShape {
  readonly pollOnce: Effect.Effect<number, IntegrationRequestError>;
}

export class LoopAnyConnector extends Context.Service<LoopAnyConnector, LoopAnyConnectorShape>()(
  "notcodex/integrations/Services/LoopAnyConnector",
) {}
