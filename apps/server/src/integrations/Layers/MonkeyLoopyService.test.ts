import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ProviderInstanceId, ThreadId, TurnId } from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vite-plus/test";

import { ServerConfig } from "../../config.ts";
import { AgentHarnessRunner } from "../../orchestration/Services/AgentHarnessRunner.ts";
import { MonkeyLoopyService } from "../Services/MonkeyLoopyService.ts";
import { MonkeyLoopyServiceLive } from "./MonkeyLoopyService.ts";

const validSpec = `
loopspec: "0.1"
id: not-codex-smoke
meta:
  name: Not Codex smoke loop
pattern: react
state:
  store: journal
  vars:
    agent_runs: { type: int, init: 0 }
body:
  - id: ask-agent
    kind: agent
    harness: not-codex
    prompt: Complete one safe step.
    on_done: { incr: agent_runs }
terminate:
  signal: state-predicate
  until: "\${state.agent_runs >= 1}"
caps:
  max_iterations: 2
  on_cap_exceeded: fail
schedule: { mode: manual }
`;

function makeTestLayer(outputs: string[]) {
  const harness = AgentHarnessRunner.of({
    createThread: () => Effect.die("unused"),
    startTurn: () => Effect.die("unused"),
    interrupt: () => Effect.die("unused"),
    awaitTurn: () => Effect.die("unused"),
    run: (request) =>
      Effect.sync(() => {
        outputs.push(request.prompt);
        return {
          threadId: ThreadId.make("thread-loopy-1"),
          turnId: TurnId.make("turn-loopy-1"),
          state: "completed" as const,
          output: "safe step complete",
        };
      }),
  });
  const configLayer = ServerConfig.layerTest("/workspace", { prefix: "not-codex-loopy-test" }).pipe(
    Layer.provide(NodeServices.layer),
  );
  return MonkeyLoopyServiceLive.pipe(
    Layer.provide(Layer.succeed(AgentHarnessRunner, harness)),
    Layer.provide(configLayer),
    Layer.provide(NodeServices.layer),
  );
}

describe("MonkeyLoopyService", () => {
  it("rejects agent harnesses that bypass Not Codex", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const loopy = yield* MonkeyLoopyService;
          return yield* loopy.validate({
            yaml: validSpec.replace("harness: not-codex", "harness: claude-code"),
          });
        }).pipe(Effect.provide(makeTestLayer([]))),
      ),
    );

    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((item) => item.message.includes("not allowed"))).toBe(true);
  });

  it("runs a verified loop through the shared Not Codex harness and returns its journal", async () => {
    const prompts: string[] = [];
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const loopy = yield* MonkeyLoopyService;
          const validation = yield* loopy.validate({ yaml: validSpec });
          const run = yield* loopy.run({
            projectId: ProjectId.make("project-1"),
            yaml: validSpec,
            inputs: {},
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
            runtimeMode: "approval-required",
            timeoutMinutes: 5,
          });
          return { validation, run };
        }).pipe(Effect.provide(makeTestLayer(prompts))),
      ),
    );

    expect(result.validation.valid).toBe(true);
    expect(result.validation.verified).toBe(true);
    expect(prompts).toEqual(["Complete one safe step."]);
    expect(result.run.state).toBe("succeeded");
    expect(result.run.output).toBe("safe step complete");
    expect(result.run.threadIds).toEqual([ThreadId.make("thread-loopy-1")]);
    expect(result.run.journalPath).toContain("integrations/monkey-d-loopy/.loopy/runs/monkey-");
  });
});
