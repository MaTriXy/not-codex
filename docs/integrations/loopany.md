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
  → optional isolated workflow gate
  → ordinary Not Codex project/thread/turn
  → terminal report using the run-scoped token
```

Long agent turns run in bounded background slots, so the connector continues sending progress
heartbeats and polling for work. Duplicate in-flight run IDs are ignored. LoopAny's atomic delivery
claim and run-scoped report token remain the durable server-side lease boundary.

## Workflow gate

An optional delivered JavaScript workflow runs in a short-lived Node process with an empty environment,
a 15-second timeout, bounded output, and Node permissions that deny filesystem, network, and child
process access. It can:

- return a direct message and state cursor without invoking an agent; or
- call `agent(message, data)` to escalate work into the Not Codex harness.

`tools.call` is intentionally unavailable in this first connector version. Workflow object data is
serialized as JSON before it is added to an agent prompt.

## Failure behavior

- Missing URL, token, allowed roots, project ownership, or model configuration fails explicitly.
- Symlink and sibling-prefix root escapes are rejected after `realPath` resolution.
- Provider approval or user-input requests fail the unattended delivery instead of auto-approving.
- Invalid server payloads, oversized deliveries, workflow failures, and report errors are bounded and
  logged without exposing the device or run token.

LoopAny is disabled by default and remains optional. Not Codex is not affiliated with or endorsed by
LoopAny or Superdesign.
