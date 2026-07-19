import type {
  IntegrationRequestError,
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

export interface MonkeyLoopyServiceShape {
  readonly getAuthoringContext: Effect.Effect<
    MonkeyLoopyAuthoringContextResult,
    IntegrationRequestError
  >;
  readonly scaffold: (
    input: MonkeyLoopyScaffoldInput,
  ) => Effect.Effect<MonkeyLoopyScaffoldResult, IntegrationRequestError>;
  readonly infer: (
    input: MonkeyLoopyInferInput,
  ) => Effect.Effect<MonkeyLoopyInferResult, IntegrationRequestError>;
  readonly validate: (
    input: MonkeyLoopyValidateInput,
  ) => Effect.Effect<MonkeyLoopyValidateResult, IntegrationRequestError>;
  readonly run: (
    input: MonkeyLoopyRunInput,
  ) => Effect.Effect<MonkeyLoopyRunResult, IntegrationRequestError>;
}

export class MonkeyLoopyService extends Context.Service<
  MonkeyLoopyService,
  MonkeyLoopyServiceShape
>()("notcodex/integrations/Services/MonkeyLoopyService") {}
