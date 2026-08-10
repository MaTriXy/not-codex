# T3 Code deferred-commit review — 2026-08-09

This review re-evaluates the **70 commits** marked `defer` in
`t3code-review-2026-08-08.md` after the Not Codex reliability work in PR #133,
the Sidebar v2 and modular-theme work in PR #137, and the Monkey D. Loopy 0.8
work in PR #138.

The review uses `docs/upstream/t3code-sync.json` as the authoritative ledger and
the refreshed ignored reference checkout at `.repos/t3code-upstream`. It is a
semantic-port plan, not permission to merge the upstream tree or import T3
branding, release identity, hosted configuration, or protected artwork.

## Completion update — 2026-08-10

The 70-commit queue is now resolved. PR #139 integrated the first 53 commits.
The final 17 were rechecked against the post-Sidebar-v2 tree with these results:

- **14 semantic ports completed**: usage (including the current web/mobile
  follow-ups), release isolation, dependency-cache warming, mobile grouping,
  reconnect stability, composer/layout fixes, terminal clear behavior, Connect
  device management, Clerk navigation, and the unified thread settings sheet.
- **2 commits superseded**: `70de6e1786` targeted the deleted remote mobile
  search module, and `e0c85a20ef` targeted the deleted v2-only row renderer.
  Their current replacements do not contain the affected failure modes.
- **1 commit rejected as non-applicable**: `a1762fdd74` documents upstream's
  `--share`/pair subsystem, which Not Codex does not ship. Adapting its commands
  would document a nonexistent product feature.

Seven follow-ups from the next upstream window were folded into these ports:
`70c423a5e4`, `886195ec1e`, `1a003e383a`, `bd18d8d6d`, `f993fa1c5f`,
`0d38866dcf`, and `9a1472d955`.

## Revised outcome (historical implementation plan)

- Reviewed again: **70 deferred commits**.
- Accepted for a Not Codex semantic port: **65 commits**.
- Accepted as behavior-equivalent adaptations: **5 terminal commits** whose
  upstream implementation targets Ghostty while Not Codex uses xterm.js.
- Rejected after re-review: **0 commits**.
- Already fully present on current `main`: **0 commits**.
- New upstream commits after the reviewed range: **19**, tracked separately
  below so they do not change the 70-commit result.

The original review treated all 70 as product candidates. The implementation
pass later proved that two behaviors were already superseded and one depended
on an absent subsystem. “Accepted” did not mean cherry-pick:
Not Codex has additional providers, Automations, Loopy and LoopAny receipts,
Open Kritt, different persistence migrations, independent Connect and release
infrastructure, and an xterm.js web terminal. Each batch must preserve those
differences and carry focused regression coverage.

## Required implementation order

### 1. Native subagent and workflow observability

Port `a2ca89aa10` and `cf5c9948c8` first. This establishes the durable
background-liveness signal used by the provider-session reaper fix and gives
Codex and Claude subagents a shared client model. The adaptation must also cover
OpenCode, Grok, Cursor/ACP where supported, Automations, and Loopy activities.

### 2. Runtime and transport reliability

Split the 14 reliability commits into reviewable chains:

1. Reconnect and transfer isolation: `990bb0b689`, `ae7b27de82`,
   `9547cf2463`, `ddfe45c66e`.
2. Stop and settle correctness: `0ec4fbc4a3`, `c471145e96`, `7aad7911f6`,
   `6fa4576078`, `2c7267ad43`.
3. Snapshot and Git load control: `3da315e7b5`, `b7d1981b57`, `e4abc31f1e`,
   `331c6dce7f`, `4eaf5ef8bb`.

The snapshot chain must retain enough structured output for Not Codex
integration receipts and Loopy run rendering. The reaper change must land after
background liveness exists. The transfer-budget workflow should use Not Codex
CI names and thresholds.

### 3. Sidebar lifecycle and persistent pin ordering

Port `4f5834ba72`, `23f0a1ae38`, `61b51ae0e3`, and `5661c6116c` together.
Done/Woke acknowledgement must share one helper across reading, sending,
settling, archiving, and explicit dismissal. Pin ordering must remain durable
across environments and work on mobile as well as web.

Upstream calls the pin-order migration `038`, but Not Codex already owns
migrations 038–040. The adapted migration must use the next available Not Codex
identifier. The newer upstream stabilization `5208bdeb0d` must be included in
the implementation so optimistic writes do not reshuffle rows while settling.

### 4. Web connection reliability and timeline behavior

Port `2288d416aa`, `ed886fe181`, and `1c7d059f55`. Long-running update RPCs
should not trigger ordinary slow-request warnings, brief reconnects should not
flash warning banners, and reading history during a live turn must disable
automatic end-follow until the user returns to the live edge.

### 5. Web shell and update polish

