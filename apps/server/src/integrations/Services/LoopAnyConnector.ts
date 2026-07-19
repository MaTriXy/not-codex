import type { IntegrationRequestError, LoopAnyConnectorDiagnostics } from "@notcodex/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface LoopAnyConnectorShape {
  readonly pollOnce: Effect.Effect<number, IntegrationRequestError, Scope.Scope>;
  readonly status: Effect.Effect<LoopAnyConnectorDiagnostics>;
}

export class LoopAnyConnector extends Context.Service<LoopAnyConnector, LoopAnyConnectorShape>()(
  "notcodex/integrations/Services/LoopAnyConnector",
) {}
