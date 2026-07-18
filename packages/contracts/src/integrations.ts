import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  NonNegativeInt,
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";
import { ModelSelection, RuntimeMode } from "./orchestration.ts";

export const IntegrationId = Schema.Literals(["monkey-d-loopy", "loopany"]);
export type IntegrationId = typeof IntegrationId.Type;

export const IntegrationState = Schema.Literals([
  "disabled",
  "disconnected",
  "connecting",
  "ready",
  "error",
]);
export type IntegrationState = typeof IntegrationState.Type;

export const IntegrationCapability = Schema.Literals([
  "author",
  "recipes",
  "infer",
  "validate",
  "verify",
  "run",
  "resume",
  "inspect",
  "mcp",
  "schedule",
  "deliver",
  "report",
]);
export type IntegrationCapability = typeof IntegrationCapability.Type;

export const IntegrationDescriptor = Schema.Struct({
  id: IntegrationId,
  name: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  state: IntegrationState,
  capabilities: Schema.Array(IntegrationCapability),
  tokenConfigured: Schema.Boolean,
  lastActivityAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  error: Schema.NullOr(Schema.String),
});
export type IntegrationDescriptor = typeof IntegrationDescriptor.Type;

const LoopAnyServerUrl = TrimmedString.check(Schema.isMaxLength(4_096));
const LoopAnyRoot = TrimmedNonEmptyString.check(Schema.isMaxLength(4_096));
const LoopAnyRoots = Schema.Array(LoopAnyRoot).check(Schema.isMaxLength(64));
const LoopAnyToken = TrimmedString.check(Schema.isMaxLength(4_096));

export const LoopAnySettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  serverUrl: LoopAnyServerUrl.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  allowedRoots: LoopAnyRoots.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  pollWaitSeconds: Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 60 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(25)),
  ),
});
export type LoopAnySettings = typeof LoopAnySettings.Type;

export const LoopAnySettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  serverUrl: Schema.optionalKey(LoopAnyServerUrl),
  allowedRoots: Schema.optionalKey(LoopAnyRoots),
  pollWaitSeconds: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 60 })),
  ),
});
export type LoopAnySettingsPatch = typeof LoopAnySettingsPatch.Type;

export const IntegrationListResult = Schema.Struct({
  integrations: Schema.Array(IntegrationDescriptor),
});
export type IntegrationListResult = typeof IntegrationListResult.Type;

export const LoopAnyConfigureInput = Schema.Struct({
  settings: LoopAnySettingsPatch,
  token: Schema.optionalKey(LoopAnyToken),
  clearToken: Schema.optionalKey(Schema.Boolean),
});
export type LoopAnyConfigureInput = typeof LoopAnyConfigureInput.Type;

export const LoopAnyConfigureResult = Schema.Struct({
  settings: LoopAnySettings,
  tokenConfigured: Schema.Boolean,
});
export type LoopAnyConfigureResult = typeof LoopAnyConfigureResult.Type;

export const LoopAnyConnectionTestResult = Schema.Struct({
  ok: Schema.Boolean,
  message: TrimmedNonEmptyString,
  serverVersion: Schema.NullOr(Schema.String),
});
export type LoopAnyConnectionTestResult = typeof LoopAnyConnectionTestResult.Type;

export const MonkeyLoopyDiagnostic = Schema.Struct({
  level: Schema.Literals(["error", "warning", "info"]),
  message: TrimmedNonEmptyString,
  path: Schema.NullOr(Schema.String),
});
export type MonkeyLoopyDiagnostic = typeof MonkeyLoopyDiagnostic.Type;

export const MonkeyLoopyBlueprint = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
});
export type MonkeyLoopyBlueprint = typeof MonkeyLoopyBlueprint.Type;

export const MonkeyLoopyRecipe = Schema.Struct({
  name: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  scheduleMode: TrimmedNonEmptyString,
  cadence: Schema.NullOr(Schema.String),
  requiredInputs: Schema.Array(TrimmedNonEmptyString),
  minimumScore: Schema.Number,
  safety: TrimmedNonEmptyString,
});
export type MonkeyLoopyRecipe = typeof MonkeyLoopyRecipe.Type;

