# T3 Code upstream sync

Not Codex is a derivative of T3 Code, but its Git history starts with an independent import commit.
Upstream changes are therefore reviewed and ported semantically instead of being merged wholesale.

The machine-readable sync state is stored in [`t3code-sync.json`](./t3code-sync.json). Its
`lastAudited` commit advances only after every commit in an upstream window has a recorded
disposition: ported, already present, replaced, deferred, or rejected. `lastIntegrated` advances
only after all accepted ports for that window are merged.

## Local audit

Sync the ignored full-history reference clone and generate a report:

```bash
vp run upstream:t3:sync
vp run upstream:t3:audit
```

Use `vp run upstream:t3:audit -- --json` for machine-readable output. The audit is read-only: it
does not modify the state file, create commits, or update Git remotes. It audits the configured
`source.branch` remote-tracking ref directly, independent of the reference clone's checked-out
branch or detached `HEAD`.

## Porting rules

1. Classify every upstream commit before advancing `lastAudited`.
2. Port contracts and shared runtime changes before their server and client consumers.
3. Bring over or adapt upstream tests before porting implementation behavior.
4. Use isolated worktree branches and include the upstream commit SHA in each pull request.
5. Never automatically import T3 branding, marketing copy, hosted-service configuration, release
   identity, or legal text.
6. Preserve Not Codex Automations, Loopy and LoopAny integrations, multi-provider behavior, and
   Not Codex package/native-module names.
7. Run targeted tests, `vp check`, and `vp run typecheck` for every port. Native mobile ports also
   require `vp run lint:mobile`.

The audit report highlights path overlap after translating configured upstream-to-local renames,
alongside the raw Git merge simulation and changes under protected paths. Detected Git renames and
copies contribute both their source and destination paths. The audit also rejects an advanced
`lastAudited` boundary when any earlier upstream commit lacks a disposition. These signals identify
review risk; they do not make automatic disposition decisions.
