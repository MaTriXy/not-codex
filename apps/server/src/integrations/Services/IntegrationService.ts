import type {
  IntegrationListResult,
  IntegrationGetRunInput,
  IntegrationListRunsInput,
  IntegrationListRunsResult,
  IntegrationRun,
  IntegrationRequestError,
  LoopAnyConfigureInput,
  LoopAnyConfigureResult,
  LoopAnyConnectionTestResult,
  MonkeyLoopyAuthoringContextResult,
  MonkeyLoopyInferInput,
  MonkeyLoopyInferResult,
  MonkeyLoopyRunInput,
  MonkeyLoopyRunResult,
  MonkeyLoopyScaffoldInput,
  MonkeyLoopyScaffoldResult,
  MonkeyLoopyValidateInput,
  MonkeyLoopyValidateResult,
} from "@notcodex/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface IntegrationServiceShape {
  readonly list: Effect.Effect<IntegrationListResult, IntegrationRequestError>;
  readonly configureLoopAny: (
    input: LoopAnyConfigureInput,
  ) => Effect.Effect<LoopAnyConfigureResult, IntegrationRequestError>;
  readonly testLoopAny: Effect.Effect<LoopAnyConnectionTestResult, IntegrationRequestError>;
  readonly getMonkeyLoopyAuthoringContext: Effect.Effect<
    MonkeyLoopyAuthoringContextResult,
    IntegrationRequestError
  >;
  readonly scaffoldMonkeyLoopy: (
    input: MonkeyLoopyScaffoldInput,
  ) => Effect.Effect<MonkeyLoopyScaffoldResult, IntegrationRequestError>;
  readonly inferMonkeyLoopy: (
    input: MonkeyLoopyInferInput,
  ) => Effect.Effect<MonkeyLoopyInferResult, IntegrationRequestError>;
  readonly validateMonkeyLoopy: (
    input: MonkeyLoopyValidateInput,
  ) => Effect.Effect<MonkeyLoopyValidateResult, IntegrationRequestError>;
  readonly runMonkeyLoopy: (
    input: MonkeyLoopyRunInput,
  ) => Effect.Effect<MonkeyLoopyRunResult, IntegrationRequestError>;
  readonly listRuns: (
    input: IntegrationListRunsInput,
  ) => Effect.Effect<IntegrationListRunsResult, IntegrationRequestError>;
  readonly getRun: (
    input: IntegrationGetRunInput,
  ) => Effect.Effect<IntegrationRun | null, IntegrationRequestError>;
}

export class IntegrationService extends Context.Service<
  IntegrationService,
  IntegrationServiceShape
>()("notcodex/integrations/Services/IntegrationService") {}