export const MonkeyLoopyAuthoringContextResult = Schema.Struct({
  factoryVersion: TrimmedNonEmptyString,
  executionVersion: TrimmedNonEmptyString,
  guideUrl: TrimmedNonEmptyString,
  llmsUrl: TrimmedNonEmptyString,
  llmsFullUrl: TrimmedNonEmptyString,
  schemaGuide: TrimmedNonEmptyString,
  blueprints: Schema.Array(MonkeyLoopyBlueprint),
  recipes: Schema.Array(MonkeyLoopyRecipe),
  executionNotice: TrimmedNonEmptyString,
});
export type MonkeyLoopyAuthoringContextResult = typeof MonkeyLoopyAuthoringContextResult.Type;

export const MonkeyLoopyScaffoldInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  recipe: Schema.optionalKey(TrimmedNonEmptyString),
  blueprint: Schema.optionalKey(TrimmedNonEmptyString),
});
export type MonkeyLoopyScaffoldInput = typeof MonkeyLoopyScaffoldInput.Type;

export const MonkeyLoopyScaffoldResult = Schema.Struct({
  yaml: TrimmedNonEmptyString,
  source: TrimmedNonEmptyString,
  factoryVersion: TrimmedNonEmptyString,
});
export type MonkeyLoopyScaffoldResult = typeof MonkeyLoopyScaffoldResult.Type;

export const MonkeyLoopyInferInput = Schema.Struct({
  source: Schema.String.check(Schema.isMaxLength(1_000_000)),
  filename: TrimmedNonEmptyString,
});
export type MonkeyLoopyInferInput = typeof MonkeyLoopyInferInput.Type;

export const MonkeyLoopyInferResult = Schema.Struct({
  kind: TrimmedNonEmptyString,
  confidence: TrimmedNonEmptyString,
  candidatePattern: TrimmedNonEmptyString,
  draftYaml: TrimmedNonEmptyString,
  secretsFlagged: Schema.Array(Schema.String),
  notes: Schema.Array(Schema.String),
  factoryVersion: TrimmedNonEmptyString,
});
export type MonkeyLoopyInferResult = typeof MonkeyLoopyInferResult.Type;

export const MonkeyLoopyValidateInput = Schema.Struct({
  yaml: Schema.String.check(Schema.isMaxLength(1_000_000)),
});
export type MonkeyLoopyValidateInput = typeof MonkeyLoopyValidateInput.Type;

export const MonkeyLoopyValidateResult = Schema.Struct({
  valid: Schema.Boolean,
  verified: Schema.Boolean,
  executionReady: Schema.Boolean,
  score: Schema.NullOr(Schema.Number),
  name: Schema.NullOr(Schema.String),
  factoryVersion: TrimmedNonEmptyString,
  executionVersion: TrimmedNonEmptyString,
  diagnostics: Schema.Array(MonkeyLoopyDiagnostic),
});
export type MonkeyLoopyValidateResult = typeof MonkeyLoopyValidateResult.Type;

export const MonkeyLoopyRunInput = Schema.Struct({
  projectId: ProjectId,
  yaml: Schema.String.check(Schema.isMaxLength(1_000_000)),
  inputs: Schema.Record(Schema.String, Schema.Unknown).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("approval-required" as const)),
  ),
  timeoutMinutes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 240 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(30)),
  ),
});
export type MonkeyLoopyRunInput = typeof MonkeyLoopyRunInput.Type;

export const IntegrationRunState = Schema.Literals([
  "queued",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
]);
export type IntegrationRunState = typeof IntegrationRunState.Type;

// Durable lifecycle records intentionally retain only bounded, presentation-safe
// summaries. Inputs, credentials and runtime environments never cross this boundary.
export const IntegrationRunId = TrimmedNonEmptyString.check(Schema.isMaxLength(160));
export type IntegrationRunId = typeof IntegrationRunId.Type;
const IntegrationRunSummary = Schema.String.check(Schema.isMaxLength(16_384));
const IntegrationRunFailure = Schema.String.check(Schema.isMaxLength(4_096));

