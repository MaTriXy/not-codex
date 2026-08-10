import { TextGenerationError, type ModelSelection, type PiSettings } from "@notcodex/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@notcodex/shared/git";
import { getModelSelectionStringOptionValue } from "@notcodex/shared/model";
import { extractJsonObject } from "@notcodex/shared/schemaJson";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { PiRuntime } from "../provider/piRuntime.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

const PI_TEXT_GENERATION_TIMEOUT = "3 minutes";
const isTextGenerationError = Schema.is(TextGenerationError);

function parseModelSlug(
  slug: string,
): { readonly provider: string; readonly modelId: string } | undefined {
  const separator = slug.indexOf("/");
  if (separator <= 0 || separator === slug.length - 1) return undefined;
  return { provider: slug.slice(0, separator), modelId: slug.slice(separator + 1) };
}

export const makePiTextGeneration = Effect.fn("makePiTextGeneration")(function* (
  settings: PiSettings,
  environment?: NodeJS.ProcessEnv,
) {
  const runtime = yield* PiRuntime;

  const runPiJson = <S extends Schema.Top>(input: {
    readonly operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle";
    readonly cwd: string;
    readonly prompt: string;
    readonly outputSchema: S;
    readonly modelSelection: ModelSelection;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.scoped(
      Effect.gen(function* () {
        const model = parseModelSlug(input.modelSelection.model);
        if (!model) {
          return yield* new TextGenerationError({
            operation: input.operation,
            detail: "Pi model selection must use the 'provider/model' format.",
          });
        }
        const process = yield* runtime.start({
          binaryPath: settings.binaryPath,
          cwd: input.cwd,
          environment: {
            ...environment,
            ...(settings.agentDir ? { PI_CODING_AGENT_DIR: settings.agentDir } : {}),
          },
          args: [
            "--mode",
            "rpc",
            "--no-session",
            "--no-tools",
            "--no-extensions",
            "--no-skills",
            "--no-prompt-templates",
            "--no-context-files",
            "--no-approve",
          ],
        });
        yield* process.client.request({
          type: "set_model",
          provider: model.provider,
          modelId: model.modelId,
        });
        const thinking = getModelSelectionStringOptionValue(input.modelSelection, "thinking");
        if (thinking)
          yield* process.client.request({ type: "set_thinking_level", level: thinking });

        const output = yield* Ref.make("");
        const settled = yield* Deferred.make<void>();
        const eventFiber = yield* process.client.events.pipe(
          Stream.runForEach((event) => {
            if (event.type === "agent_settled")
              return Deferred.succeed(settled, undefined).pipe(Effect.asVoid);
            if (event.type !== "message_update") return Effect.void;
            const update = event.assistantMessageEvent;
            if (
              typeof update !== "object" ||
              update === null ||
              Array.isArray(update) ||
              (update as Record<string, unknown>).type !== "text_delta" ||
              typeof (update as Record<string, unknown>).delta !== "string"
            ) {
              return Effect.void;
            }
            return Ref.update(
              output,
              (current) => current + String((update as Record<string, unknown>).delta),
            );
          }),
          Effect.forkScoped,
        );
        yield* process.client.request({ type: "prompt", message: input.prompt });
        yield* Deferred.await(settled).pipe(Effect.timeout(PI_TEXT_GENERATION_TIMEOUT));
        yield* Fiber.interrupt(eventFiber);
        const text = (yield* Ref.get(output)).trim();
        if (!text) {
          return yield* new TextGenerationError({
            operation: input.operation,
            detail: "Pi returned empty text-generation output.",
          });
        }
        const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(input.outputSchema));
        return yield* decodeOutput(extractJsonObject(text));
      }).pipe(
        Effect.mapError((cause) =>
          isTextGenerationError(cause)
            ? cause
            : new TextGenerationError({
                operation: input.operation,
                detail: "Pi text-generation request failed or returned invalid structured output.",
                cause,
              }),
        ),
      ),
    );

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("PiTextGeneration.generateCommitMessage")(function* (input) {
      const built = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
      });
      const generated = yield* runPiJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchema: built.outputSchema,
        modelSelection: input.modelSelection,
      });
      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("PiTextGeneration.generatePrContent")(function* (input) {
      const built = buildPrContentPrompt(input);
      const generated = yield* runPiJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchema: built.outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizePrTitle(generated.title), body: generated.body.trim() };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("PiTextGeneration.generateBranchName")(function* (input) {
      const built = buildBranchNamePrompt(input);
      const generated = yield* runPiJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchema: built.outputSchema,
        modelSelection: input.modelSelection,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("PiTextGeneration.generateThreadTitle")(function* (input) {
      const built = buildThreadTitlePrompt(input);
      const generated = yield* runPiJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt: built.prompt,
        outputSchema: built.outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizeThreadTitle(generated.title) };
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGeneration.TextGeneration["Service"];
});
