import {
  IntegrationRun,
  IntegrationRunId,
  type IntegrationListRunsInput,
} from "@notcodex/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type { IntegrationRunRepositoryError } from "../Errors.ts";

const LEGAL_PREVIOUS_STATES = {
  queued: [],
  running: ["queued", "running", "waiting"],
  waiting: ["running"],
  succeeded: ["running"],
  failed: ["queued", "running", "waiting"],
  cancelled: ["queued", "running", "waiting", "cancelled"],
} as const satisfies Record<IntegrationRun["state"], ReadonlyArray<IntegrationRun["state"]>>;

export function legalPreviousIntegrationRunStates(
  target: IntegrationRun["state"],
): ReadonlyArray<IntegrationRun["state"]> {
  return LEGAL_PREVIOUS_STATES[target];
}

export interface IntegrationRunRepositoryShape {
  readonly insert: (run: IntegrationRun) => Effect.Effect<void, IntegrationRunRepositoryError>;
  /** Inserts a stable external run only once and reports whether this call created it. */
  readonly insertIfAbsent: (
    run: IntegrationRun,
  ) => Effect.Effect<boolean, IntegrationRunRepositoryError>;
  readonly get: (
    id: IntegrationRunId,
  ) => Effect.Effect<Option.Option<IntegrationRun>, IntegrationRunRepositoryError>;
  readonly list: (
    input: IntegrationListRunsInput,
  ) => Effect.Effect<ReadonlyArray<IntegrationRun>, IntegrationRunRepositoryError>;
  /** Updates only when the stored state is one of `from`; this is the lifecycle's atomic guard. */
  readonly transition: (
    run: IntegrationRun,
    from: ReadonlyArray<IntegrationRun["state"]>,
  ) => Effect.Effect<boolean, IntegrationRunRepositoryError>;
  /**
   * Reopens a waiting or restart-interrupted Monkey.D.Loopy run after journal validation.
   * This deliberately does not widen the generic lifecycle transition table.
   */
  readonly recoverMonkeyLoopy: (
    run: IntegrationRun,
  ) => Effect.Effect<boolean, IntegrationRunRepositoryError>;
  readonly pruneCompletedBefore: (
    before: string,
  ) => Effect.Effect<ReadonlyArray<IntegrationRunId>, IntegrationRunRepositoryError>;
}
export class IntegrationRunRepository extends Context.Service<
  IntegrationRunRepository,
  IntegrationRunRepositoryShape
>()("notcodex/persistence/Services/IntegrationRunRepository") {}
