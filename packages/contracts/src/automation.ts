import * as Schema from "effect/Schema";

import {
  AutomationId,
  AutomationRunEventId,
  AutomationRunId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ModelSelection, RuntimeMode } from "./orchestration.ts";

export const AUTOMATION_WS_METHODS = {
  listDefinitions: "automations.listDefinitions",
  getDefinition: "automations.getDefinition",
  createDefinition: "automations.createDefinition",
  updateDefinition: "automations.updateDefinition",
  deleteDefinition: "automations.deleteDefinition",
  runNow: "automations.runNow",
  cancelRun: "automations.cancelRun",
  retryRun: "automations.retryRun",
  listRuns: "automations.listRuns",
  getRun: "automations.getRun",
  subscribe: "automations.subscribe",
  listTemplates: "automations.listTemplates",
} as const;

const AutomationName = TrimmedNonEmptyString.check(Schema.isMaxLength(120));
const AutomationDescription = Schema.String.check(Schema.isMaxLength(2_000));
const AutomationPrompt = TrimmedNonEmptyString.check(Schema.isMaxLength(120_000));
const AutomationTimeZone = TrimmedNonEmptyString.check(Schema.isMaxLength(100));
const AutomationLocalTime = Schema.String.check(Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/));
const AutomationWeekday = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }));
const AutomationDurationMinutes = PositiveInt.check(Schema.isLessThanOrEqualTo(60 * 24 * 30));

export const AutomationSchedule = Schema.Union([
  Schema.Struct({ type: Schema.Literal("manual") }),
  Schema.Struct({
    type: Schema.Literal("once"),
    runAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("interval"),
    everyMinutes: PositiveInt.check(Schema.isLessThanOrEqualTo(60 * 24 * 30)),
    anchorAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("calendar"),
    timeZone: AutomationTimeZone,
    localTime: AutomationLocalTime,
    weekdays: Schema.Array(AutomationWeekday).check(Schema.isMinLength(1), Schema.isMaxLength(7)),
  }),
]);
export type AutomationSchedule = typeof AutomationSchedule.Type;

export const AutomationWorktreeMode = Schema.Literals(["isolated", "project-root"]);
export type AutomationWorktreeMode = typeof AutomationWorktreeMode.Type;
export const AutomationApprovalHandling = Schema.Literals(["pause", "fail"]);
export type AutomationApprovalHandling = typeof AutomationApprovalHandling.Type;

export const AutomationExecutionPolicy = Schema.Struct({
  worktreeMode: AutomationWorktreeMode,
  approvalHandling: AutomationApprovalHandling,
  maxDurationMinutes: AutomationDurationMinutes,
  baseBranch: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(255))),
  cleanupOnSuccess: Schema.Boolean,
});
export type AutomationExecutionPolicy = typeof AutomationExecutionPolicy.Type;

const AutomationTerminalCompletion = Schema.Union([
  Schema.Struct({ type: Schema.Literal("turn-completed") }),
  Schema.Struct({
    type: Schema.Literal("goal-signal"),
    marker: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  }),
  Schema.Struct({
    type: Schema.Literal("checks-pass"),
    scriptIds: Schema.Array(TrimmedNonEmptyString).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(20),
    ),
  }),
]);
export type AutomationTerminalCompletion = typeof AutomationTerminalCompletion.Type;

export const AutomationCompletionPolicy = Schema.Union([
  AutomationTerminalCompletion,
  Schema.Struct({
    type: Schema.Literal("follow-until-complete"),
    until: AutomationTerminalCompletion,
    maxTurns: PositiveInt.check(Schema.isLessThanOrEqualTo(100)),
    maxDurationMinutes: AutomationDurationMinutes,
    followUpPrompt: TrimmedNonEmptyString.check(Schema.isMaxLength(10_000)),
  }),
]);
export type AutomationCompletionPolicy = typeof AutomationCompletionPolicy.Type;

export const AutomationRetryPolicy = Schema.Struct({
  maxAttempts: PositiveInt.check(Schema.isLessThanOrEqualTo(10)),
  initialDelaySeconds: NonNegativeInt.check(Schema.isLessThanOrEqualTo(86_400)),
  maxDelaySeconds: NonNegativeInt.check(Schema.isLessThanOrEqualTo(604_800)),
});
export type AutomationRetryPolicy = typeof AutomationRetryPolicy.Type;

export const AutomationPublishPolicy = Schema.Union([
  Schema.Struct({ type: Schema.Literal("never") }),
  Schema.Struct({ type: Schema.Literal("branch") }),
  Schema.Struct({
    type: Schema.Literal("draft-pr"),
    titleTemplate: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(240))),
  }),
  Schema.Struct({
    type: Schema.Literal("ready-pr"),
    titleTemplate: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(240))),
    confirmed: Schema.Literal(true),
  }),
]);
export type AutomationPublishPolicy = typeof AutomationPublishPolicy.Type;

