import type { IntegrationRequestError } from "@notcodex/contracts";
import * as Context from "effect/Context";
import type * as DateTime from "effect/DateTime";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface LoopAnyConnectorStatus {
  readonly state: "disconnected" | "connecting" | "ready" | "error";
  readonly lastActivityAt: DateTime.Utc | null;
  readonly error: string | null;
  readonly inFlight: number;
}

export interface LoopAnyConnectorShape {
  readonly pollOnce: Effect.Effect<number, IntegrationRequestError, Scope.Scope>;
  readonly status: Effect.Effect<LoopAnyConnectorStatus>;
}

export class LoopAnyConnector extends Context.Service<LoopAnyConnector, LoopAnyConnectorShape>()(
  "notcodex/integrations/Services/LoopAnyConnector",
) {}
