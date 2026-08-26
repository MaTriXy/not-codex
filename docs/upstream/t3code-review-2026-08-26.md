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

## Follow-up audit

- Upstream range: `082e6ea521861fff37b90fcd789b5eaa5ef5d6a6..b0a0281269156295e2202d31198829bd3b500bdf`
- Commits reviewed: 5
- Protected-path changes: 0
- Dispositions: 3 port, 1 reject, 1 already present
- `lastAudited` advances to `b0a0281269156295e2202d31198829bd3b500bdf`.
- `lastIntegrated` remains unchanged because the earlier device-analytics candidate is still deferred.

### Decisions

1. Port `994372ba43810e64027c537231da200988faa7ca`: a tracked feature branch must publish under its own
   resolved name rather than push commits onto its base branch. Preserve an existing
   `branch.<name>.gh-merge-base` value and retain Git-mangled tracking aliases.
2. Port `504177797676048bf70f64ce56c21949d0b8a018`: move the shared Clerk dependency family to the
   stable Electron 0.0.37-compatible versions. This also corrects the earlier `7441b369` and
   `9027d626` ledger entries, whose intended package updates had not actually landed locally.
3. Adapt `badae6a5cc8325dcd5a145bea6f7b8ac692818a1`: host the model manifest in the public
   `MaTriXy/not-codex` repository, use a Not Codex Effect service identity, and preserve remote,
   disk-cache, and bundled fallback behavior without delaying provider probes.
4. Reject `860caaa6023a3aaf616a5899816c74c195ca8de2`: the release preparation changes T3 Code versions and
   release identity rather than supplying a product-independent fix.
5. Mark `b0a0281269156295e2202d31198829bd3b500bdf` already present: Not Codex does not set Clerk's
   internal UI version override, so Clerk already receives stable authentication UI fixes.
