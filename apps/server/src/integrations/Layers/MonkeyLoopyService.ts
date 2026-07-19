import {
  BUILTIN_RECIPE_CATALOG,
  FACTORY_VERSION,
  getBlueprint,
  instantiateRecipe,
  listBlueprints,
  loadSpecFromYaml,
  LOOPSPEC_GUIDE,
  type LoopSpec,
  type Step,
} from "@loopyc/core";
import { inferScaffold } from "@loopyc/infer";
import { createRuntime, Journal, type Runtime } from "@loopyc/runtime";
import { interpretLoop, scoreLoop, verifyLoop } from "@loopyc/verify";
import {
  IntegrationRequestError,
  type IntegrationRunCaps,
  type IntegrationRunId,
  type IntegrationRunRuntimePhase,
  type IntegrationRunRuntimeSnapshot,
  type MonkeyLoopyDiagnostic,
  type ThreadId,
} from "@notcodex/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PartitionedSemaphore from "effect/PartitionedSemaphore";
import * as Schema from "effect/Schema";

import { AgentHarnessRunner } from "../../orchestration/Services/AgentHarnessRunner.ts";
import { ServerConfig } from "../../config.ts";
import {
  MONKEY_D_LOOPY_EXECUTION_NOTICE,
  MONKEY_D_LOOPY_EXECUTION_VERSION,
  MONKEY_D_LOOPY_GUIDE_URL,
  MONKEY_D_LOOPY_LLMS_FULL_URL,
  MONKEY_D_LOOPY_LLMS_URL,
} from "../monkeyLoopyVersions.ts";
import {
  type MonkeyLoopyExecutionResult,
  type MonkeyLoopyRunObserver,
  MonkeyLoopyService,
} from "../Services/MonkeyLoopyService.ts";

const encodeUnknownJson = Schema.encodeUnknownEffect(Schema.UnknownFromJsonString);

const INTEGRATION_DIRECTORY = "integrations/monkey-d-loopy";
const CANCEL_SETUP_GRACE_PERIOD = "250 millis";

interface ActiveMonkeyLoopyRun {
  readonly runId: IntegrationRunId;
  readonly caps: IntegrationRunCaps;
  runtime: Runtime | null;
  phase: IntegrationRunRuntimePhase;
  activeThreadId: ThreadId | null;
  agentSetupComplete: Promise<void> | null;
  turnStartComplete: Promise<void> | null;
  turnCancellationSettled: Promise<void> | null;
  turnStarted: boolean;
  readonly threadIds: ThreadId[];
  agentCallsStarted: number;
  agentCallsCompleted: number;
  cancelRequested: boolean;
  readonly diagnostics: string[];
}

function runtimeCaps(spec: LoopSpec): IntegrationRunCaps {
  return {
    maxIterations: spec.caps.max_iterations,
    noProgressMaxRepeats: spec.caps.no_progress?.max_repeats ?? null,
    tokenBudget: spec.caps.budget?.tokens ?? null,
    usdBudget: spec.caps.budget?.usd ?? null,
    wallclockBudget: spec.caps.budget?.wallclock ?? null,
    onCapExceeded: spec.caps.on_cap_exceeded ?? "fail",
  };
}

function runtimeSnapshot(active: ActiveMonkeyLoopyRun): IntegrationRunRuntimeSnapshot {
  return {
    live: true,
    phase: active.phase,
    recoverable: active.phase === "waiting",
    progress: {
      agentCallsStarted: active.agentCallsStarted,
      agentCallsCompleted: active.agentCallsCompleted,
      activeStep: active.activeThreadId !== null ? "Not Codex agent turn" : null,
      activeThreadId: active.activeThreadId,
      linkedThreadIds: active.threadIds.slice(0, 100),
    },
    caps: active.caps,
    diagnostics: active.diagnostics.slice(-20),
  };
}

