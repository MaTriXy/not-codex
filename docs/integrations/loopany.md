# LoopAny

The supported control plane is MaTriXy's
[LoopAny platform fork](https://github.com/MaTriXy/loopany-platform), based on Superdesign's MIT-licensed
LoopAny platform. It schedules and delivers work while execution remains on the user's machine. Not
Codex implements its machine polling and reporting protocol directly; no LoopAny server or daemon
package is bundled.

## Configure

Open **Settings → Integrations → LoopAny** and provide:

1. the LoopAny server base URL;
2. a device token issued by that server;
3. one or more absolute allowed project roots;
4. an optional long-poll wait between 5 and 60 seconds.

Save, test the connection, then enable the connector. The token is write-only and is stored separately
from `settings.json`. Leaving the token field blank keeps the existing secret.

## Health and delivery history

**Settings → Integrations → LoopAny** reports one of these server-authoritative states:

- `disabled` or `misconfigured` when the connector cannot poll;
- `connecting` while a poll is being established;
- `healthy` after a successful poll;
- `backing-off` when a transient poll failed and a retry is scheduled;
- `unauthorized` when the saved device token was rejected;
- `protocol-error` when the server response is oversized, malformed, or unsupported.

The panel shows the last poll and success, next retry, consecutive failures, in-flight count,
protocol/server version when available, and bounded recent events. Accepted deliveries, duplicates,
workflow fallback, root-policy rejection, execution failure, report failure, and success have distinct
diagnostic codes. Copyable identifiers are internal SHA-256-derived run IDs; external delivery IDs,
tokens, unrestricted paths, raw external state, and transcripts do not cross the client contract.

Use **Runs** for the complete retained delivery lifecycle. It is keyset-paginated and completed runs
are pruned after 90 days. Recent connector events are limited to 50 and survive reconnects and server
restarts; live in-flight counts reset while the restarted connector establishes its next poll.

## Delivery flow

```text
LoopAny server
  → authenticated machine poll
  → strict delivery decoding and size limits
  → local + delivery root realpath checks
  → untrusted workflow-source security gate
  → ordinary Not Codex project/thread/turn
  → terminal report using the run-scoped token
```

Long agent turns run in bounded background slots, so the connector continues sending progress
heartbeats and polling for work. Duplicate in-flight run IDs are ignored. LoopAny's atomic delivery
claim and run-scoped report token remain the durable server-side lease boundary.

## Workflow security gate

Delivered JavaScript is untrusted and is **not evaluated by Not Codex**. Node's permission model does
not provide a network permission gate, so a subprocess could otherwise reach localhost services or
send inherited secrets over the network. An empty environment alone would not make that execution
safe.

For an `exec` delivery containing workflow source, Not Codex preserves the original task and routes it
through the ordinary approval-governed agent harness. The prompt includes bounded workflow source and
the security diagnosis as inert text so the tick can still produce useful work. No workflow state is
evaluated or returned, and the workflow cursor is not advanced. Other delivery roles continue through
their normal harness path.

Local workflow evaluation can be restored only after a reviewed, cross-platform runtime provides real
network isolation in addition to filesystem, process, environment, time, memory, and output limits.

## Failure behavior

- Missing URL, token, allowed roots, project ownership, or model configuration fails explicitly.
- Symlink and sibling-prefix root escapes are rejected after `realPath` resolution.
- Provider approval or user-input requests fail the unattended delivery instead of auto-approving.
- Delivered workflow JavaScript is never executed by the connector.
- Invalid server payloads and oversized deliveries fail closed before execution.
- Terminal reports retry once after transient network/server failures; a final report failure is logged
  without exposing the device or run token.

LoopAny is disabled by default and remains optional. Not Codex is not affiliated with or endorsed by
LoopAny or Superdesign.

## Compatibility fixtures and upgrades

Not Codex currently tests only the public machine protocol identified as `2026-07`, against the
LoopAny platform revision `8c0abd2f8d254add2d6e2b6a15084ab317552285`. The bounded, synthetic
fixtures live at `apps/server/src/integrations/fixtures/loopany-machine-2026-07.json`; they cover
status, poll, progress, terminal reporting, each supported delivery role, secure workflow fallback,
duplicate ids, authorization, and local limits. Delivered workflow source remains inert context for
the agent harness: Not Codex neither evaluates it nor advances a workflow cursor. The fixtures are
not a compatibility claim for any other LoopAny version or deployment.

When LoopAny's public machine protocol changes, a maintainer must review the change, update the
protocol version and source revision together, revise the corresponding fixtures and assertions,
and run the focused compatibility suite. The change is incomplete until [live acceptance issue
#14](https://github.com/MaTriXy/not-codex/issues/14) is rerun against the reviewed server revision
with redacted evidence. Fixture pin failures deliberately name this procedure so an incompatible
wire change cannot be accepted silently.
