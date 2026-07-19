import { Tool } from "effect/unstable/ai";
import { describe, expect, it } from "vite-plus/test";

import { LoopyInferTool, LoopyToolkit, LoopyValidateTool } from "./tools.ts";

describe("Loopy MCP toolkit", () => {
  it("exposes the canonical agent authoring flow as safe, non-executing tools", () => {
    expect(Object.keys(LoopyToolkit.tools)).toEqual([
      "get_loop_schema",
      "list_blueprints",
      "list_recipes",
      "new_loop",
      "infer_loop_scaffold",
      "validate_loop",
      "verify_loop",
    ]);
    expect(Tool.getDescription(LoopyValidateTool)).toContain("never executes");
    expect(Tool.getDescription(LoopyInferTool)).toContain("No commands or agents are executed");
  });
});