Port `9235c83eb7`, `37d3667de4`, `80720ad592`, `48e2c27f2f`, `ea50b695a7`,
and `2e66b1fdfc`. These are now unblocked by the glass shell from PR #137. The
update surfaces must use Not Codex release terminology and preserve simultaneous
Automation, Loopy, background-agent, and environment banners.

### 6. Terminal behavior and appearance — xterm.js adaptation

Implement the behaviors from `9d9a872bcc`, `7251f1a1f1`, `2a04db134c`,
`de592a00e8`, and `30e471530b` against `ThreadTerminalDrawer.tsx` and xterm.js,
not the upstream Ghostty renderer. Required outcomes are reliable hover feedback
for wrapped links, no loading flash, persisted terminal font selection, richer
font previews, and stable font size when terminal panes split.

The current Not Codex terminal still hardcodes a 12px font and a fixed font
stack, so the modular appearance settings are not yet wired through to the
terminal. This is a real missing product behavior rather than an upstream
implementation we can copy directly.

### 7. Not Codex Connect update lifecycle

Port the complete chain `808d685355`, `8f341f20c9`, `f9e8236899`,
`df2f1273e9`, `8b2ea5721a`, and `64a3cd6d7d`. The tunnel must survive managed
update handoffs, but explicit stops and failed/interrupted trials must release
resources deterministically. Adapt the upstream service-launcher split to the
current Not Codex boot and managed-endpoint runtime instead of recreating T3
hosted configuration.

### 8. Provider correctness

Port `99d91ddaa4` and `7963cc70f3`. Unknown ACP approvals must stay actionable,
and runtime-mode changes must be recorded per turn. Tests must cover all Not
Codex provider adapters that can emit approvals or mode changes, not just the
providers present in upstream.

### 9. Thread-detail pagination

Port `6b73b3defe` as a dedicated contracts, persistence, server, client-runtime,
web, and mobile migration. Preserve a user-anchored turn window while loading
older history. Its upstream migration number is already occupied in Not Codex,
so it must receive a new migration ID and coexist with settled, snoozed,
Automation, and integration activity projections.

### 10. Plan and composer product behavior

Port `a8cd2ad2eb`, `48aa875c0e`, `31891a1a0c`, `1ffba7093a`, `ab3b55e29a`,
`64a991ad45`, and `45d9aa90ba` as one product decision. Plans should appear in
the conversation instead of hijacking the right panel, the legacy Plan/token
streaming controls should be explicit, pending input should retain a Stop
action, automatic-permission fallback copy should be precise, and non-Git
remote environments should remain visible.

The adaptation must not collapse Not Codex Automation plans, Loopy execution
plans, Open Kritt findings, or provider-native plan events into an ambiguous
single state.

### 11. Provider settings, browser history, and desktop focus

Port `95305c36fa`, `72d673a855`, and `0640410726` as separate focused PRs.
Provider settings need per-device persistence and version-skew handling;
recent Browser targets must remain local and environment-scoped; desktop zoom
shortcuts must cross the preview-browser focus boundary through the existing
Not Codex IPC design.

### 12. Usage product

Port `8101cd0449` and `a20923ce46` together. The page should aggregate local
provider transcripts across authorized environments, normalize provider costs
before chart comparison, bound scan/cache work, and disclose exactly which
local files are read. It must not introduce telemetry or upload transcript
contents.

The newer upstream usage commits `70c423a5e4` and `886195ec1e` should be folded
into the first Not Codex implementation so the initial page ships with stable
cross-device totals and the current simplified presentation.

### 13. Tooling and CI

Port `9697b765e5` and `388b43a27c` by behavior. Release jobs avoid shared
unauthenticated API limits and cold development startup warms the correct Vite+
dependency cache. `a1762fdd74` is rejected because its `--share` instructions
depend on an upstream pair subsystem absent from Not Codex.

### 14. Native mobile completion

Resolve all 12 mobile commits after the shared contracts and lifecycle work
they consume:

- Workspace and list stability: `47dfc65265`, `70de6e1786`, `e0c85a20ef`,
  `6d70e6d778`.
- Composer and layout correctness: `470d4eb993`, `8100062a78`, `33a03c8a7b`,
  `bd422fd8d1`.
- Native terminal and authentication: `a17459e8a9`, `af281c9fc4`.
- Connect device management and settings UX: `b98a0f0d22`, `30164cb1ba`.

Ten are semantic ports; `70de6e1786` and `e0c85a20ef` are superseded by the
current local search and unified row renderer. Native module paths retain the `notcodex-` prefix. The grouped-workspace
and pin-order behavior must match the web implementation, and mobile lint is a
required completion gate.

## Exhaustive 70-commit decision ledger

