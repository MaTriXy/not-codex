# Loop integrations roadmap delivery ledger

Last reconciled: 2026-07-21

This ledger is the review and merge map for the Not Codex integration roadmap. For landed work, the
commit column records the reachable squash-merge commit on `main`; source branch commit IDs are not used.

## TL;DR

- The integration foundation is already on `main` through PR
  [#6](https://github.com/MaTriXy/not-codex/pull/6).
- Issues #7–#13 and #15–#22 are implemented, validated, and landed on `main` through PRs #24–#38,
  with replacement PR #40 superseding the auto-closed PR #28.
- Issue #14 remains intentionally open because it requires a real, safe LoopAny server, token, and
  disposable allowed root. Unit fixtures cannot substitute for that live interoperability evidence.
- Issue #23 is the final epic reconciliation. Its implementation merge can complete independently, but
  the issue closes only after the issue #14 evidence is attached.

## Delivery inventory

| Order | Issue                                                 | What users gain                                                                      | Dependency                        | Branch                                                      | Commit                               | Pull request / state                                                            |
| ----: | ----------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------- | ----------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
|     1 | [#7](https://github.com/MaTriXy/not-codex/issues/7)   | Reliable CI selection and deterministic provider reprobes                            | `main`                            | `codex/issue-7-ci-reliability`                              | `d911f70`                            | [PR #24](https://github.com/MaTriXy/not-codex/pull/24) — merged                 |
|     2 | [#8](https://github.com/MaTriXy/not-codex/issues/8)   | Durable integration-run lifecycle and LoopAny delivery history                       | `main`                            | `codex/issue-8-durable-runs`                                | `b19b85f`                            | [PR #25](https://github.com/MaTriXy/not-codex/pull/25) — merged                 |
|     3 | [#17](https://github.com/MaTriXy/not-codex/issues/17) | Mobile integration status and environment selection                                  | `main`                            | `codex/issue-17-mobile-integrations`                        | `578b43c`                            | [PR #26](https://github.com/MaTriXy/not-codex/pull/26) — merged                 |
|     4 | [#16](https://github.com/MaTriXy/not-codex/issues/16) | Pinned LoopAny protocol fixtures that detect upstream drift                          | `main`                            | `codex/issue-16-loopany-fixtures`                           | `0238ef2`                            | [PR #27](https://github.com/MaTriXy/not-codex/pull/27) — merged                 |
|     5 | [#9](https://github.com/MaTriXy/not-codex/issues/9)   | Validate and launch durable Loopy runs from the web UI                               | #8                                | `codex/issue-9-loopy-run-flow`                              | `0d5f2fe`                            | [PR #40](https://github.com/MaTriXy/not-codex/pull/40) — merged; supersedes #28 |
|     6 | [#10](https://github.com/MaTriXy/not-codex/issues/10) | Durable run history, detail, timeline, and thread links                              | #9                                | `codex/issue-10-loopy-run-operations`                       | `c33fc73`                            | [PR #29](https://github.com/MaTriXy/not-codex/pull/29) — merged                 |
|     7 | [#11](https://github.com/MaTriXy/not-codex/issues/11) | Server-authorized run inspection and cancellation                                    | #10                               | `codex/issue-11-loopy-inspect-cancel`                       | `29bccbe`                            | [PR #30](https://github.com/MaTriXy/not-codex/pull/30) — merged                 |
|     8 | [#12](https://github.com/MaTriXy/not-codex/issues/12) | Journal-backed resume and distinct linked retries                                    | #11                               | `codex/issue-12-loopy-resume-retry`                         | `a09131c`                            | [PR #31](https://github.com/MaTriXy/not-codex/pull/31) — merged                 |
|     9 | [#13](https://github.com/MaTriXy/not-codex/issues/13) | State-aware recovery controls that fail closed across reconnects                     | #12                               | `codex/issue-13-loopy-recovery-controls`                    | `1ca5f1f`                            | [PR #32](https://github.com/MaTriXy/not-codex/pull/32) — merged                 |
|    10 | [#15](https://github.com/MaTriXy/not-codex/issues/15) | Sanitized LoopAny connector health and delivery diagnostics                          | #13                               | `codex/issue-15-loopany-diagnostics`                        | `d591e58`                            | [PR #33](https://github.com/MaTriXy/not-codex/pull/33) — merged                 |
|    11 | [#18](https://github.com/MaTriXy/not-codex/issues/18) | Mobile run history, detail, timeline, and linked threads                             | #15 and #17                       | `codex/issue-18-mobile-run-history`                         | `fcbc68e`                            | [PR #34](https://github.com/MaTriXy/not-codex/pull/34) — merged                 |
|    12 | [#19](https://github.com/MaTriXy/not-codex/issues/19) | Mobile validation and launch of verified Loopy specifications                        | #18                               | `codex/issue-19-mobile-loopy-launch`                        | `b7a1f46`                            | [PR #35](https://github.com/MaTriXy/not-codex/pull/35) — merged                 |
|    13 | [#20](https://github.com/MaTriXy/not-codex/issues/20) | Mobile inspect, cancel, resume, and retry controls                                   | #19                               | `codex/issue-20-mobile-run-controls`                        | `2e9b07f`                            | [PR #36](https://github.com/MaTriXy/not-codex/pull/36) — merged                 |
|    14 | [#21](https://github.com/MaTriXy/not-codex/issues/21) | Secret-safe mobile LoopAny configuration and diagnostics                             | #20                               | `codex/issue-21-mobile-loopany-settings`                    | `80d13f5`                            | [PR #37](https://github.com/MaTriXy/not-codex/pull/37) — merged                 |
|    15 | [#22](https://github.com/MaTriXy/not-codex/issues/22) | Cross-platform reconnect, authorization, accessibility, and compact-layout hardening | #21                               | `codex/issue-22-mobile-integration-hardening`               | `307c82b`                            | [PR #38](https://github.com/MaTriXy/not-codex/pull/38) — merged                 |
|  Gate | [#14](https://github.com/MaTriXy/not-codex/issues/14) | Proven end-to-end LoopAny poll, harness execution, progress, and terminal report     | #15 and safe external credentials | No code branch required unless the live test finds a defect | Pending external acceptance evidence | Open gate                                                                       |
| Final | [#23](https://github.com/MaTriXy/not-codex/issues/23) | One accurate epic, dependency graph, review order, and completion record             | #7–#22 and #14 evidence           | `codex/issue-23-integrations-epic`                          | Current PR head                      | [PR #39](https://github.com/MaTriXy/not-codex/pull/39) — final review           |

## Completed dependency and merge order

Independent foundation PRs can merge first in any order:

1. #7 / PR #24
2. #8 / PR #25
3. #16 / PR #27
4. #17 / PR #26

The web/server run stack then merges in dependency order:

1. #9 / replacement PR #40 (superseded PR #28)
2. #10 / PR #29
3. #11 / PR #30
4. #12 / PR #31
5. #13 / PR #32
6. #15 / PR #33

The mobile stack follows #15 and #17:

1. #18 / PR #34
2. #19 / PR #35
3. #20 / PR #36
4. #21 / PR #37
5. #22 / PR #38

Issue #14 can run after #15 is available in a safe test build. Issue #23 is reconciled last; it does not
turn the external acceptance gate into a code requirement or claim that a fixture is a production
round-trip.

## Validation evidence

Each implementation branch has focused tests plus the repository-required `vp check` and
`vp run typecheck`. Native mobile branches also pass `vp run lint:mobile` and production Expo exports
for iOS and Android. The final #22 descendant passed:

- 612 test files passed; 2 intentionally skipped.
- 4,750 tests passed; 7 intentionally skipped.
- `vp check`: 0 errors and the same 9 pre-existing web nested-component warnings.
- `vp run typecheck`: passed across all 15 workspace packages.
- `vp run lint:mobile`: 0 SwiftLint violations; Kotlin static checks passed.
- Production iOS export: 9,330 modules bundled.
- Production Android export: 9,330 modules bundled.

The first full-suite attempt on #22 encountered one timing-sensitive Cursor cancellation assertion.
That test passed immediately in isolation, and the complete suite passed on the clean rerun. No unrelated
provider code was changed in the mobile hardening issue.

## GitHub reconciliation checklist

1. ✅ Merge implementation PRs #24–#38 in dependency order, using replacement PR #40 for the
   auto-closed PR #28.
2. ✅ Retarget each stacked descendant to `main` before deleting its obsolete parent branch.
3. ✅ Leave issue #14 open and keep PR #39 from closing issue #23 prematurely.
4. Complete review and merge of this final reconciliation PR #39.
5. Run and attach the issue #14 live acceptance transcript with tokens, unrestricted paths, workflow
   source, and agent transcripts redacted.
6. Update issue #23 with final merged PR links and close it only when all required evidence is present.

## Honest remaining boundary

- No live LoopAny server round-trip has been claimed. Issue #14 needs a configured safe server URL,
  device token, and disposable allowed root supplied outside Git.
- Hands-on VoiceOver, TalkBack, dynamic-type, and smallest-supported-device review remains release QA;
  automated semantics, native lint, shared behavior tests, and both production bundles are complete.
