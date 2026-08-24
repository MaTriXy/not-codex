import * as NodeAssert from "node:assert/strict";

import { describe, it } from "vite-plus/test";

import {
  parseAgentListCliOutput,
  parseModelsCliOutput,
  parseSkillsCliOutput,
} from "./opencodeRuntime.ts";

describe("parseModelsCliOutput", () => {
  it("parses models from multiple providers and tolerates CRLF", () => {
    const stdout = [
      "anthropic/claude-sonnet-4-5",
      JSON.stringify({ id: "claude-sonnet-4-5", providerID: "anthropic", name: "Sonnet" }),
      "openai/gpt-5.4",
      JSON.stringify({
        id: "gpt-5.4",
        providerID: "openai",
        name: "GPT-5.4",
        variants: { low: {}, medium: {}, high: {} },
      }),
    ].join("\r\n");

    const result = parseModelsCliOutput(stdout);
    NodeAssert.deepEqual([...result.connected].sort(), ["anthropic", "openai"]);
    NodeAssert.equal(
      result.providers.get("anthropic")?.models["claude-sonnet-4-5"]?.name,
      "Sonnet",
    );
    NodeAssert.ok(result.providers.get("openai")?.models["gpt-5.4"]?.variants?.medium);
  });

  it("skips malformed model blocks without dropping healthy ones", () => {
    const result = parseModelsCliOutput(
      [
        "broken/model",
        "not-json",
        "anthropic/haiku",
        JSON.stringify({ id: "haiku", providerID: "anthropic", name: "Haiku" }),
      ].join("\n"),
    );
    NodeAssert.equal(result.providers.size, 1);
    NodeAssert.equal(result.providers.get("anthropic")?.models.haiku?.name, "Haiku");
  });

  it("keeps a model whose JSON body contains a slash and no interior whitespace", () => {
    const stdout = [
      "openrouter/qwen/qwen3-coder",
      JSON.stringify({
        id: "qwen/qwen3-coder",
        providerID: "openrouter",
        name: "qwen3-coder",
        status: "active",
      }),
    ].join("\n");

    const result = parseModelsCliOutput(stdout);
    NodeAssert.equal(result.providers.size, 1);
    NodeAssert.deepEqual([...result.connected], ["openrouter"]);
    NodeAssert.equal(
      result.providers.get("openrouter")?.models["qwen/qwen3-coder"]?.id,
      "qwen/qwen3-coder",
    );
  });
});

describe("parseAgentListCliOutput", () => {
  it("parses custom agents, names with spaces, and known hidden agents", () => {
    const permission = JSON.stringify([{ permission: "*", action: "allow", pattern: "*" }]);
    const result = parseAgentListCliOutput(
      ["code reviewer (subagent)", permission, "compaction (primary)", permission].join("\n"),
    );
    NodeAssert.deepEqual(
      result.map(({ name, mode, hidden }) => ({ name, mode, hidden })),
      [
        { name: "code reviewer", mode: "subagent", hidden: false },
        { name: "compaction", mode: "primary", hidden: true },
      ],
    );
  });

  it("skips malformed permission blocks", () => {
    const result = parseAgentListCliOutput(
      [
        "broken (primary)",
        "not-json",
        "build (primary)",
        JSON.stringify([{ permission: "*", action: "allow", pattern: "*" }]),
      ].join("\n"),
    );
    NodeAssert.deepEqual(
      result.map((agent) => agent.name),
      ["build"],
    );
  });
});

describe("parseSkillsCliOutput", () => {
  it("parses only skill metadata from the CLI JSON output", () => {
    const result = parseSkillsCliOutput(
      JSON.stringify([
        {
          name: "review-pr",
          description: "Review a pull request.",
          location: "/tmp/review-pr/SKILL.md",
          content: "---\nname: review-pr\n---\n",
        },
      ]),
    );

    NodeAssert.deepEqual(result, [
      {
        name: "review-pr",
        description: "Review a pull request.",
        location: "/tmp/review-pr/SKILL.md",
      },
    ]);
  });

  it("degrades malformed output to an empty skill list", () => {
    NodeAssert.deepEqual(parseSkillsCliOutput("not json"), []);
  });
});