| SHA          | Previous queue              | Revised decision                        | Implementation batch                       |
| ------------ | --------------------------- | --------------------------------------- | ------------------------------------------ |
| `47dfc65265` | mobile                      | Port                                    | Native mobile completion                   |
| `70de6e1786` | mobile                      | Port                                    | Native mobile completion                   |
| `e0c85a20ef` | mobile                      | Port                                    | Native mobile completion                   |
| `9235c83eb7` | web-polish                  | Port                                    | Web shell and update polish                |
| `9d9a872bcc` | web-polish                  | Adapt to xterm.js                       | Terminal behavior and appearance           |
| `9697b765e5` | tooling-and-ci              | Adapt                                   | Tooling and CI                             |
| `37d3667de4` | web-polish                  | Port                                    | Web shell and update polish                |
| `2a04db134c` | appearance-follow-up        | Adapt to xterm.js                       | Terminal behavior and appearance           |
| `de592a00e8` | appearance-follow-up        | Adapt to Not Codex previews             | Terminal behavior and appearance           |
| `30e471530b` | appearance-follow-up        | Adapt to xterm.js                       | Terminal behavior and appearance           |
| `7251f1a1f1` | web-polish                  | Adapt to xterm.js                       | Terminal behavior and appearance           |
| `990bb0b689` | reliability-next            | Port                                    | Runtime and transport reliability          |
| `a2ca89aa10` | product-observability       | Adapt across providers                  | Native subagent and workflow observability |
| `3da315e7b5` | reliability-next            | Adapt with integration receipts         | Runtime and transport reliability          |
| `1ffba7093a` | web-product                 | Port with plan batch                    | Plan and composer product behavior         |
| `80720ad592` | web-polish                  | Adapt to Not Codex updates              | Web shell and update polish                |
| `808d685355` | connect-and-updates         | Adapt to Not Codex Connect              | Connect update lifecycle                   |
| `8f341f20c9` | connect-and-updates         | Adapt to Not Codex tests                | Connect update lifecycle                   |
| `f9e8236899` | connect-and-updates         | Adapt to Not Codex Connect              | Connect update lifecycle                   |
| `df2f1273e9` | connect-and-updates         | Adapt to Not Codex Connect              | Connect update lifecycle                   |
| `8b2ea5721a` | connect-and-updates         | Adapt to Not Codex launcher             | Connect update lifecycle                   |
| `48e2c27f2f` | web-polish                  | Adapt to Not Codex updates              | Web shell and update polish                |
| `64a3cd6d7d` | connect-and-updates         | Adapt to Not Codex Connect              | Connect update lifecycle                   |
| `b7d1981b57` | reliability-next            | Port                                    | Runtime and transport reliability          |
| `e4abc31f1e` | reliability-next            | Port                                    | Runtime and transport reliability          |
| `ab3b55e29a` | web-product                 | Adapt across providers                  | Plan and composer product behavior         |
| `99d91ddaa4` | server-and-provider         | Adapt across ACP providers              | Provider correctness                       |
| `470d4eb993` | mobile                      | Port                                    | Native mobile completion                   |
| `4f5834ba72` | sidebar-lifecycle-follow-up | Port                                    | Sidebar lifecycle and pin ordering         |
| `331c6dce7f` | reliability-next            | Port                                    | Runtime and transport reliability          |
| `ea50b695a7` | web-polish                  | Port                                    | Web shell and update polish                |
| `0ec4fbc4a3` | reliability-next            | Adapt to Not Codex work log             | Runtime and transport reliability          |
| `64a991ad45` | web-product                 | Port                                    | Plan and composer product behavior         |
| `c471145e96` | reliability-next            | Port                                    | Runtime and transport reliability          |
| `7aad7911f6` | reliability-next            | Port                                    | Runtime and transport reliability          |
| `6b73b3defe` | thread-pagination           | Adapt with new migration ID             | Thread-detail pagination                   |
| `ae7b27de82` | reliability-next            | Adapt to current Effect/runtime         | Runtime and transport reliability          |
| `6fa4576078` | reliability-next            | Port                                    | Runtime and transport reliability          |
| `1c7d059f55` | timeline-follow-up          | Port on PR #137 timeline base           | Web connection and timeline reliability    |
| `9547cf2463` | reliability-next            | Port                                    | Runtime and transport reliability          |
| `ddfe45c66e` | reliability-next            | Adapt to Not Codex CI                   | Runtime and transport reliability          |
| `2288d416aa` | web-reliability             | Port                                    | Web connection and timeline reliability    |
| `cf5c9948c8` | product-observability       | Port with observability foundation      | Native subagent and workflow observability |
| `a8cd2ad2eb` | plan-product                | Adapt to Not Codex plans                | Plan and composer product behavior         |
| `48aa875c0e` | plan-product                | Port with plan batch                    | Plan and composer product behavior         |
| `95305c36fa` | provider-settings           | Adapt to environment-scoped providers   | Provider settings                          |
| `b98a0f0d22` | mobile                      | Adapt to Not Codex Connect              | Native mobile completion                   |
| `23f0a1ae38` | sidebar-lifecycle-follow-up | Port                                    | Sidebar lifecycle and pin ordering         |
| `388b43a27c` | tooling-and-ci              | Adapt to current Vite+ setup            | Tooling and CI                             |
| `a1762fdd74` | tooling-and-ci              | Adapt to Not Codex commands             | Tooling and CI                             |
| `8100062a78` | mobile                      | Port                                    | Native mobile completion                   |
| `2e66b1fdfc` | web-polish                  | Adapt to all Not Codex banners          | Web shell and update polish                |
| `7963cc70f3` | server-and-provider         | Adapt across providers                  | Provider correctness                       |
| `a17459e8a9` | mobile                      | Adapt to `notcodex-terminal`            | Native mobile completion                   |
| `33a03c8a7b` | mobile                      | Port                                    | Native mobile completion                   |
| `bd422fd8d1` | mobile                      | Adapt to current React Native patch set | Native mobile completion                   |
| `af281c9fc4` | mobile                      | Port                                    | Native mobile completion                   |
| `61b51ae0e3` | sidebar-lifecycle-follow-up | Port                                    | Sidebar lifecycle and pin ordering         |
| `6d70e6d778` | mobile                      | Port                                    | Native mobile completion                   |
| `5661c6116c` | sidebar-lifecycle-follow-up | Adapt with new migration ID             | Sidebar lifecycle and pin ordering         |
| `72d673a855` | browser-product             | Port with local scoped storage          | Browser history                            |
| `45d9aa90ba` | web-product                 | Port                                    | Plan and composer product behavior         |
| `31891a1a0c` | plan-product                | Adapt to Not Codex legacy settings      | Plan and composer product behavior         |
| `4eaf5ef8bb` | reliability-next            | Port                                    | Runtime and transport reliability          |
| `ed886fe181` | web-reliability             | Port                                    | Web connection and timeline reliability    |
| `2c7267ad43` | reliability-next            | Port after background liveness          | Runtime and transport reliability          |
| `0640410726` | desktop                     | Adapt to Not Codex desktop IPC          | Desktop focus reliability                  |
| `30164cb1ba` | mobile                      | Adapt to Not Codex provider options     | Native mobile completion                   |
| `8101cd0449` | usage-product               | Adapt with privacy and bounded scans    | Usage product                              |
| `a20923ce46` | usage-product               | Port with usage page                    | Usage product                              |

