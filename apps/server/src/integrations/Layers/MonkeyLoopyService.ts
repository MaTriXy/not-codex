import { loadSpecFromYaml, type LoopSpec, type Step } from "@loopyc/core";
import {
  BUILTIN_RECIPE_CATALOG,
  FACTORY_VERSION,
  getBlueprint,
  instantiateRecipe,
  listBlueprints,
  loadSpecFromYaml as loadAuthoringSpecFromYaml,
  LOOPSPEC_GUIDE,
} from "@loopyc/core-v5";
import { inferScaffold } from "@loopyc/infer";
import { createRuntime } from "@loopyc/runtime";
import { interpretLoop, scoreLoop, verifyLoop } from "@loopyc/verify";
import {
  IntegrationRequestError,
  type MonkeyLoopyDiagnostic,
  type ThreadId,
} from "@notcodex/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
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
import { MonkeyLoopyService } from "../Services/MonkeyLoopyService.ts";

const encodeUnknownJson = Schema.encodeUnknownEffect(Schema.UnknownFromJsonString);

const INTEGRATION_DIRECTORY = "integrations/monkey-d-loopy";

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
  if (processed.spec) diagnostics.push(...unsupportedHarnessDiagnostics(processed.spec));
  return {
    spec: processed.spec,
    capsInjected: processed.capsInjected ?? false,
    diagnostics,
  };
}

function parseAuthoringDiagnostics(yaml: string): {
  readonly name: string | null;
  readonly diagnostics: MonkeyLoopyDiagnostic[];
} {
  const processed = loadAuthoringSpecFromYaml(yaml);
  return {
    name: processed.spec?.meta?.name ?? processed.spec?.id ?? null,
    diagnostics: [
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
    ],
  };
}

export const makeMonkeyLoopyService = Effect.gen(function* () {
  const harness = yield* AgentHarnessRunner;
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const journalBase = path.join(config.stateDir, INTEGRATION_DIRECTORY);

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
    const authoring = yield* Effect.try({
      try: () => parseAuthoringDiagnostics(input.yaml),
      catch: (cause) => requestError("Monkey.D.Loopy could not parse the specification.", cause),
    });
    const authoringHasErrors = authoring.diagnostics.some(
      (diagnostic) => diagnostic.level === "error",
    );
    if (authoringHasErrors) {
      return {
        valid: false,
        verified: false,
        executionReady: false,
        score: null,
        name: authoring.name,
        factoryVersion: FACTORY_VERSION,
        executionVersion: MONKEY_D_LOOPY_EXECUTION_VERSION,
        diagnostics: authoring.diagnostics,
      };
    }

    const parsed = yield* Effect.try({
      try: () => parseDiagnostics(input.yaml),
      catch: (cause) => requestError("Monkey.D.Loopy execution compatibility failed.", cause),
    });
    const hasErrors = parsed.diagnostics.some((diagnostic) => diagnostic.level === "error");
    if (!parsed.spec || hasErrors) {
      return {
        valid: true,
        verified: false,
        executionReady: false,
        score: null,
        name: authoring.name,
        factoryVersion: FACTORY_VERSION,
        executionVersion: MONKEY_D_LOOPY_EXECUTION_VERSION,
        diagnostics: [...authoring.diagnostics, ...parsed.diagnostics],
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
      name: authoring.name,
      factoryVersion: FACTORY_VERSION,
      executionVersion: MONKEY_D_LOOPY_EXECUTION_VERSION,
      diagnostics: [
        ...authoring.diagnostics,
        ...parsed.diagnostics,
        ...report.issues.map((issue) => ({
          level: issue.severity,
          message: issue.message,
          path: null,
        })),
      ],
    };
  });

  const run: MonkeyLoopyService["Service"]["run"] = Effect.fn("MonkeyLoopyService.run")(
    function* (input) {
      const parsed = yield* Effect.try({
        try: () => parseDiagnostics(input.yaml),
        catch: (cause) => requestError("Monkey.D.Loopy could not parse the specification.", cause),
      });
      const hasErrors = parsed.diagnostics.some((diagnostic) => diagnostic.level === "error");
      if (!parsed.spec || hasErrors) {
        return yield* new IntegrationRequestError({
          code: "validation-failed",
          message:
            parsed.diagnostics.find((item) => item.level === "error")?.message ??
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

      const runId = `monkey-${yield* crypto.randomUUIDv4.pipe(
        Effect.mapError((cause) => requestError("Could not create a Loopy run id.", cause)),
      )}`;
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
      const runtime = createRuntime(interpretLoop(parsed.spec), {
        cwd: journalBase,
        runId,
        inputs: input.inputs,
        env: {},
        effectEnv: {},
        autoApprove: false,
        maxBlockMs: 0,
        agentHarnesses: {
          "not-codex": async (request) => {
            const result = await runHarness(
              harness.run({
                projectId: input.projectId,
                title: `[Monkey.D.Loopy] ${parsed.spec!.meta?.name ?? parsed.spec!.id}`,
                prompt: request.prompt,
                modelSelection: input.modelSelection,
                runtimeMode: input.runtimeMode,
                branch: null,
                worktreePath: null,
                timeoutMs: input.timeoutMinutes * 60_000,
                approvalHandling: "fail",
                titleSeed: parsed.spec!.meta?.name ?? parsed.spec!.id,
              }),
            );
            threadIds.push(result.threadId);
            lastOutput = result.output;
            return { result: result.output };
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
      const result = yield* Effect.tryPromise({
        try: () => runtime.run(),
        catch: (cause) => requestError("Monkey.D.Loopy execution failed.", cause),
      });
      const state =
        result.status === "completed"
          ? "succeeded"
          : result.status === "waiting" || result.status === "paused"
            ? "waiting"
            : result.status === "stopped"
              ? "cancelled"
              : "failed";
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
    },
  );

  return MonkeyLoopyService.of({ getAuthoringContext, scaffold, infer, validate, run });
});

export const MonkeyLoopyServiceLive = Layer.effect(MonkeyLoopyService, makeMonkeyLoopyService);
