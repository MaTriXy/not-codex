import type {
  IntegrationListResult,
  IntegrationGetRunInput,
  IntegrationListRunsInput,
  IntegrationListRunsResult,
  IntegrationInspectRunResult,
  IntegrationCancelRunResult,
  IntegrationRecoverRunResult,
  IntegrationResumeRunInput,
  IntegrationRetryRunInput,
  IntegrationRun,
  IntegrationRequestError,
  LoopAnyConfigureInput,
  LoopAnyConfigureResult,
  LoopAnyConnectionTestResult,
  OpenKrittCatalog,
  OpenKrittConfigureInput,
  OpenKrittConfigureResult,
  OpenKrittConnectionTestResult,
  OpenKrittFindingDetailResult,
  OpenKrittFindingsListInput,
  OpenKrittFindingsListResult,
  OpenKrittLaunchScanInput,
  OpenKrittRemediationLaunchInput,
  OpenKrittRemediationLaunchResult,
  OpenKrittCompareScansInput,
  OpenKrittComparisonResult,
  OpenKrittRescanInput,
  OpenKrittRescanResult,
  OpenKrittSnapshotCreateInput,
  OpenKrittSnapshotCreateResult,
  OpenKrittSnapshotPreviewInput,
  OpenKrittSnapshotPreviewResult,
  OpenKrittScanControlInput,
  OpenKrittScanControlResult,
  OpenKrittScanLaunchResult,
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
  readonly configureOpenKritt: (
    input: OpenKrittConfigureInput,
  ) => Effect.Effect<OpenKrittConfigureResult, IntegrationRequestError>;
  readonly testOpenKritt: Effect.Effect<OpenKrittConnectionTestResult, IntegrationRequestError>;
  readonly refreshOpenKrittCatalog: Effect.Effect<OpenKrittCatalog, IntegrationRequestError>;
  readonly launchOpenKrittScan: (
    input: OpenKrittLaunchScanInput,
  ) => Effect.Effect<OpenKrittScanLaunchResult, IntegrationRequestError>;
  readonly pauseOpenKrittScan: (
    input: OpenKrittScanControlInput,
  ) => Effect.Effect<OpenKrittScanControlResult, IntegrationRequestError>;
  readonly stopOpenKrittScan: (
    input: OpenKrittScanControlInput,
  ) => Effect.Effect<OpenKrittScanControlResult, IntegrationRequestError>;
  readonly resumeOpenKrittScan: (
    input: OpenKrittScanControlInput,
  ) => Effect.Effect<OpenKrittScanControlResult, IntegrationRequestError>;
  readonly listOpenKrittRuns: (
    input: IntegrationListRunsInput,
  ) => Effect.Effect<IntegrationListRunsResult, IntegrationRequestError>;
  readonly listOpenKrittFindings: (
    input: OpenKrittFindingsListInput,
  ) => Effect.Effect<OpenKrittFindingsListResult, IntegrationRequestError>;
  readonly getOpenKrittFinding: (input: {
    readonly scanId: string;
    readonly findingId: string;
  }) => Effect.Effect<OpenKrittFindingDetailResult, IntegrationRequestError>;
  readonly launchOpenKrittRemediation: (
    input: OpenKrittRemediationLaunchInput,
  ) => Effect.Effect<OpenKrittRemediationLaunchResult, IntegrationRequestError>;
  readonly rescanOpenKritt: (
    input: OpenKrittRescanInput,
  ) => Effect.Effect<OpenKrittRescanResult, IntegrationRequestError>;
  readonly compareOpenKrittScans: (
    input: OpenKrittCompareScansInput,
  ) => Effect.Effect<OpenKrittComparisonResult, IntegrationRequestError>;
  readonly previewOpenKrittSnapshot: (
    input: OpenKrittSnapshotPreviewInput,
  ) => Effect.Effect<OpenKrittSnapshotPreviewResult, IntegrationRequestError>;
  readonly createOpenKrittSnapshot: (
    input: OpenKrittSnapshotCreateInput,
  ) => Effect.Effect<OpenKrittSnapshotCreateResult, IntegrationRequestError>;
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
  readonly inspectRun: (
    input: IntegrationGetRunInput,
  ) => Effect.Effect<IntegrationInspectRunResult, IntegrationRequestError>;
  readonly cancelRun: (
    input: IntegrationGetRunInput,
  ) => Effect.Effect<IntegrationCancelRunResult, IntegrationRequestError>;
  readonly resumeRun: (
    input: IntegrationResumeRunInput,
  ) => Effect.Effect<IntegrationRecoverRunResult, IntegrationRequestError>;
  readonly retryRun: (
    input: IntegrationRetryRunInput,
  ) => Effect.Effect<IntegrationRecoverRunResult, IntegrationRequestError>;
}

export class IntegrationService extends Context.Service<
  IntegrationService,
  IntegrationServiceShape
>()("notcodex/integrations/Services/IntegrationService") {}
