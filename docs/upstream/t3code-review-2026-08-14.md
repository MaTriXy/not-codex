# T3 Code upstream review — 2026-08-14

This review covers every upstream commit from `5a84614809b6e853b872f9e57ff4b97e9df5df02`
(exclusive) through `1a6599437b6ad77330923819613cc28be3b33945` (inclusive). The refreshed
ignored reference checkout and `docs/upstream/t3code-sync.json` are the source of truth.

All accepted changes are semantic ports. T3 branding, release identity, contributor trust
metadata, hosted-service assumptions, and artwork are not imported automatically.

## Outcome

- Reviewed: **53 commits**.
- Accepted for semantic port: **49 commits**.
- Already present: **1 commit**.
- Rejected as upstream-only identity or artwork: **3 commits**.
- Protected-path changes: **0**.
- The ledger `lastAudited` boundary advances to `1a6599437b6a` while `lastIntegrated` remains
  unchanged until the accepted stacks land.

## Pipeline

The implementation is split into independent stacks so low-risk work can merge while larger
product ports remain under review. Within each stack, every PR targets the preceding branch; after
a squash merge, the remaining branches are rebased and retargeted onto `main`.

1. **Audit/control plane** — this classification, the authoritative ledger, and merge order.
2. **Web stack**
   - interaction, layout, IME, draft, diff, Clerk, command-palette, and tooltip fixes;
   - appearance preservation, titlebar alignment, and desktop update presentation.
3. **Mobile stack**
   - Markdown, native composer, Android header, glass, and layout correctness;
   - OTA handoff/storage hardening and active-turn steering with outbox regressions;
   - nested task settings adapted to current Not Codex navigation and provider state.
4. **Connect stack**
   - CLI OAuth preservation and relay-aware source-control discovery;
   - account-environment deregistration and disabled-publishing Live Activity cleanup.
5. **Pull-request workspace stack**
   - contracts, authorization, provider, and server foundation;
   - all-environment listing, filters, checks, and smarter diff presentation;
   - update-branch, reactions, editing, and environment-scoped mutation errors.
6. **Preview/desktop stack**
   - browser-readiness port discovery;
   - resource-bounded Browser favicons and the improved right-panel launcher;
   - minimal Windows asar unpacking with provider external-package coverage.
7. **Cross-client settings** — configurable merge-driven auto-settle, preserving Not Codex
   snooze, pinning, explicit settled overrides, and inactivity semantics.

## Review boundaries

- The pull-request mutation layer must retain the existing Not Codex authorization boundary and
  must never silently turn read-only credentials into write credentials.
- Browser favicon capture and port readiness checks require resource, URL, cancellation, and
  process-lifecycle review before UI consumers land.
- Mobile native changes require `vp run lint:mobile` in addition to repository checks and focused
  TypeScript/native regression tests.
- Active-turn steering must preserve queued delivery, Automations, Loopy, retries, and persisted
  outbox behavior.
- Existing uncommitted theme/branding work in the primary worktree is not part of this pipeline.

## Exhaustive classification

