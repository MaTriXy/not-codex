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

Not Codex pins the complete published v0.5 toolchain:

- `@loopyc/core` 0.5.0 provides the canonical schema, guide, blueprints, verified recipe catalog,
  provenance, and authoring validation;
- `@loopyc/infer` 0.5.0 provides deterministic FactPack and draft-spec inference for shell,
  JavaScript, TypeScript, and `.loopy` journal content;
- `@loopyc/runtime` and `@loopyc/verify` 0.5.0 provide bounded execution, durable journals,
  dry-run verification, scoring, and replay checks.

A spec can still be **valid** without being **execution-ready**. Not Codex only marks it ready when it
also passes the v0.5 dry-run verifier and the Not Codex harness policy.

## Agent and MCP workflow

The Not Codex MCP toolkit mirrors the safe, non-executing part of the official v0.5 agent flow:

1. `get_loop_schema` returns the authoring guide, source URLs, blueprints, recipes, and installed
   version boundary;
2. `list_blueprints` and `list_recipes` expose structural starting points and verified outcomes;
3. `new_loop` instantiates exactly one recipe or blueprint without rewriting its provider or tools;
4. `infer_loop_scaffold` deterministically extracts a draft from existing code or a journal;
5. `validate_loop` and `verify_loop` report v0.5 validity separately from execution readiness under
   the Not Codex policy.

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
- confirm the pinned authoring and execution version;
- distinguish v0.5 validity from Not Codex execution readiness.

Validated, execution-ready loops can be started with **Run this LoopSpec**. A run requires a Not
Codex project, provider/model selection, permission mode, and a bounded timeout. Not Codex opens the
durable receipt immediately while execution continues in the background. Open **Runs** from the main
sidebar to find it later, inspect its stable lifecycle and verification summary, and follow ordinary
Not Codex thread links for the actual agent work.

## Current boundary

Verification uses mocked effects and proves control-flow properties, not production API or model
quality. Inference is scaffolding, not proof that a draft faithfully represents the source. Not
Codex starts and presents bounded runs. The server exposes authorized inspect and cancel RPCs:
inspection returns only bounded progress, caps, linked thread IDs, and product-authored diagnostics;
cancellation writes an auditable lifecycle outcome, requests a graceful runtime stop, and interrupts
the active Not Codex provider turn. The server also exposes authorized resume and retry RPCs. Resume
preserves the original run ID, journal, project, provider selection, permission mode, inputs, and
bounded timeout. Retry revalidates the original LoopSpec but creates a new run and journal with
explicit parent and attempt lineage. Recovery metadata is stored in the private server secret store;
clients choose a run ID, never a journal filesystem path, and receive bounded error codes for missing,
corrupt, foreign, terminal, or version-incompatible recovery state. Concurrent recovery for the same
source is rejected. The web run detail page inspects the authoritative runtime and durable record,
shows only server-authorized cancel/resume/retry controls, disables mutations while reconnecting or
refreshing stale state, and requires explicit consequence-aware confirmation. Successful retries
navigate to the new attempt while preserving a link to their source. Journal editing, compilation,
and real shell/HTTP effects remain out of scope.
