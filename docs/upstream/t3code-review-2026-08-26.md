# T3 Code upstream review — 2026-08-26

## Audit boundary

- Upstream range: `e67074f80933a27bd3cdc4e24f486358407690fb..082e6ea521861fff37b90fcd789b5eaa5ef5d6a6`
- Commits reviewed: 1
- Protected-path changes: 0
- Disposition: 1 port
- `lastAudited` advances to `082e6ea521861fff37b90fcd789b5eaa5ef5d6a6`.
- `lastIntegrated` remains unchanged because the earlier device-analytics candidate is still deferred.

## Decision

The adapted port reveals Markdown file chips in the owning environment's system file manager and
uses the environment's reported platform for Finder, File Explorer, or Files wording. It does not
fall back to whichever environment is active: shell actions remain hidden until ownership and local
execution are resolved, while thread file previews keep their existing Not Codex behavior.

Review exposed two older prerequisite dispositions whose code had not actually landed. This stack
therefore also integrates the forward-compatible array schema and remote SSH editor-link pipeline.
The desktop accepts only web URLs and editor deep links targeting the `vscode-remote/ssh-remote+`
authority, rejects userinfo and arbitrary editor commands, and probes remote-capable editors on the
viewing machine instead of the environment host.
