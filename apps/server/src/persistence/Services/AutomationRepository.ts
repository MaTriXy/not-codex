import {
  AutomationDefinition,
  AutomationId,
  AutomationRun,
  AutomationRunEvent,
  AutomationRunId,
  AutomationRunStatus,
  IsoDateTime,
  PositiveInt,
  ProjectId,
} from "@notcodex/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { AutomationRepositoryError } from "../Errors.ts";

export const ListAutomationDefinitionsInput = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
  includeDisabled: Schema.optionalKey(Schema.Boolean),
});
export type ListAutomationDefinitionsInput = typeof ListAutomationDefinitionsInput.Type;

export const ListDueAutomationDefinitionsInput = Schema.Struct({
  now: IsoDateTime,
  limit: PositiveInt,
});
export type ListDueAutomationDefinitionsInput = typeof ListDueAutomationDefinitionsInput.Type;

export const SoftDeleteAutomationDefinitionInput = Schema.Struct({
  automationId: AutomationId,
  deletedAt: IsoDateTime,
});
export type SoftDeleteAutomationDefinitionInput = typeof SoftDeleteAutomationDefinitionInput.Type;

export const ListAutomationRunsInput = Schema.Struct({
  automationId: Schema.optionalKey(AutomationId),
  status: Schema.optionalKey(AutomationRunStatus),
  limit: PositiveInt,
});
export type ListAutomationRunsInput = typeof ListAutomationRunsInput.Type;

export const ClaimAutomationRunInput = Schema.Struct({
  owner: Schema.String,
  now: IsoDateTime,
  leaseExpiresAt: IsoDateTime,
});
export type ClaimAutomationRunInput = typeof ClaimAutomationRunInput.Type;

export const RenewAutomationRunLeaseInput = Schema.Struct({
  runId: AutomationRunId,
  owner: Schema.String,
  now: IsoDateTime,
  leaseExpiresAt: IsoDateTime,
});
export type RenewAutomationRunLeaseInput = typeof RenewAutomationRunLeaseInput.Type;

export interface AutomationRepositoryShape {
  readonly upsertDefinition: (
    definition: AutomationDefinition,
  ) => Effect.Effect<void, AutomationRepositoryError>;
  readonly getDefinition: (
    automationId: AutomationId,
  ) => Effect.Effect<Option.Option<AutomationDefinition>, AutomationRepositoryError>;
  readonly listDefinitions: (
    input: ListAutomationDefinitionsInput,
  ) => Effect.Effect<ReadonlyArray<AutomationDefinition>, AutomationRepositoryError>;
  readonly listDueDefinitions: (
    input: ListDueAutomationDefinitionsInput,
  ) => Effect.Effect<ReadonlyArray<AutomationDefinition>, AutomationRepositoryError>;
  readonly softDeleteDefinition: (
    input: SoftDeleteAutomationDefinitionInput,
  ) => Effect.Effect<void, AutomationRepositoryError>;
  readonly insertRun: (
    run: AutomationRun,
  ) => Effect.Effect<Option.Option<AutomationRun>, AutomationRepositoryError>;
  readonly upsertRun: (run: AutomationRun) => Effect.Effect<void, AutomationRepositoryError>;
  readonly getRun: (
    runId: AutomationRunId,
  ) => Effect.Effect<Option.Option<AutomationRun>, AutomationRepositoryError>;
  readonly listRuns: (
    input: ListAutomationRunsInput,
  ) => Effect.Effect<ReadonlyArray<AutomationRun>, AutomationRepositoryError>;
  readonly claimNextRun: (
    input: ClaimAutomationRunInput,
  ) => Effect.Effect<Option.Option<AutomationRun>, AutomationRepositoryError>;
  readonly renewRunLease: (
    input: RenewAutomationRunLeaseInput,
  ) => Effect.Effect<Option.Option<AutomationRun>, AutomationRepositoryError>;
  readonly appendRunEvent: (
    event: AutomationRunEvent,
  ) => Effect.Effect<void, AutomationRepositoryError>;
  readonly listRunEvents: (
    runId: AutomationRunId,
  ) => Effect.Effect<ReadonlyArray<AutomationRunEvent>, AutomationRepositoryError>;
}

export class AutomationRepository extends Context.Service<
  AutomationRepository,
  AutomationRepositoryShape
>()("notcodex/persistence/Services/AutomationRepository") {}
