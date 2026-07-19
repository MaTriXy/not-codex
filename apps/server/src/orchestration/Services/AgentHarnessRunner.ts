import type {
  ModelSelection,
  OrchestrationLatestTurnState,
  ProjectId,
  RuntimeMode,
  TurnId,
} from "@notcodex/contracts";
import { ThreadId } from "@notcodex/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const AgentHarnessApprovalHandling = Schema.Literals(["wait", "fail"]);
export type AgentHarnessApprovalHandling = typeof AgentHarnessApprovalHandling.Type;

export interface AgentHarnessThreadRequest {
  readonly projectId: ProjectId;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly branch: string | null;
  readonly worktreePath: string | null;
}

export interface AgentHarnessTurnRequest {
  readonly threadId: ThreadId;
  readonly prompt: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly titleSeed?: string | undefined;
}

export interface AgentHarnessRunRequest extends AgentHarnessThreadRequest {
  readonly prompt: string;
  readonly timeoutMs: number;
  readonly approvalHandling: AgentHarnessApprovalHandling;
  readonly titleSeed?: string | undefined;
  /** Internal lifecycle hook used by managed runtimes that must be able to interrupt the turn. */
  readonly onThreadCreated?: ((threadId: ThreadId) => void) | undefined;
}

export interface AgentHarnessRunResult {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly state: Extract<OrchestrationLatestTurnState, "completed">;
  readonly output: string;
}

export class AgentHarnessError extends Schema.TaggedErrorClass<AgentHarnessError>()(
  "AgentHarnessError",
  {
    phase: Schema.String,
    message: Schema.String,
    threadId: Schema.optional(ThreadId),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface AgentHarnessRunnerShape {
  readonly createThread: (
    request: AgentHarnessThreadRequest,
  ) => Effect.Effect<ThreadId, AgentHarnessError>;
  readonly startTurn: (request: AgentHarnessTurnRequest) => Effect.Effect<void, AgentHarnessError>;
  readonly interrupt: (threadId: ThreadId) => Effect.Effect<void, AgentHarnessError>;
  readonly awaitTurn: (input: {
    readonly threadId: ThreadId;
    readonly timeoutMs: number;
    readonly approvalHandling: AgentHarnessApprovalHandling;
  }) => Effect.Effect<AgentHarnessRunResult, AgentHarnessError>;
  readonly run: (
    request: AgentHarnessRunRequest,
  ) => Effect.Effect<AgentHarnessRunResult, AgentHarnessError>;
}

export class AgentHarnessRunner extends Context.Service<
  AgentHarnessRunner,
  AgentHarnessRunnerShape
>()("notcodex/orchestration/Services/AgentHarnessRunner") {}