## New upstream window after the 70 commits

The refreshed audit now covers
`a20923ce463335e89e92f5983d98a180536e8e7d..9821bca1ceb97f137a9d93f1080fe1954b6641d3`
and originally classified **44** commits. This audit extends that window
through `0a7c662d39329eeb3cffe00d66a31f1a8241b3d7`, for **53** classified commits:

- **42 ported across the final, reliability/security, UI-polish, project-product, and low-risk follow-up batches**: the usage
  presentation/stability chain, mobile usage, forked-session deduplication,
  mobile long-press behavior, provider lifecycle guards, settle cleanup,
  systemd OOM isolation, bounded favicon/file-link scanning, SVG sandboxing,
  themed confirmations, theme controls, update contrast, interaction cursors,
  trait dismissal, desktop title dragging, Sidebar v2 metadata and pin-order
  polish, persisted diff layout, running-agent badges, Connect auth routing,
  Windows native-provider discovery, PowerShell failures, and Android wide
  Markdown bubbles.
- **4 rejected**: two upstream contributor-vouch governance commits, a
  settings-search shortcut style whose target was removed by the contextual
  Not Codex settings navigation, and the upstream T3 Code v0.0.33 identity bump.
- **6 remain deferred with explicit notes** in `t3code-sync.json`; none is silently
  dropped. The multi-provider pull-request/review product is now accepted as a
  four-PR semantic port after the dedicated audit in
  `t3code-multi-provider-pr-review-audit-2026-08-10.md`. The newly audited EAS fingerprint parser stays with the larger
  automated production-release decision because the current Not Codex workflow
  does not invoke it.

The first reliability/security, low-risk UI-polish, project-product, and
approved low-risk follow-up sets are complete. The six remaining deferred
candidates retain explicit review boundaries for pasted-image provider access,
checkout selection, development database seeding, hosted preview CI, and the
paired EAS production-release/fingerprint-parser workflow. The pull-request
product has moved from review to the accepted staged-port plan above.

## Completion gates

Every implementation PR must run focused tests for its changed behavior. Before
a batch is considered complete, repository-wide `vp check` and
`vp run typecheck` must pass. Any batch changing native mobile code must also
pass `vp run lint:mobile`.
