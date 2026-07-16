# Roadmap

Not Codex is an early public work in progress. The roadmap favors reliability and a coherent
provider-neutral product over a large feature count.

## Current foundation

- Provider-neutral threads across Codex, Claude Code, Cursor, and OpenCode adapters.
- Durable orchestration, reconnect recovery, approvals, structured input, terminals, and previews.
- Git branches, worktrees, checkpoints, diffs, review flows, and source-control publication.
- Desktop, web, and mobile clients with optional remote reachability through Not Codex Connect.
- Local-first Automations with schedules, leases, recovery, checks, bounded follow-up turns,
  notifications, and optional branch or pull-request outcomes.

## Near-term priorities

- Harden automation recovery with deterministic provider-adapter end-to-end fixtures.
- Expand mobile read/approve/cancel support for automation runs.
- Improve accessibility, keyboard navigation, and responsive density across primary workspaces.
- Make release, update, signing, and Connect setup reproducible for independent deployments.
- Continue reducing startup cost, memory use, and failure ambiguity under long-running sessions.

## Later exploration

- Additional provider adapters without leaking provider-native concepts into shared contracts.
- Richer automation check reports and reusable policy presets.
- Team-oriented coordination built on explicit encrypted or redacted Connect contracts.

Not planned: cloud-hosted agent execution, silent approval bypasses, automatic pull-request merging, or
a separate hidden conversation model for background work.

Open an issue before investing in a large roadmap item. See [CONTRIBUTING.md](./CONTRIBUTING.md).
