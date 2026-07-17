import { Tool } from "effect/unstable/ai";
import { describe, expect, it } from "vite-plus/test";

import { LoopyToolkit, LoopyValidateTool } from "./tools.ts";

describe("Loopy MCP toolkit", () => {
  it("exposes validation only as a read-only, non-destructive tool", () => {
    expect(Object.keys(LoopyToolkit.tools)).toEqual(["loopy_validate"]);
    expect(Tool.getDescription(LoopyValidateTool)).toContain("never executes");
  });
});
