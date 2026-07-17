import type {
  IntegrationRequestError,
  MonkeyLoopyRunInput,
  MonkeyLoopyRunResult,
  MonkeyLoopyValidateInput,
  MonkeyLoopyValidateResult,
} from "@notcodex/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface MonkeyLoopyServiceShape {
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
