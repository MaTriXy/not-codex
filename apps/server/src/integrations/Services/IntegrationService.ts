import type {
  IntegrationListResult,
  IntegrationRequestError,
  LoopAnyConfigureInput,
  LoopAnyConfigureResult,
  LoopAnyConnectionTestResult,
  MonkeyLoopyRunInput,
  MonkeyLoopyRunResult,
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
  readonly validateMonkeyLoopy: (
    input: MonkeyLoopyValidateInput,
  ) => Effect.Effect<MonkeyLoopyValidateResult, IntegrationRequestError>;
  readonly runMonkeyLoopy: (
    input: MonkeyLoopyRunInput,
  ) => Effect.Effect<MonkeyLoopyRunResult, IntegrationRequestError>;
}

export class IntegrationService extends Context.Service<
  IntegrationService,
  IntegrationServiceShape
>()("notcodex/integrations/Services/IntegrationService") {}
