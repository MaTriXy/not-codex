import type * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import type * as Scope from "effect/Scope";

export interface OpenKrittPollTick {
  /** Number of durable runs whose state advanced during this tick. */
  readonly polled: number;
  /**
   * True when at least one upstream inspect failed for transport or protocol
   * reasons (not a 404). The runtime loop feeds this into exponential backoff so
   * an unreachable Open Kritt is not polled at the flat configured interval.
   */
  readonly failed: boolean;
}

export interface OpenKrittPollerShape {
  /** Poll persisted non-terminal scans and reconcile uncertain launch intents. */
  readonly pollOnce: Effect.Effect<OpenKrittPollTick, never, Scope.Scope>;
  readonly reconcile: Effect.Effect<number, never, Scope.Scope>;
}

export class OpenKrittPoller extends Context.Service<OpenKrittPoller, OpenKrittPollerShape>()(
  "notcodex/integrations/Services/OpenKrittPoller",
) {}
