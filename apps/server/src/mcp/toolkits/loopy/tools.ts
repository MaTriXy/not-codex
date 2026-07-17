import {
  IntegrationRequestError,
  MonkeyLoopyValidateInput,
  MonkeyLoopyValidateResult,
} from "@notcodex/contracts";
import { Tool, Toolkit } from "effect/unstable/ai";

import { IntegrationService } from "../../../integrations/Services/IntegrationService.ts";

export const LoopyValidateTool = Tool.make("loopy_validate", {
  description:
    "Validate and dry-run verify a Monkey.D.Loopy YAML specification for execution through Not Codex. This tool never executes the loop.",
  parameters: MonkeyLoopyValidateInput,
  success: MonkeyLoopyValidateResult,
  failure: IntegrationRequestError,
  dependencies: [IntegrationService],
})
  .annotate(Tool.Title, "Validate Monkey.D.Loopy spec")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const LoopyToolkit = Toolkit.make(LoopyValidateTool);
