# T3 Code upstream review — 2026-08-25

## Audit boundary

- Upstream range: `f035a0f4cdf4abaa6704673af7b5a4a321149ba2..5d7665396083d285132d67038813862a93337ca5`
- Commits reviewed: 23
- Protected-path changes: 0
- Dispositions: 20 port, 1 already present, 1 replaced, 1 deferred, 0 rejected
- `lastAudited` advances to `5d7665396083d285132d67038813862a93337ca5`.
- `lastIntegrated` does not advance until the port candidates land; older deferred boundaries also remain intentionally unintegrated.

The audit's simulated conflict count is not a merge forecast. It compares a deliberately divergent,
renamed product tree and is useful only as a warning to review patches semantically. No upstream tree,
branding, release identity, or protected asset is merged wholesale.

## Decisions

### Port or adapt

The selected changes cover nightly version skew, terminal and Markdown file-link correctness, usage
ordering, thread lifecycle shortcuts, projection and ACP performance, macOS packaging and launch-agent
reliability, pull-request linking, HEIC attachments, Claude compaction, interrupted-query retries,
provider upgrade compatibility, macOS PR previews, and dictation-safe shortcut state.

### Already present

`2394998aa2e` only records deprecation metadata in `pnpm-lock.yaml`. Both records already exist in the
Not Codex lockfile and a frozen install leaves it unchanged.

### Replaced

`8287f2c3a771` adjusts an older T3 usage skeleton. Not Codex's redesigned usage page already has a
newer skeleton that mirrors its own headline, ranked-provider, chart, and metric-strip layout more
accurately, so importing the upstream geometry would regress layout stability.

### Deferred

`bce680926d38` adds mobile device model and major OS version to analytics connection events. This is
not required for compatibility or reliability and materially expands collected device metadata. It
stays deferred until there is an explicit privacy/product decision and corresponding public notice if
needed.

## Integration stack

1. Web correctness and navigation: skew, terminal/Markdown links, usage ordering, settle shortcut,
   hint timing, and dictation reset.
2. Server/runtime reliability: projection refresh filtering, bounded ACP output, macOS service PATH,
   connection-query retry, Cursor opt-in defaults, and used-provider restoration.
3. Desktop delivery: macOS signing-call reduction and branded PR preview workflow.
4. Pull-request linking: contracts, migrations, projections, shared client state, web, and mobile.
5. Composer media: bounded HEIC conversion and attachment behavior.
6. Claude compaction: shared policy, provider execution, settings, context-window UX, and docs.

Each stack layer must pass its focused tests, `vp check`, and `vp run typecheck`; mobile-touching layers
must also pass `vp run lint:mobile`.
