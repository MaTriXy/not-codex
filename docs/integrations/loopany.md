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
