# Monkey.D.Loopy

[Monkey.D.Loopy](https://github.com/MaTriXy/Monkey.D.Loopy) defines bounded, verifiable,
crash-resumable agent loops as YAML LoopSpecs. Not Codex embeds the compatible `@loopyc/core`,
`@loopyc/runtime`, and `@loopyc/verify` package set and supplies its own agent harness.

## What Not Codex supports

- parse, validate, verify, and score a LoopSpec;
- execute `agent` steps as ordinary Not Codex threads and turns;
- bounded iteration and termination rules enforced by the Loopy runtime;
- journals stored under the Not Codex server state directory, outside the project repository;
- a read-only `loopy_validate` MCP tool for checking specs without executing them.

The embedded package set is pinned to `0.1.0`. The source repository is newer, but npm currently does
not offer matching `0.5.0` releases for all three runtime packages. Not Codex deliberately uses one
compatible version across the set instead of mixing package protocols.

## Harness requirement

Every agent step must declare the Not Codex harness:

```yaml
body:
  - id: review
    kind: agent
    harness: not-codex
    prompt: Review the current work and complete one safe, verifiable improvement.
```

Specs naming `claude-code`, `codex`, or another direct CLI harness are rejected. Direct Loopy shell and
HTTP effects are also disabled by this integration. This prevents a LoopSpec from bypassing Not Codex's
provider selection, approval policy, and durable thread history.

## Validate a spec

Open **Settings → Integrations**, edit or paste a LoopSpec into the Monkey.D.Loopy card, and choose
**Validate safely**. Validation returns structural diagnostics, verifier output, and a score. It never
runs an agent.

Validated loops can be started through the typed `integrations.monkeyLoopy.run` RPC. A run requires a
Not Codex project, provider/model selection, approval-required runtime mode, and a bounded timeout. The
result includes the Loopy run ID, terminal state, ordinary Not Codex thread IDs, and journal location.

## Current boundary

Not Codex v1 starts new bounded runs. Interactive pause/resume and journal inspection RPCs are not yet
advertised. A breakpoint can leave the underlying Loopy run waiting, but callers should not depend on
resuming it through the Not Codex UI until that API is explicitly added.