function requestRuntimeStop(runtime: Runtime): void {
  try {
    runtime.requestStop({
      actor: "not-codex",
      reason: "Cancelled by an authorized Not Codex client.",
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!message.includes("a stop is already requested")) throw cause;
  }
}

function requestError(message: string, cause?: unknown): IntegrationRequestError {
  return new IntegrationRequestError({
    code: "execution-failed",
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

function collectAgentHarnesses(steps: ReadonlyArray<Step>, target: string[]): void {
  for (const step of steps) {
    if (step.kind === "agent") target.push(step.harness);
    if (step.kind === "reduce") collectAgentHarnesses(step.body, target);
  }
}

export function unsupportedHarnessDiagnostics(spec: LoopSpec): MonkeyLoopyDiagnostic[] {
  const harnesses: string[] = [];
  collectAgentHarnesses(spec.body, harnesses);
  if (spec.terminate.on_exit?.kind === "agent") {
    harnesses.push(spec.terminate.on_exit.harness ?? "");
  }
  return [...new Set(harnesses)]
    .filter((harness) => harness !== "not-codex")
    .map((harness) => ({
      level: "error" as const,
      message: `Agent harness '${harness || "<missing>"}' is not allowed. Use 'not-codex'.`,
      path: null,
    }));
}

function parseDiagnostics(yaml: string): {
  readonly spec: LoopSpec | undefined;
  readonly capsInjected: boolean;
  readonly diagnostics: MonkeyLoopyDiagnostic[];
  readonly policyDiagnostics: MonkeyLoopyDiagnostic[];
} {
  const processed = loadSpecFromYaml(yaml);
  const diagnostics: MonkeyLoopyDiagnostic[] = [
    ...(processed.parseErrors ?? []).map((message) => ({
      level: "error" as const,
      message,
      path: null,
    })),
    ...(processed.validation?.diagnostics ?? []).map((diagnostic) => ({
      level: diagnostic.severity,
      message: diagnostic.message,
      path: diagnostic.path ?? null,
    })),
  ];
  return {
    spec: processed.spec,
    capsInjected: processed.capsInjected ?? false,
    diagnostics,
    policyDiagnostics: processed.spec ? unsupportedHarnessDiagnostics(processed.spec) : [],
  };
}

export const makeMonkeyLoopyService = Effect.gen(function* () {
  const harness = yield* AgentHarnessRunner;
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const journalBase = path.join(config.stateDir, INTEGRATION_DIRECTORY);
  const activeRuns = new Map<IntegrationRunId, ActiveMonkeyLoopyRun>();
  const runCancellations = yield* PartitionedSemaphore.make<IntegrationRunId>({ permits: 1 });

  const getAuthoringContext: MonkeyLoopyService["Service"]["getAuthoringContext"] = Effect.try({
    try: () => ({
      factoryVersion: FACTORY_VERSION,
      executionVersion: MONKEY_D_LOOPY_EXECUTION_VERSION,
      guideUrl: MONKEY_D_LOOPY_GUIDE_URL,
      llmsUrl: MONKEY_D_LOOPY_LLMS_URL,
      llmsFullUrl: MONKEY_D_LOOPY_LLMS_FULL_URL,
      schemaGuide: LOOPSPEC_GUIDE,
      blueprints: listBlueprints().map(({ name, description }) => ({ name, description })),
      recipes: BUILTIN_RECIPE_CATALOG.list().map(({ manifest }) => ({
        name: manifest.name,
        title: manifest.title,
        summary: manifest.summary,
        scheduleMode: manifest.schedule.mode,
        cadence: manifest.schedule.cadence ?? null,
        requiredInputs: manifest.inputs
          .filter((input) => input.required)
          .map((input) => input.name),
        minimumScore: manifest.minimum_score,
        safety: manifest.safety.rationale,
      })),
      executionNotice: MONKEY_D_LOOPY_EXECUTION_NOTICE,
    }),
    catch: (cause) => requestError("Could not load Monkey D. Loopy authoring context.", cause),
  });

  const scaffold: MonkeyLoopyService["Service"]["scaffold"] = Effect.fn(
    "MonkeyLoopyService.scaffold",
  )(function* (input) {
    if ((input.recipe === undefined) === (input.blueprint === undefined)) {
      return yield* new IntegrationRequestError({
        code: "invalid-config",
        message: "Choose exactly one Monkey D. Loopy recipe or blueprint.",
      });
    }
    return yield* Effect.try({
      try: () => {
        if (input.recipe !== undefined) {
          const recipe = BUILTIN_RECIPE_CATALOG.get(input.recipe);
          if (!recipe) throw new Error(`Unknown recipe '${input.recipe}'.`);
          return {
            yaml: instantiateRecipe(recipe, input.id),
            source: `recipe:${input.recipe}`,
            factoryVersion: FACTORY_VERSION,
          };
        }
        const blueprint = getBlueprint(input.blueprint!);
        if (!blueprint) throw new Error(`Unknown blueprint '${input.blueprint}'.`);
        return {
          yaml: blueprint.yaml.replace(/^id:.*$/m, `id: ${input.id}`),
          source: `blueprint:${input.blueprint}`,
          factoryVersion: FACTORY_VERSION,
        };
      },
      catch: (cause) =>
        new IntegrationRequestError({
          code: "invalid-config",
          message: cause instanceof Error ? cause.message : "Could not scaffold the LoopSpec.",
          cause,
        }),
    });
  });

  const infer: MonkeyLoopyService["Service"]["infer"] = Effect.fn("MonkeyLoopyService.infer")(
    function* (input) {
      return yield* Effect.try({
        try: () => {
          const result = inferScaffold(input.filename, input.source);
          return {
            kind: result.kind,
            confidence: result.factpack.confidence,
            candidatePattern: result.factpack.candidatePattern,
            draftYaml: result.draftYaml,
            secretsFlagged: result.factpack.secretsFlagged,
            notes: result.factpack.notes,
            factoryVersion: FACTORY_VERSION,
          };
        },
        catch: (cause) => requestError("Monkey D. Loopy inference failed.", cause),
      });
    },
  );

  const validate: MonkeyLoopyService["Service"]["validate"] = Effect.fn(
    "MonkeyLoopyService.validate",
  )(function* (input) {
    const parsed = yield* Effect.try({
      try: () => parseDiagnostics(input.yaml),
      catch: (cause) => requestError("Monkey.D.Loopy could not parse the specification.", cause),
    });
    const hasErrors = parsed.diagnostics.some((diagnostic) => diagnostic.level === "error");
    if (!parsed.spec || hasErrors) {
      return {
        valid: false,
        verified: false,
        executionReady: false,
        score: null,
        name: parsed.spec?.meta?.name ?? parsed.spec?.id ?? null,
        factoryVersion: FACTORY_VERSION,
        executionVersion: MONKEY_D_LOOPY_EXECUTION_VERSION,
        diagnostics: parsed.diagnostics,
      };
    }
    if (parsed.policyDiagnostics.some((diagnostic) => diagnostic.level === "error")) {
      return {
        valid: true,
        verified: false,
        executionReady: false,
        score: null,
        name: parsed.spec.meta?.name ?? parsed.spec.id,
        factoryVersion: FACTORY_VERSION,
        executionVersion: MONKEY_D_LOOPY_EXECUTION_VERSION,
        diagnostics: [...parsed.diagnostics, ...parsed.policyDiagnostics],
      };
    }
    const report = yield* Effect.tryPromise({
      try: () => verifyLoop(parsed.spec!, parsed.capsInjected),
      catch: (cause) => requestError("Monkey.D.Loopy verification failed.", cause),
    });
    const score = scoreLoop(parsed.spec, report);
    return {
      valid: true,
      verified: report.ok,
      executionReady: report.ok,
      score: score.total,
      name: parsed.spec.meta?.name ?? parsed.spec.id,
      factoryVersion: FACTORY_VERSION,
      executionVersion: MONKEY_D_LOOPY_EXECUTION_VERSION,
      diagnostics: [
        ...parsed.diagnostics,
        ...parsed.policyDiagnostics,
        ...report.issues.map((issue) => ({
          level: issue.severity,
          message: issue.message,
          path: null,
        })),
      ],
    };
  });

  const parseVerifiedSpec = Effect.fn("MonkeyLoopyService.parseVerifiedSpec")(function* (
    yaml: string,
  ) {
    const parsed = yield* Effect.try({
      try: () => parseDiagnostics(yaml),
      catch: (cause) => requestError("Monkey.D.Loopy could not parse the specification.", cause),
    });
    const allDiagnostics = [...parsed.diagnostics, ...parsed.policyDiagnostics];
    const hasErrors = allDiagnostics.some((diagnostic) => diagnostic.level === "error");
    if (!parsed.spec || hasErrors) {
      return yield* new IntegrationRequestError({
        code: "validation-failed",
        message:
          allDiagnostics.find((item) => item.level === "error")?.message ??
          "The Monkey.D.Loopy specification is invalid.",
      });
    }
    const report = yield* Effect.tryPromise({
      try: () => verifyLoop(parsed.spec!, parsed.capsInjected),
      catch: (cause) => requestError("Monkey.D.Loopy verification failed.", cause),
    });
    if (!report.ok) {
      return yield* new IntegrationRequestError({
        code: "validation-failed",
        message: report.reason ?? "The Monkey.D.Loopy specification did not verify.",
      });
    }
    return parsed.spec;
  });

  const verifyJournal: MonkeyLoopyService["Service"]["verifyJournal"] = Effect.fn(
    "MonkeyLoopyService.verifyJournal",
  )(function* (input, runId, allowTerminal) {
    if (activeRuns.has(runId)) {
      return yield* new IntegrationRequestError({
        code: "recovery-in-progress",
        message: "This Monkey.D.Loopy run already has an active runtime.",
      });
    }
    const spec = yield* parseVerifiedSpec(input.yaml);
    const events = yield* Effect.try({
      try: () => {
        const journal = new Journal(journalBase, runId);
        if (!journal.exists()) throw new Error("missing journal");
        return journal.load();
      },
      catch: () =>
        new IntegrationRequestError({
          code: "journal-invalid",
          message: "The Monkey.D.Loopy journal is missing, incomplete, or corrupt.",
        }),
    });
    const first = events[0];
    if (first?.type !== "run_start" || first.data.loopId !== spec.id) {
      return yield* new IntegrationRequestError({
        code: "journal-invalid",
        message: "The Monkey.D.Loopy journal does not belong to this run specification.",
      });
    }
    if (
      !allowTerminal &&
      events.some(
        (event) =>
          event.type === "terminated" ||
          event.type === "failed" ||
          (event.type === "cap" &&
            (event.data.action === "fail" || event.data.action === "exit-clean")) ||
          (event.type === "effect_recovery" && event.data.action === "abort"),
      )
    ) {
      return yield* new IntegrationRequestError({
        code: "run-not-recoverable",
        message: "A terminal Monkey.D.Loopy journal cannot be resumed.",
      });
    }
  });

  const execute = Effect.fn("MonkeyLoopyService.execute")(function* (
    input: Parameters<MonkeyLoopyService["Service"]["run"]>[0],
    suppliedRunId: string | undefined,
    observer: MonkeyLoopyRunObserver | undefined,
    operation: "run" | "resume",
    approveCaps: boolean,
  ) {
    const spec = yield* parseVerifiedSpec(input.yaml);
    const runId =
      suppliedRunId ??
      `monkey-${yield* crypto.randomUUIDv4.pipe(
        Effect.mapError((cause) => requestError("Could not create a Loopy run id.", cause)),
      )}`;
    const active: ActiveMonkeyLoopyRun = {
      runId: runId as IntegrationRunId,
      caps: runtimeCaps(spec),
      runtime: null,
      phase: "starting",
      activeThreadId: null,
      agentSetupComplete: null,
      turnStartComplete: null,
      turnCancellationSettled: null,
      turnStarted: false,
      threadIds: [],
      agentCallsStarted: 0,
      agentCallsCompleted: 0,
      cancelRequested: false,
      diagnostics: ["Runtime prepared"],
    };
    activeRuns.set(active.runId, active);
    if (observer?.isCancellationRequested && (yield* observer.isCancellationRequested())) {
      active.cancelRequested = true;
      active.phase = "stopping";
      active.diagnostics.push("Cancellation requested before runtime registration");
    }
    yield* fileSystem
      .makeDirectory(journalBase, { recursive: true })
      .pipe(
        Effect.mapError((cause) =>
          requestError("Could not prepare the Monkey.D.Loopy journal directory.", cause),
        ),
      );
    const threadIds: ThreadId[] = [];
    let lastOutput = "";
    const runHarness = Effect.runPromiseWith(yield* Effect.context<never>());
    const runtime = createRuntime(interpretLoop(spec), {
      cwd: journalBase,
      runId,
      inputs: input.inputs,
      env: {},
      effectEnv: {},
      autoApprove: false,
      approveCaps,
      maxBlockMs: 0,
      agentHarnesses: {
        "not-codex": async (request) => {
          active.phase = active.cancelRequested ? "stopping" : "agent";
          active.agentCallsStarted += 1;
          let completeAgentSetup = () => {};
          try {
            if (active.cancelRequested) {
              return { result: "Cancelled before the provider turn started." };
            }
            active.agentSetupComplete = new Promise<void>((resolve) => {
              completeAgentSetup = resolve;
            });
            const threadRequest = {
              projectId: input.projectId,
              title: `[Monkey.D.Loopy] ${spec.meta?.name ?? spec.id}`,
              modelSelection: input.modelSelection,
              runtimeMode: input.runtimeMode,
              branch: null,
              worktreePath: null,
            } as const;
            const threadId = await runHarness(harness.createThread(threadRequest));
            threadIds.push(threadId);
            active.activeThreadId = threadId;
            if (!active.threadIds.includes(threadId)) active.threadIds.push(threadId);
            if (observer) await runHarness(observer.onThreadCreated(threadId));
            completeAgentSetup();
            completeAgentSetup = () => {};
            active.agentSetupComplete = null;
            if (active.cancelRequested) {
              return { result: "Cancelled before the provider turn started." };
            }
            const startTurn = harness.startTurn({
              threadId,
              prompt: request.prompt,
              modelSelection: input.modelSelection,
              runtimeMode: input.runtimeMode,
              titleSeed: spec.meta?.name ?? spec.id,
            });
            let completeTurnStart = () => {};
            active.turnStartComplete = new Promise<void>((resolve) => {
              completeTurnStart = resolve;
            });
            try {
              await runHarness(startTurn);
              active.turnStarted = true;
            } finally {
              completeTurnStart();
              active.turnStartComplete = null;
            }
            if (active.cancelRequested) {
              const cancellationSettled = active.turnCancellationSettled;
              if (cancellationSettled !== null) await cancellationSettled;
              if (active.cancelRequested) {
                return { result: "Cancelled as the provider turn started." };
              }
            }
            const result = await runHarness(
              harness
                .awaitTurn({
                  threadId,
                  timeoutMs: input.timeoutMinutes * 60_000,
                  approvalHandling: "fail",
                })
                .pipe(
                  Effect.tapError(() => harness.interrupt(threadId).pipe(Effect.ignore)),
                  Effect.onInterrupt(() => harness.interrupt(threadId).pipe(Effect.ignore)),
                ),
            );
            lastOutput = result.output;
            return { result: result.output };
          } finally {
            completeAgentSetup();
            active.agentSetupComplete = null;
            active.turnStarted = false;
            active.agentCallsCompleted += 1;
            active.activeThreadId = null;
            active.phase = active.cancelRequested ? "stopping" : "running";
          }
        },
      },
      effects: {
        shell: async () => {
          throw new Error(
            "Direct shell effects are disabled in the Not Codex integration; use a not-codex agent step.",
          );
        },
        http: async () => {
          throw new Error(
            "Direct HTTP effects are disabled in the Not Codex integration; use a not-codex agent step.",
          );
        },
      },
    });
    active.runtime = runtime;
    active.phase = active.cancelRequested ? "stopping" : "running";
    if (active.cancelRequested) {
      yield* Effect.try({
        try: () => requestRuntimeStop(runtime),
        catch: (cause) => requestError("Could not request a graceful Loopy stop.", cause),
      });
    }
    const result = yield* Effect.tryPromise({
      try: () =>
        operation === "resume"
          ? runtime.resume({ actor: "not-codex", reason: "Authorized journal recovery" })
          : runtime.run(),
      catch: (cause) => requestError("Monkey.D.Loopy execution failed.", cause),
    });
    const state: MonkeyLoopyExecutionResult["state"] = active.cancelRequested
      ? "cancelled"
      : result.status === "completed"
        ? "succeeded"
        : result.status === "waiting" || result.status === "paused"
          ? "waiting"
          : result.status === "stopped"
            ? "cancelled"
            : "failed";
    active.phase = state === "waiting" ? "waiting" : "terminal";
    const serializedState = yield* encodeUnknownJson(result.state).pipe(
      Effect.mapError((cause) =>
        requestError("Could not serialize the Monkey.D.Loopy result state.", cause),
      ),
    );
    return {
      runId,
      state,
      output: lastOutput || serializedState,
      threadIds,
      journalPath: path.join(journalBase, ".loopy", "runs", runId),
      error: result.status === "failed" ? (result.reason ?? "Loop execution failed.") : null,
    };
  });

  const run: MonkeyLoopyService["Service"]["run"] = (input, suppliedRunId, observer) =>
    execute(input, suppliedRunId, observer, "run", false);

  const resume: MonkeyLoopyService["Service"]["resume"] = Effect.fn("MonkeyLoopyService.resume")(
    function* (input, runId, approveCaps, observer) {
      yield* verifyJournal(input, runId, false);
      return yield* execute(input, runId, observer, "resume", approveCaps);
    },
  );

  const inspectRun: MonkeyLoopyService["Service"]["inspectRun"] = (runId) =>
    Effect.sync(() => {
      const active = activeRuns.get(runId);
      return active ? runtimeSnapshot(active) : null;
    });

  const cancelRunLocked = Effect.fn("MonkeyLoopyService.cancelRunLocked")(function* (
    runId: IntegrationRunId,
  ) {
    const active = activeRuns.get(runId);
    if (!active) return null;
    if (active.phase === "terminal") return runtimeSnapshot(active);
    const previousPhase = active.phase;
    const pendingTurnStart = active.turnStartComplete;
    const initialActiveThreadId =
      active.activeThreadId !== null && active.turnStarted ? active.activeThreadId : null;
    let settleTurnCancellation = () => {};
    const turnCancellationSettled =
      pendingTurnStart !== null || initialActiveThreadId !== null
        ? new Promise<void>((resolve) => {
            settleTurnCancellation = resolve;
          })
        : null;
    active.turnCancellationSettled = turnCancellationSettled;
    const finishTurnCancellation = () => {
      settleTurnCancellation();
      if (active.turnCancellationSettled === turnCancellationSettled) {
        active.turnCancellationSettled = null;
      }
    };
    const cancellationWasAlreadyRequested = active.cancelRequested;
    const hadCancellationDiagnostic = active.diagnostics.includes("Cancellation requested");
    const hadSetupDiagnostic = active.diagnostics.includes(
      "Agent setup is still finishing after cancellation",
    );
    const rollbackCancellation = () => {
      if (cancellationWasAlreadyRequested) {
        finishTurnCancellation();
        return;
      }
      active.cancelRequested = false;
      active.phase = previousPhase;
      if (!hadCancellationDiagnostic) {
        const index = active.diagnostics.indexOf("Cancellation requested");
        if (index >= 0) active.diagnostics.splice(index, 1);
      }
      if (!hadSetupDiagnostic) {
        const index = active.diagnostics.indexOf(
          "Agent setup is still finishing after cancellation",
        );
        if (index >= 0) active.diagnostics.splice(index, 1);
      }
      finishTurnCancellation();
    };
    const runtime = active.runtime;
    let runtimeStopRequested = false;
    if (runtime !== null && initialActiveThreadId === null && pendingTurnStart === null) {
      yield* Effect.try({
        try: () => requestRuntimeStop(runtime),
        catch: (cause) => requestError("Could not request a graceful Loopy stop.", cause),
      });
      runtimeStopRequested = true;
    }
    active.cancelRequested = true;
    active.phase = "stopping";
    if (!active.diagnostics.includes("Cancellation requested")) {
      active.diagnostics.push("Cancellation requested");
    }
    const setup = active.agentSetupComplete;
    if (setup !== null) {
      const setupFinished = yield* Effect.promise(() => setup).pipe(
        Effect.timeoutOption(CANCEL_SETUP_GRACE_PERIOD),
        Effect.onInterrupt(() => Effect.sync(rollbackCancellation)),
      );
      if (
        Option.isNone(setupFinished) &&
        !active.diagnostics.includes("Agent setup is still finishing after cancellation")
      ) {
        active.diagnostics.push("Agent setup is still finishing after cancellation");
      }
    }
    if (pendingTurnStart !== null) {
      yield* Effect.promise(() => pendingTurnStart).pipe(
        Effect.onInterrupt(() => Effect.sync(rollbackCancellation)),
      );
    }
    const activeThreadId =
      active.activeThreadId !== null && active.turnStarted ? active.activeThreadId : null;
    if (activeThreadId !== null) {
      yield* harness.interrupt(activeThreadId).pipe(
        Effect.mapError((cause) =>
          requestError("Could not interrupt the active agent turn.", cause),
        ),
        Effect.tapError(() => Effect.sync(rollbackCancellation)),
        Effect.onInterrupt(() => Effect.sync(rollbackCancellation)),
      );
    }
    if (runtime !== null && !runtimeStopRequested) {
      yield* Effect.try({
        try: () => requestRuntimeStop(runtime),
        catch: (cause) => requestError("Could not request a graceful Loopy stop.", cause),
      }).pipe(
        Effect.tapError(() => Effect.sync(rollbackCancellation)),
        Effect.onInterrupt(() => Effect.sync(rollbackCancellation)),
      );
    }
    finishTurnCancellation();
    return runtimeSnapshot(active);
  });

  const cancelRun: MonkeyLoopyService["Service"]["cancelRun"] = (runId) =>
    runCancellations.withPermit(runId)(cancelRunLocked(runId));

  const releaseRun: MonkeyLoopyService["Service"]["releaseRun"] = (runId) =>
    Effect.sync(() => void activeRuns.delete(runId));

  return MonkeyLoopyService.of({
    getAuthoringContext,
    scaffold,
    infer,
    validate,
    run,
    resume,
    verifyJournal,
    inspectRun,
    cancelRun,
    releaseRun,
  });
});

export const MonkeyLoopyServiceLive = Layer.effect(MonkeyLoopyService, makeMonkeyLoopyService);