export const IntegrationRun = Schema.Struct({
  id: IntegrationRunId,
  source: IntegrationId,
  state: IntegrationRunState,
  projectId: Schema.NullOr(ProjectId),
  parentRunId: Schema.NullOr(IntegrationRunId),
  attempt: NonNegativeInt,
  threadIds: Schema.Array(ThreadId).check(Schema.isMaxLength(100)),
  journalRef: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(4_096))),
  outputSummary: Schema.NullOr(IntegrationRunSummary),
  failure: Schema.NullOr(IntegrationRunFailure),
  createdAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type IntegrationRun = typeof IntegrationRun.Type;

export const IntegrationRunCursor = Schema.Struct({
  createdAt: IsoDateTime,
  id: IntegrationRunId,
});
export type IntegrationRunCursor = typeof IntegrationRunCursor.Type;

export const IntegrationListRunsInput = Schema.Struct({
  source: Schema.optionalKey(IntegrationId),
  state: Schema.optionalKey(IntegrationRunState),
  projectId: Schema.optionalKey(ProjectId),
  cursor: Schema.optionalKey(IntegrationRunCursor),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(50)),
  ),
});
export type IntegrationListRunsInput = typeof IntegrationListRunsInput.Type;
export const IntegrationGetRunInput = Schema.Struct({ id: IntegrationRunId });
export type IntegrationGetRunInput = typeof IntegrationGetRunInput.Type;
export const IntegrationListRunsResult = Schema.Struct({
  runs: Schema.Array(IntegrationRun),
  nextCursor: Schema.NullOr(IntegrationRunCursor),
});
export type IntegrationListRunsResult = typeof IntegrationListRunsResult.Type;

export const MonkeyLoopyRunResult = Schema.Struct({
  runId: TrimmedNonEmptyString,
  state: IntegrationRunState,
  output: Schema.String,
  threadIds: Schema.Array(ThreadId),
  journalPath: TrimmedNonEmptyString,
  error: Schema.NullOr(Schema.String),
});
export type MonkeyLoopyRunResult = typeof MonkeyLoopyRunResult.Type;

export const IntegrationRequestErrorCode = Schema.Literals([
  "invalid-config",
  "not-configured",
  "validation-failed",
  "connection-failed",
  "execution-failed",
  "unauthorized",
]);
export type IntegrationRequestErrorCode = typeof IntegrationRequestErrorCode.Type;

export class IntegrationRequestError extends Schema.TaggedErrorClass<IntegrationRequestError>()(
  "IntegrationRequestError",
  {
    code: IntegrationRequestErrorCode,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const INTEGRATION_WS_METHODS = {
  list: "integrations.list",
  configureLoopAny: "integrations.loopany.configure",
  testLoopAny: "integrations.loopany.test",
  getMonkeyLoopyAuthoringContext: "integrations.monkeyLoopy.authoringContext",
  scaffoldMonkeyLoopy: "integrations.monkeyLoopy.scaffold",
  inferMonkeyLoopy: "integrations.monkeyLoopy.infer",
  validateMonkeyLoopy: "integrations.monkeyLoopy.validate",
  runMonkeyLoopy: "integrations.monkeyLoopy.run",
  listRuns: "integrations.runs.list",
  getRun: "integrations.runs.get",
} as const;

export const IntegrationRpcSchemas = {
  list: { input: Schema.Void, output: IntegrationListResult },
  configureLoopAny: { input: LoopAnyConfigureInput, output: LoopAnyConfigureResult },
  testLoopAny: { input: Schema.Void, output: LoopAnyConnectionTestResult },
  getMonkeyLoopyAuthoringContext: {
    input: Schema.Void,
    output: MonkeyLoopyAuthoringContextResult,
  },
  scaffoldMonkeyLoopy: { input: MonkeyLoopyScaffoldInput, output: MonkeyLoopyScaffoldResult },
  inferMonkeyLoopy: { input: MonkeyLoopyInferInput, output: MonkeyLoopyInferResult },
  validateMonkeyLoopy: { input: MonkeyLoopyValidateInput, output: MonkeyLoopyValidateResult },
  runMonkeyLoopy: { input: MonkeyLoopyRunInput, output: MonkeyLoopyRunResult },
  listRuns: { input: IntegrationListRunsInput, output: IntegrationListRunsResult },
  getRun: { input: IntegrationGetRunInput, output: Schema.NullOr(IntegrationRun) },
} as const;
