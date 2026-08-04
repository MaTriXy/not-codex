import {
  IntegrationRun,
  IntegrationRunId,
  type LoopAnyConnectorDiagnostics,
  type IntegrationListRunsInput,
} from "@notcodex/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type { IntegrationRunRepositoryError } from "../Errors.ts";

const LEGAL_PREVIOUS_STATES = {
  // A queued run may receive an authoritative launch-resolution or upstream
  // phase update without leaving the queued state. This is important for
  // uncertain POST outcomes: metadata can be persisted while the run remains
  // safe to reconcile and cannot be mistaken for a terminal result.
  queued: ["queued"],
  running: ["queued", "running", "waiting"],
  // `queued` is included because a launch can become non-terminal but unresolved
  // before it ever runs: an uncertain POST, or an upstream launch-policy question
  // the user has not answered yet. Both must be representable as waiting rather
  // than as a silently-still-queued run, or the uncertainty is invisible.
  // `waiting` is included so re-answering an unresolved launch stays idempotent.
  waiting: ["queued", "running", "waiting"],
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
    expected: Pick<IntegrationRun, "state" | "failure">,
  ) => Effect.Effect<boolean, IntegrationRunRepositoryError>;
  readonly pruneCompletedBefore: (
    before: string,
  ) => Effect.Effect<ReadonlyArray<IntegrationRunId>, IntegrationRunRepositoryError>;
  readonly getLoopAnyConnectorDiagnostics: () => Effect.Effect<
    Option.Option<LoopAnyConnectorDiagnostics>,
    IntegrationRunRepositoryError
  >;
  readonly putLoopAnyConnectorDiagnostics: (
    diagnostics: LoopAnyConnectorDiagnostics,
  ) => Effect.Effect<void, IntegrationRunRepositoryError>;
}
export class IntegrationRunRepository extends Context.Service<
  IntegrationRunRepository,
  IntegrationRunRepositoryShape
>()("notcodex/persistence/Services/IntegrationRunRepository") {}
