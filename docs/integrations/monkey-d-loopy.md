# Monkey D. Loopy

[Monkey D. Loopy](https://github.com/MaTriXy/Monkey.D.Loopy) defines bounded, verifiable,
crash-resumable agent loops as YAML LoopSpecs. Not Codex follows the canonical
[agent guide](https://matrixy.github.io/Monkey.D.Loopy/agent-guide): start from the smallest useful
context, prefer a verified recipe, name external completion evidence, make every cap explicit, then
validate and verify before execution.

Agent-readable context is available at
[`llms.txt`](https://matrixy.github.io/Monkey.D.Loopy/llms.txt) and
[`llms-full.txt`](https://matrixy.github.io/Monkey.D.Loopy/llms-full.txt).

## Version boundary

Not Codex deliberately separates authoring compatibility from execution compatibility:

- `@loopyc/core` 0.5.0 provides the canonical schema guide, blueprints, verified recipe catalog,
  provenance, and authoring validation;
- `@loopyc/infer` 0.5.0 provides deterministic FactPack and draft-spec inference for shell,
  JavaScript, TypeScript, and `.loopy` journal content;
- the complete `@loopyc/core` / `@loopyc/runtime` / `@loopyc/verify` 0.1.0 set remains isolated as
  the embedded executor because npm does not currently publish runtime and verify 0.5.0 packages.

A spec can therefore be **authoring-valid** without being **execution-ready**. Not Codex only marks a
spec execution-ready when it also passes the installed dry-run verifier and the Not Codex harness
policy. It never mixes a 0.5 spec object directly into the 0.1 runtime.

## Agent and MCP workflow

The Not Codex MCP toolkit mirrors the safe, non-executing part of the official v0.5 agent flow:

1. `get_loop_schema` returns the authoring guide, source URLs, blueprints, recipes, and installed
   version boundary;
2. `list_blueprints` and `list_recipes` expose structural starting points and verified outcomes;
3. `new_loop` instantiates exactly one recipe or blueprint without rewriting its provider or tools;
4. `infer_loop_scaffold` deterministically extracts a draft from existing code or a journal;
5. `validate_loop` and `verify_loop` report v0.5 validity separately from installed execution
   readiness and the Not Codex policy.

These tools are read-only and non-destructive. Not Codex intentionally does not expose the official
MCP `run_loop` sharp edge: real runs use the typed integration RPC so project, provider, approvals,
timeout, threads, and journals remain explicit.

## Harness requirement

Every agent step executed inside Not Codex must declare the Not Codex harness:

```yaml
body:
  - id: review
    kind: agent
    harness: not-codex
    prompt: Review the current work and complete one safe, verifiable improvement.
```

Canonical v0.5 recipes and blueprints are returned unchanged. Some intentionally use `cli`,
`claude-code`, shell, or HTTP effects. Adapt those choices deliberately for the target environment;
Not Codex does not silently replace them. Its embedded executor rejects direct agent harnesses other
than `not-codex`, and disables direct shell and HTTP effects, so a spec cannot bypass provider
selection, approval policy, or durable thread history.

## Use it in Not Codex

Open **Settings → Integrations** to:

- open the current agent guide or compact `llms.txt` context;
- load any embedded verified recipe into the editor;
- edit or paste a LoopSpec and choose **Validate safely**;
- see the authoring and execution versions independently;
- distinguish v0.5 authoring validity from Not Codex execution readiness.

Validated, execution-ready loops can be started through the typed
`integrations.monkeyLoopy.run` RPC. A run requires a Not Codex project, provider/model selection,
approval-required runtime mode, and a bounded timeout. The result includes the Loopy run ID,
terminal state, ordinary Not Codex thread IDs, and journal location.

## Current boundary

Verification uses mocked effects and proves control-flow properties, not production API or model
quality. Inference is scaffolding, not proof that a draft faithfully represents the source. Not
Codex starts new bounded runs; interactive pause/resume, journal inspection RPCs, compilation, and
real shell/HTTP effects are not advertised until they can preserve the current safety and version
guarantees.
