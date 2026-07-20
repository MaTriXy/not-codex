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
Run IDs are copyable for support without exposing inputs or credentials. The run detail page inspects
bounded live progress and declared caps, then shows only controls authorized by durable run state and
the connection's orchestration scope. Controls stay disabled while reconnecting, refreshing stale
state, or submitting another operation. Cancel requests a graceful Loopy stop and interrupts the
active provider turn. Resume continues a recoverable run from its verified journal; retry creates a
new durable attempt, navigates to its detail page, and links back to the failed or cancelled source.

Mobile exposes the same environment-scoped records under **Settings → Integrations** and can navigate
to linked Not Codex threads in the selected environment. It can also validate and launch a pasted or
recipe-backed LoopSpec through the paired server, with explicit project, model, permission mode,
inputs, and timeout. It never executes the integration runtime on the phone.
Mobile run detail uses the same server-authorized inspect/cancel/resume/retry policy as web and keeps
all mutations disabled until the selected environment is connected with a fresh inspection.
Mobile LoopAny settings edit only the paired server's non-secret configuration. Device tokens are
write-only, replaceable, and explicitly removable; cached mobile settings never contain a token.
Mobile mutations fail closed while state is stale, reconnecting, unauthorized, or pending. Remote
failure strings are classified into safe user guidance instead of being rendered verbatim; interrupted
commands ask the user to refresh authoritative server state before retrying. Integration actions use
screen-reader labels and state, 48-point minimum targets, semantic headings, and wrapping layouts for
compact screens. See the [mobile verification matrix](./mobile-verification.md) for acceptance evidence.

Monkey D. Loopy executions and LoopAny deliveries share durable, environment-scoped run records.
Records retain bounded status, verification counts, lifecycle events, thread and journal references,
output summaries, and sanitized failure data across client reconnects and server restarts. Completed
records are retained for 90 days; credentials, raw diagnostics, runtime environments, inputs, and full
transcripts are never persisted in this history.

LoopAny additionally persists one bounded connector-health snapshot across server restarts. Settings
shows its sanitized health, last poll and success, retry timing, in-flight count, protocol/server
version when available, and up to 50 recent connector events. Recent events use internal hashed run
IDs that link to the same paginated 90-day run history; they never contain external delivery IDs,
device or run tokens, unrestricted paths, raw external state, or transcripts.

After a server restart, queued or running Monkey.D.Loopy records cannot still have a live in-memory
runtime. Startup reconciliation marks those records cancelled with an explicit interrupted-run
failure and restart-orphan event. Durably waiting and restart-interrupted runs can be resumed after
their private recovery metadata, runtime version, journal checksum chain, and LoopSpec identity pass
verification.

## Shared safety rules

- Not Codex remains the local execution authority.
- Agent calls use configured provider instances and ordinary thread records.
- Unattended approval or user-input requests fail closed.
- Integration tokens are stored in the server secret store and never returned through settings RPCs.
- External work directories must resolve inside explicitly allowed real paths.
- Integration failures are reported explicitly; they do not silently fall back to a provider CLI.

These are interoperability features. They do not imply sponsorship, endorsement, or affiliation with
the integrated projects or their maintainers.