| SHA          | Disposition     | Stack                 | Upstream subject                                         |
| ------------ | --------------- | --------------------- | -------------------------------------------------------- |
| `e1378a1f4d` | port            | mobile                | keep ordered lists inside user bubbles                   |
| `b54bfc9312` | port            | preview/desktop       | better right-panel empty state                           |
| `6fd088af9f` | port            | web                   | align mobile onboarding header                           |
| `849bac8946` | port            | Connect               | preserve CLI OAuth parameters through browser sign-in    |
| `e321667b10` | port            | web                   | prevent changed-files header overlap                     |
| `f131228a59` | port            | web                   | theme Clerk surfaces                                     |
| `b73232bdd3` | port            | web                   | reset sidebar width on double-click                      |
| `8601797233` | port            | web                   | align update-toast release-notes link                    |
| `770946d026` | port            | web                   | render tooltips above dropdowns                          |
| `8d24b5131f` | port            | pull requests         | open modified PR clicks in browser                       |
| `18918d1c4d` | port            | mobile                | fix command-popover glass rendering                      |
| `e3a9c2518d` | port            | mobile                | seed snoozed showcase threads                            |
| `9666b87516` | port            | web                   | preserve appearance mode when changing themes            |
| `d0b8d6306b` | port            | Connect               | deregister account environments from any client          |
| `b28f9bf0a1` | port            | pull requests         | expanded pull-request surfaces and mutations             |
| `2eb099fdc8` | port            | pull requests         | modified sidebar PR clicks open externally               |
| `ac1264e2ca` | port            | web                   | project favicon and workspace icons in command subtitles |
| `da6253b3dd` | port            | Connect               | source-control scan on relay environments                |
| `33f9705926` | port            | web                   | visible reset-zoom hover state                           |
| `1e59b4c400` | port            | web                   | retain typed prompt when a draft changes repository      |
| `6bc6cb6be4` | port            | web                   | keep diff file lists scrollable                          |
| `df19f6cfe3` | port            | web/server            | align Codex collaboration prompts                        |
| `5015d7cf9f` | port            | web                   | stabilize minimap as composer grows                      |
| `97db94c9bf` | port            | pull requests         | constrain pull-request panel to viewport                 |
| `9513e62e24` | reject          | upstream identity     | contributor-vouch metadata                               |
| `2ab188f1c0` | port            | pull requests         | ignore PR actions in latency tracker                     |
| `9e201941aa` | already-present | policy                | no rebase-before-PR requirement                          |
| `fd51561b4e` | port            | mobile                | extend blockquotes across wrapped lines                  |
| `83ad26c3a3` | port            | mobile                | prevent invalid HTML entities crashing Markdown          |
| `1b16ed663f` | port            | web                   | avoid Clerk close-button overlap                         |
| `2fab18e289` | port            | web                   | show unlocked aspect-ratio icon                          |
| `92d4a2e996` | port            | pull requests         | scope PR errors to their environment                     |
| `bad1143b02` | port            | mobile                | real Android settings cog                                |
| `23d45d914e` | reject          | upstream artwork      | restore T3 stage-art colors                              |
| `5ff3a03ada` | port            | web                   | align sidebar wordmark label                             |
| `96bfa67b3d` | port            | web                   | align snoozed-thread wake icon                           |
| `db1507e986` | port            | cross-client settings | allow disabling auto-settle on merge                     |
| `85389b9883` | port            | mobile                | nest task settings in bottom sheets                      |
| `5304f3e9d4` | reject          | upstream release      | T3 mobile version bump                                   |
| `59be6f7846` | port            | web                   | simplify desktop-managed server update copy              |
| `e15f655ba4` | port            | web                   | show background-policy tooltips sooner                   |
| `710fd0eeb3` | port            | preview/desktop       | Browser-panel favicons                                   |
| `9fd788b5a9` | port            | preview/desktop       | only show browser-ready local servers                    |
| `7e01d33f0e` | port            | preview/desktop       | avoid wholesale Windows asar node_modules unpacking      |
| `baaeda305c` | port            | Connect/mobile        | avoid stale Live Activities when publishing is disabled  |
| `8f9ab0845d` | port            | mobile                | space Git progress overlay below app bar                 |
| `4a2f8b04bb` | port            | web                   | preserve rename during IME composition                   |
| `6ae44b418a` | port            | mobile                | name shared iOS navigation-height fallback               |
| `b3b4b57794` | port            | mobile                | preserve keyboard suggestions while typing               |
| `21a3669cee` | port            | mobile                | prevent OTA update restart crashes                       |
| `038560e580` | port            | web                   | align titlebar control clusters                          |
| `184d8ef33b` | port            | mobile                | steer active turns by default                            |
| `1a6599437b` | port            | web                   | clarify desktop update status                            |

## Completion gates

Every implementation PR must pass focused tests for its changed behavior. Before merge, `vp check`
and `vp run typecheck` must pass. Native mobile PRs must also pass `vp run lint:mobile`.
