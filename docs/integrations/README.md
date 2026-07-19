# Integrations

Not Codex keeps agent execution inside its provider-neutral harness. Integrations may validate,
schedule, or deliver work, but they do not receive a second path around Not Codex approvals,
projects, provider instances, or thread history.

| Integration                            | Role                                                         | Execution boundary                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| [Monkey D. Loopy](./monkey-d-loopy.md) | Use v0.5 agent context, recipes, inference, and bounded runs | Every executable agent step becomes an ordinary Not Codex thread and turn                                               |
| [LoopAny](./loopany.md)                | Optional external scheduling and delivery control plane      | Accepted deliveries are root-jailed and routed through the governed harness; workflow source is never evaluated locally |

Configure and inspect integrations in **Settings → Integrations**. Both integrations are optional;
LoopAny is disabled by default.

Open **Runs** from the main sidebar to browse the selected environment's durable history. The web
experience supports bounded integration, state, project, and time filters; keyset pagination; live
refresh; lifecycle timelines; verification summaries; and links back to ordinary Not Codex threads.
Run IDs are copyable for support without exposing inputs or credentials. Recovery controls are not
part of this read-only history surface yet. Authorized clients can already use the typed inspect and
cancel operations: inspect returns bounded live progress and declared caps, while cancel requests a
graceful Loopy stop and interrupts the active Not Codex provider turn.

Monkey D. Loopy executions and LoopAny deliveries share durable, environment-scoped run records.
Records retain bounded status, verification counts, lifecycle events, thread and journal references,
output summaries, and sanitized failure data across client reconnects and server restarts. Completed
records are retained for 90 days; credentials, raw diagnostics, runtime environments, inputs, and full
transcripts are never persisted in this history.

After a server restart, queued or running Monkey.D.Loopy records cannot still have a live in-memory
runtime. Startup reconciliation marks those records cancelled with an explicit interrupted-run
failure and restart-orphan event; durably waiting runs remain waiting for the separate resume
workflow.

## Shared safety rules

- Not Codex remains the local execution authority.
- Agent calls use configured provider instances and ordinary thread records.
- Unattended approval or user-input requests fail closed.
- Integration tokens are stored in the server secret store and never returned through settings RPCs.
- External work directories must resolve inside explicitly allowed real paths.
- Integration failures are reported explicitly; they do not silently fall back to a provider CLI.

These are interoperability features. They do not imply sponsorship, endorsement, or affiliation with
the integrated projects or their maintainers.
