import type {
  IntegrationRequestError,
  MonkeyLoopyAuthoringContextResult,
  MonkeyLoopyInferInput,
  MonkeyLoopyInferResult,
  MonkeyLoopyRunInput,
  MonkeyLoopyScaffoldInput,
  MonkeyLoopyScaffoldResult,
  MonkeyLoopyValidateInput,
  MonkeyLoopyValidateResult,
  ThreadId,
} from "@notcodex/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface MonkeyLoopyExecutionResult {
  readonly runId: string;
  readonly state: "waiting" | "succeeded" | "failed" | "cancelled";
  readonly output: string;
  readonly threadIds: ReadonlyArray<ThreadId>;
  readonly journalPath: string;
  readonly error: string | null;
}

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
    runId?: string,
  ) => Effect.Effect<MonkeyLoopyExecutionResult, IntegrationRequestError>;
}

export class MonkeyLoopyService extends Context.Service<
  MonkeyLoopyService,
  MonkeyLoopyServiceShape
>()("notcodex/integrations/Services/MonkeyLoopyService") {}