export const AutomationNotificationPolicy = Schema.Struct({
  onStarted: Schema.Boolean,
  onWaiting: Schema.Boolean,
  onSucceeded: Schema.Boolean,
  onFailed: Schema.Boolean,
});
export type AutomationNotificationPolicy = typeof AutomationNotificationPolicy.Type;

export const AutomationDefinitionDraftFields = {
  projectId: ProjectId,
  name: AutomationName,
  description: Schema.NullOr(AutomationDescription),
  enabled: Schema.Boolean,
  prompt: AutomationPrompt,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  schedule: AutomationSchedule,
  execution: AutomationExecutionPolicy,
  completion: AutomationCompletionPolicy,
  retry: AutomationRetryPolicy,
  publish: AutomationPublishPolicy,
  notifications: AutomationNotificationPolicy,
} as const;

export const AutomationDefinitionDraft = Schema.Struct(AutomationDefinitionDraftFields);
export type AutomationDefinitionDraft = typeof AutomationDefinitionDraft.Type;

export const AutomationDefinitionFields = {
  id: AutomationId,
  ...AutomationDefinitionDraftFields,
} as const;

export const AutomationDefinition = Schema.Struct({
  ...AutomationDefinitionFields,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  nextRunAt: Schema.NullOr(IsoDateTime),
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type AutomationDefinition = typeof AutomationDefinition.Type;

export const AutomationDefinitionSnapshot = Schema.Struct({
  ...AutomationDefinitionFields,
  capturedAt: IsoDateTime,
});
export type AutomationDefinitionSnapshot = typeof AutomationDefinitionSnapshot.Type;

export const AutomationRunTrigger = Schema.Literals([
  "manual",
  "scheduled",
  "recovery",
  "follow-up",
  "retry",
]);
export type AutomationRunTrigger = typeof AutomationRunTrigger.Type;

export const AutomationRunStatus = Schema.Literals([
  "queued",
  "preparing",
  "running",
  "waiting-for-approval",
  "waiting-for-input",
  "retry-wait",
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
]);
export type AutomationRunStatus = typeof AutomationRunStatus.Type;

export const AutomationRun = Schema.Struct({
  id: AutomationRunId,
  automationId: AutomationId,
  definitionSnapshot: AutomationDefinitionSnapshot,
  trigger: AutomationRunTrigger,
  status: AutomationRunStatus,
  scheduledFor: IsoDateTime,
  attempt: PositiveInt,
  threadId: Schema.NullOr(ThreadId),
  turnId: Schema.NullOr(TurnId),
  worktreePath: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  baseRevision: Schema.NullOr(Schema.String),
  headRevision: Schema.NullOr(Schema.String),
  pullRequestUrl: Schema.NullOr(Schema.String),
  leaseOwner: Schema.NullOr(Schema.String),
  leaseExpiresAt: Schema.NullOr(IsoDateTime),
  startedAt: Schema.NullOr(IsoDateTime),
  finishedAt: Schema.NullOr(IsoDateTime),
  errorCode: Schema.NullOr(Schema.String),
  errorMessage: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AutomationRun = typeof AutomationRun.Type;

export const AutomationRunEventKind = Schema.Literals([
  "queued",
  "claimed",
  "worktree-prepared",
  "thread-started",
  "turn-started",
  "waiting-for-approval",
  "waiting-for-input",
  "retry-scheduled",
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
  "published",
]);
export type AutomationRunEventKind = typeof AutomationRunEventKind.Type;

export const AutomationRunEvent = Schema.Struct({
  id: AutomationRunEventId,
  runId: AutomationRunId,
  kind: AutomationRunEventKind,
  message: Schema.NullOr(Schema.String),
  payload: Schema.Unknown,
  createdAt: IsoDateTime,
});
export type AutomationRunEvent = typeof AutomationRunEvent.Type;

export const AutomationRunDetail = Schema.Struct({
  run: AutomationRun,
  events: Schema.Array(AutomationRunEvent),
});
export type AutomationRunDetail = typeof AutomationRunDetail.Type;

export const AutomationTemplate = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: AutomationName,
  description: AutomationDescription,
  prompt: AutomationPrompt,
  schedule: AutomationSchedule,
  execution: AutomationExecutionPolicy,
  completion: AutomationCompletionPolicy,
  retry: AutomationRetryPolicy,
  publish: AutomationPublishPolicy,
  notifications: AutomationNotificationPolicy,
});
export type AutomationTemplate = typeof AutomationTemplate.Type;

export const AutomationChange = Schema.Union([
  Schema.Struct({ type: Schema.Literal("definition-upserted"), definition: AutomationDefinition }),
  Schema.Struct({ type: Schema.Literal("definition-deleted"), automationId: AutomationId }),
  Schema.Struct({ type: Schema.Literal("run-upserted"), run: AutomationRun }),
  Schema.Struct({ type: Schema.Literal("run-event-appended"), event: AutomationRunEvent }),
]);
export type AutomationChange = typeof AutomationChange.Type;

export class AutomationRequestError extends Schema.TaggedErrorClass<AutomationRequestError>()(
  "AutomationRequestError",
  {
    code: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
  },
) {}

export const AutomationListDefinitionsInput = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
  includeDisabled: Schema.optionalKey(Schema.Boolean),
});
export type AutomationListDefinitionsInput = typeof AutomationListDefinitionsInput.Type;
export const AutomationGetDefinitionInput = Schema.Struct({ id: AutomationId });
export type AutomationGetDefinitionInput = typeof AutomationGetDefinitionInput.Type;
export const AutomationCreateDefinitionInput = AutomationDefinitionDraft;
export type AutomationCreateDefinitionInput = typeof AutomationCreateDefinitionInput.Type;
export const AutomationUpdateDefinitionInput = Schema.Struct({
  id: AutomationId,
  patch: Schema.Struct({
    projectId: Schema.optionalKey(ProjectId),
    name: Schema.optionalKey(AutomationName),
    description: Schema.optionalKey(Schema.NullOr(AutomationDescription)),
    enabled: Schema.optionalKey(Schema.Boolean),
    prompt: Schema.optionalKey(AutomationPrompt),
    modelSelection: Schema.optionalKey(ModelSelection),
    runtimeMode: Schema.optionalKey(RuntimeMode),
    schedule: Schema.optionalKey(AutomationSchedule),
    execution: Schema.optionalKey(AutomationExecutionPolicy),
    completion: Schema.optionalKey(AutomationCompletionPolicy),
    retry: Schema.optionalKey(AutomationRetryPolicy),
    publish: Schema.optionalKey(AutomationPublishPolicy),
    notifications: Schema.optionalKey(AutomationNotificationPolicy),
  }),
});
export type AutomationUpdateDefinitionInput = typeof AutomationUpdateDefinitionInput.Type;
export const AutomationDeleteDefinitionInput = Schema.Struct({ id: AutomationId });
export type AutomationDeleteDefinitionInput = typeof AutomationDeleteDefinitionInput.Type;
export const AutomationRunNowInput = Schema.Struct({ id: AutomationId });
export type AutomationRunNowInput = typeof AutomationRunNowInput.Type;
export const AutomationCancelRunInput = Schema.Struct({ runId: AutomationRunId });
export type AutomationCancelRunInput = typeof AutomationCancelRunInput.Type;
export const AutomationRetryRunInput = Schema.Struct({ runId: AutomationRunId });
export type AutomationRetryRunInput = typeof AutomationRetryRunInput.Type;
export const AutomationListRunsInput = Schema.Struct({
  automationId: Schema.optionalKey(AutomationId),
  status: Schema.optionalKey(AutomationRunStatus),
  limit: Schema.optionalKey(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
});
export type AutomationListRunsInput = typeof AutomationListRunsInput.Type;
export const AutomationGetRunInput = Schema.Struct({ runId: AutomationRunId });
export type AutomationGetRunInput = typeof AutomationGetRunInput.Type;
export const AutomationSubscribeInput = Schema.Struct({});
export type AutomationSubscribeInput = typeof AutomationSubscribeInput.Type;
export const AutomationListTemplatesInput = Schema.Struct({});
export type AutomationListTemplatesInput = typeof AutomationListTemplatesInput.Type;

export const AutomationRpcSchemas = {
  listDefinitions: {
    input: AutomationListDefinitionsInput,
    output: Schema.Array(AutomationDefinition),
  },
  getDefinition: {
    input: AutomationGetDefinitionInput,
    output: Schema.NullOr(AutomationDefinition),
  },
  createDefinition: { input: AutomationCreateDefinitionInput, output: AutomationDefinition },
  updateDefinition: { input: AutomationUpdateDefinitionInput, output: AutomationDefinition },
  deleteDefinition: { input: AutomationDeleteDefinitionInput, output: Schema.Void },
  runNow: { input: AutomationRunNowInput, output: AutomationRun },
  cancelRun: { input: AutomationCancelRunInput, output: AutomationRun },
  retryRun: { input: AutomationRetryRunInput, output: AutomationRun },
  listRuns: { input: AutomationListRunsInput, output: Schema.Array(AutomationRun) },
  getRun: { input: AutomationGetRunInput, output: Schema.NullOr(AutomationRunDetail) },
  subscribe: { input: AutomationSubscribeInput, output: AutomationChange },
  listTemplates: { input: AutomationListTemplatesInput, output: Schema.Array(AutomationTemplate) },
} as const;
