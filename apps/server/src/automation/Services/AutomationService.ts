import type {
  AutomationCancelRunInput,
  AutomationChange,
  AutomationCreateDefinitionInput,
  AutomationDefinition,
  AutomationDeleteDefinitionInput,
  AutomationGetDefinitionInput,
  AutomationGetRunInput,
  AutomationListDefinitionsInput,
  AutomationListRunsInput,
  AutomationRequestError,
  AutomationRetryRunInput,
  AutomationRun,
  AutomationRunDetail,
  AutomationRunEventKind,
  AutomationRunNowInput,
  AutomationRunTrigger,
  AutomationTemplate,
  AutomationUpdateDefinitionInput,
} from "@notcodex/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { AutomationRepositoryError } from "../../persistence/Errors.ts";

export type AutomationServiceError = AutomationRequestError | AutomationRepositoryError;

export interface AutomationServiceShape {
  readonly listDefinitions: (
    input: AutomationListDefinitionsInput,
  ) => Effect.Effect<ReadonlyArray<AutomationDefinition>, AutomationServiceError>;
  readonly getDefinition: (
    input: AutomationGetDefinitionInput,
  ) => Effect.Effect<AutomationDefinition | null, AutomationServiceError>;
  readonly createDefinition: (
    input: AutomationCreateDefinitionInput,
  ) => Effect.Effect<AutomationDefinition, AutomationServiceError>;
  readonly updateDefinition: (
    input: AutomationUpdateDefinitionInput,
  ) => Effect.Effect<AutomationDefinition, AutomationServiceError>;
  readonly deleteDefinition: (
    input: AutomationDeleteDefinitionInput,
  ) => Effect.Effect<void, AutomationServiceError>;
  readonly runNow: (
    input: AutomationRunNowInput,
  ) => Effect.Effect<AutomationRun, AutomationServiceError>;
  readonly cancelRun: (
    input: AutomationCancelRunInput,
  ) => Effect.Effect<AutomationRun, AutomationServiceError>;
  readonly retryRun: (
    input: AutomationRetryRunInput,
  ) => Effect.Effect<AutomationRun, AutomationServiceError>;
  readonly listRuns: (
    input: AutomationListRunsInput,
  ) => Effect.Effect<ReadonlyArray<AutomationRun>, AutomationServiceError>;
  readonly getRun: (
    input: AutomationGetRunInput,
  ) => Effect.Effect<AutomationRunDetail | null, AutomationServiceError>;
  readonly listTemplates: () => Effect.Effect<ReadonlyArray<AutomationTemplate>>;
  readonly enqueueDefinition: (input: {
    readonly definition: AutomationDefinition;
    readonly trigger: AutomationRunTrigger;
    readonly scheduledFor: string;
    readonly attempt?: number;
  }) => Effect.Effect<AutomationRun, AutomationServiceError>;
  readonly advanceSchedule: (input: {
    readonly definition: AutomationDefinition;
    readonly after: string;
  }) => Effect.Effect<AutomationDefinition, AutomationServiceError>;
  /** Internal durable state transition used by the execution worker. */
  readonly updateRun: (run: AutomationRun) => Effect.Effect<void, AutomationServiceError>;
  /** Internal timeline append used by the execution worker. */
  readonly appendRunEvent: (input: {
    readonly run: AutomationRun;
    readonly kind: AutomationRunEventKind;
    readonly message: string | null;
    readonly payload: unknown;
    readonly createdAt: string;
  }) => Effect.Effect<void, AutomationServiceError>;
  readonly changes: Stream.Stream<AutomationChange>;
}

export class AutomationService extends Context.Service<AutomationService, AutomationServiceShape>()(
  "notcodex/automation/Services/AutomationService",
) {}
