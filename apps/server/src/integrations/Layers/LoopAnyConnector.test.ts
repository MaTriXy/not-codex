// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";

import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  buildLoopAnyPollBody,
  buildLoopAnyWorkflowFallbackTask,
  buildLoopAnyWorkflowWrapper,
  isPathWithinRoots,
} from "./LoopAnyConnector.ts";

const decodeJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);
const encodeJson = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);
const marker = "__NOT_CODEX_LOOPANY_RESULT__";

function runWorkflow(body: string, previous: unknown) {
  const encodedPrevious = encodeJson(previous);
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    [
      "--permission",
      "--disable-warning=ExperimentalWarning",
      "--eval",
      buildLoopAnyWorkflowWrapper(body),
    ],
    { encoding: "utf8", timeout: 5_000, input: encodedPrevious },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `workflow exited ${result.status}`);
  return decodeJson(result.stdout.slice(result.stdout.lastIndexOf(marker) + marker.length));
}

describe("LoopAny connector safety", () => {
  it("keeps work directories inside exact realpath roots", () => {
    expect(isPathWithinRoots("/workspace/project", ["/workspace"], "/")).toBe(true);
    expect(isPathWithinRoots("/workspace", ["/workspace"], "/")).toBe(true);
    expect(isPathWithinRoots("/workspace-escape/project", ["/workspace"], "/")).toBe(false);
  });

  it("long-polls only while idle and sends heartbeats for in-flight runs", () => {
    expect(buildLoopAnyPollBody({ host: "not-codex" }, new Set())).toEqual({
      host: "not-codex",
      wait: true,
    });
    expect(buildLoopAnyPollBody({ host: "not-codex" }, new Set(["run-1"]))).toEqual({
      host: "not-codex",
      progress: [{ runId: "run-1", step: 0, label: "Running in Not Codex" }],
    });
  });

  it("runs a pure workflow with previous state and records agent escalation", () => {
    expect(
      runWorkflow(
        `agent("continue", { count: prev.count }); return { message: "seen", state: { count: prev.count + 1 } };`,
        { count: 2 },
      ),
    ).toEqual({
      message: "seen",
      state: { count: 3 },
      agentCalls: [{ message: "continue", data: { count: 2 } }],
    });
  });

  it("denies filesystem reads inside the workflow subprocess", () => {
    expect(() =>
      runWorkflow(
        `const { readFileSync } = await import("node:fs"); return readFileSync("/etc/passwd", "utf8");`,
        null,
      ),
    ).toThrow();
  });

  it("preserves the original task and diagnostic context for workflow fallback", () => {
    const prompt = buildLoopAnyWorkflowFallbackTask(
      "Review the repository.",
      "tools.call is unavailable",
      "return tools.call('github', {});",
    );

    expect(prompt).toContain("Review the repository.");
    expect(prompt).toContain("tools.call is unavailable");
    expect(prompt).toContain("return tools.call");
    expect(prompt).toContain("must not be advanced");
  });
});
