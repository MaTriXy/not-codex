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

Monkey D. Loopy executions and LoopAny deliveries share durable, environment-scoped run records.
Records retain bounded status, thread, journal, output-summary, and sanitized failure data across
client reconnects and server restarts. Completed records are retained for 90 days; credentials,
runtime environments, and full transcripts are never persisted in this history.

## Shared safety rules

- Not Codex remains the local execution authority.
- Agent calls use configured provider instances and ordinary thread records.
- Unattended approval or user-input requests fail closed.
- Integration tokens are stored in the server secret store and never returned through settings RPCs.
- External work directories must resolve inside explicitly allowed real paths.
- Integration failures are reported explicitly; they do not silently fall back to a provider CLI.

These are interoperability features. They do not imply sponsorship, endorsement, or affiliation with
the integrated projects or their maintainers.
