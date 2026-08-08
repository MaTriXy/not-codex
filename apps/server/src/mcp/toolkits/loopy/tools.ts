import {
  IntegrationRequestError,
  MonkeyLoopyAuthoringContextResult,
  MonkeyLoopyInferInput,
  MonkeyLoopyInferResult,
  MonkeyLoopyScaffoldInput,
  MonkeyLoopyScaffoldResult,
  MonkeyLoopyValidateInput,
  MonkeyLoopyValidateResult,
} from "@notcodex/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import { IntegrationService } from "../../../integrations/Services/IntegrationService.ts";

const annotateSafeAuthoringTool = <A extends Tool.Any>(tool: A): A =>
  tool
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false) as A;

export const LoopyGetSchemaTool = annotateSafeAuthoringTool(
  Tool.make("get_loop_schema", {
    description:
      "Return the installed Monkey D. Loopy authoring guide, verified recipe catalog, blueprints, source URLs, and execution safety boundary. Read this before authoring a loop.",
    parameters: Schema.Struct({}),
    success: MonkeyLoopyAuthoringContextResult,
    failure: IntegrationRequestError,
    dependencies: [IntegrationService],
  }).annotate(Tool.Title, "Get Monkey D. Loopy authoring context"),
);

export const LoopyListRecipesTool = annotateSafeAuthoringTool(
  Tool.make("list_recipes", {
    description:
      "List the installed verified recipes and blueprints, including schedule intent, required inputs, minimum score, and safety rationale.",
    parameters: Schema.Struct({}),
    success: MonkeyLoopyAuthoringContextResult,
    failure: IntegrationRequestError,
    dependencies: [IntegrationService],
  }).annotate(Tool.Title, "List Monkey D. Loopy recipes"),
);

export const LoopyListBlueprintsTool = annotateSafeAuthoringTool(
  Tool.make("list_blueprints", {
    description:
      "List the installed structural blueprints. Use a verified recipe instead when one matches the desired outcome.",
    parameters: Schema.Struct({}),
    success: MonkeyLoopyAuthoringContextResult,
    failure: IntegrationRequestError,
    dependencies: [IntegrationService],
  }).annotate(Tool.Title, "List Monkey D. Loopy blueprints"),
);

export const LoopyNewLoopTool = annotateSafeAuthoringTool(
  Tool.make("new_loop", {
    description:
      "Scaffold a LoopSpec from exactly one installed verified recipe or blueprint. The result is not automatically execution-ready; validate and verify it after adapting provider and effects intentionally.",
    parameters: MonkeyLoopyScaffoldInput,
    success: MonkeyLoopyScaffoldResult,
    failure: IntegrationRequestError,
    dependencies: [IntegrationService],
  }).annotate(Tool.Title, "Scaffold Monkey D. Loopy spec"),
);

export const LoopyInferTool = annotateSafeAuthoringTool(
  Tool.make("infer_loop_scaffold", {
    description:
      "Deterministically infer a draft LoopSpec and FactPack from JavaScript, TypeScript, shell, or a .loopy journal. No commands or agents are executed.",
    parameters: MonkeyLoopyInferInput,
    success: MonkeyLoopyInferResult,
    failure: IntegrationRequestError,
    dependencies: [IntegrationService],
  }).annotate(Tool.Title, "Infer Monkey D. Loopy scaffold"),
);

export const LoopyValidateTool = annotateSafeAuthoringTool(
  Tool.make("validate_loop", {
    description:
      "Validate a LoopSpec with the installed authoring rules, then dry-run it with the compatible verifier and check the Not Codex harness policy. This tool never executes the loop.",
    parameters: MonkeyLoopyValidateInput,
    success: MonkeyLoopyValidateResult,
    failure: IntegrationRequestError,
    dependencies: [IntegrationService],
  }).annotate(Tool.Title, "Validate Monkey.D.Loopy spec"),
);

export const LoopyVerifyTool = annotateSafeAuthoringTool(
  Tool.make("verify_loop", {
    description:
      "Run the installed mocked-effect verifier and Not Codex execution policy after authoring validation. It proves bounded control flow for compatible specs but never performs real effects.",
    parameters: MonkeyLoopyValidateInput,
    success: MonkeyLoopyValidateResult,
    failure: IntegrationRequestError,
    dependencies: [IntegrationService],
  }).annotate(Tool.Title, "Verify Monkey D. Loopy spec"),
);

export const LoopyToolkit = Toolkit.make(
  LoopyGetSchemaTool,
  LoopyListBlueprintsTool,
  LoopyListRecipesTool,
  LoopyNewLoopTool,
  LoopyInferTool,
  LoopyValidateTool,
  LoopyVerifyTool,
);
