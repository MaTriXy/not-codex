import { loadSpecFromYaml, type LoopSpec, type Step } from "@loopyc/core";
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
import { MonkeyLoopyService } from "../Services/MonkeyLoopyService.ts";

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

export const makeMonkeyLoopyService = Effect.gen(function* () {
  const harness = yield* AgentHarnessRunner;
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const journalBase = path.join(config.stateDir, INTEGRATION_DIRECTORY);

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
        score: null,
        name: parsed.spec?.meta?.name ?? parsed.spec?.id ?? null,
        diagnostics: parsed.diagnostics,
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
      score: score.total,
      name: parsed.spec.meta?.name ?? parsed.spec.id,
      diagnostics: [
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
            const result = await Effect.runPromise(
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
      const serializedState = yield* Schema.encodeUnknownEffect(Schema.UnknownFromJsonString)(
        result.state,
      ).pipe(
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

  return MonkeyLoopyService.of({ validate, run });
});

export const MonkeyLoopyServiceLive = Layer.effect(MonkeyLoopyService, makeMonkeyLoopyService);
