# Loop integrations roadmap delivery ledger

Last reconciled: 2026-07-19

This ledger is the review and merge map for the Not Codex integration roadmap. It records ordinary Git
history only: no issue branch is squashed, reset, force-pushed, or replaced by a synthetic root commit.

## TL;DR

- The integration foundation is already on `main` through PR
  [#6](https://github.com/MaTriXy/not-codex/pull/6).
- Issues #7–#13 and #15–#17 have published branches and open pull requests.
- Issues #18–#22 are implemented, validated, published, and linked to stacked pull requests #34–#38.
- Issue #14 remains intentionally open because it requires a real, safe LoopAny server, token, and
  disposable allowed root. Unit fixtures cannot substitute for that live interoperability evidence.
- Issue #23 is the final epic reconciliation and closes only after the implementation PRs merge and the
  issue #14 evidence is attached.

## Delivery inventory

| Order | Issue                                                 | What users gain                                                                      | Dependency                        | Branch                                                      | Commit                               | Pull request / state                                         |
| ----: | ----------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------- | ----------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------ |
|     1 | [#7](https://github.com/MaTriXy/not-codex/issues/7)   | Reliable CI selection and deterministic provider reprobes                            | `main`                            | `codex/issue-7-ci-reliability`                              | `fae5aa0`                            | [PR #24](https://github.com/MaTriXy/not-codex/pull/24)       |
|     2 | [#8](https://github.com/MaTriXy/not-codex/issues/8)   | Durable integration-run lifecycle and LoopAny delivery history                       | `main`                            | `codex/issue-8-durable-runs`                                | `eea904f`                            | [PR #25](https://github.com/MaTriXy/not-codex/pull/25)       |
|     3 | [#17](https://github.com/MaTriXy/not-codex/issues/17) | Mobile integration status and environment selection                                  | `main`                            | `codex/issue-17-mobile-integrations`                        | `a3eb579`                            | [PR #26](https://github.com/MaTriXy/not-codex/pull/26)       |
|     4 | [#16](https://github.com/MaTriXy/not-codex/issues/16) | Pinned LoopAny protocol fixtures that detect upstream drift                          | `main`                            | `codex/issue-16-loopany-fixtures`                           | `bddc8eb`                            | [PR #27](https://github.com/MaTriXy/not-codex/pull/27)       |
|     5 | [#9](https://github.com/MaTriXy/not-codex/issues/9)   | Validate and launch durable Loopy runs from the web UI                               | #8                                | `codex/issue-9-loopy-run-flow`                              | `b9bd4a6`                            | [PR #28](https://github.com/MaTriXy/not-codex/pull/28)       |
|     6 | [#10](https://github.com/MaTriXy/not-codex/issues/10) | Durable run history, detail, timeline, and thread links                              | #9                                | `codex/issue-10-loopy-run-operations`                       | `c51ad21`                            | [PR #29](https://github.com/MaTriXy/not-codex/pull/29)       |
|     7 | [#11](https://github.com/MaTriXy/not-codex/issues/11) | Server-authorized run inspection and cancellation                                    | #10                               | `codex/issue-11-loopy-inspect-cancel`                       | `886b7da`                            | [PR #30](https://github.com/MaTriXy/not-codex/pull/30)       |
|     8 | [#12](https://github.com/MaTriXy/not-codex/issues/12) | Journal-backed resume and distinct linked retries                                    | #11                               | `codex/issue-12-loopy-resume-retry`                         | `fe1bdd4`                            | [PR #31](https://github.com/MaTriXy/not-codex/pull/31)       |
|     9 | [#13](https://github.com/MaTriXy/not-codex/issues/13) | State-aware recovery controls that fail closed across reconnects                     | #12                               | `codex/issue-13-loopy-recovery-controls`                    | `9046629`                            | [PR #32](https://github.com/MaTriXy/not-codex/pull/32)       |
|    10 | [#15](https://github.com/MaTriXy/not-codex/issues/15) | Sanitized LoopAny connector health and delivery diagnostics                          | #13                               | `codex/issue-15-loopany-diagnostics`                        | `232ac64`                            | [PR #33](https://github.com/MaTriXy/not-codex/pull/33)       |
|    11 | [#18](https://github.com/MaTriXy/not-codex/issues/18) | Mobile run history, detail, timeline, and linked threads                             | #15 and #17                       | `codex/issue-18-mobile-run-history`                         | `89f70b8`                            | [PR #34](https://github.com/MaTriXy/not-codex/pull/34)       |
|    12 | [#19](https://github.com/MaTriXy/not-codex/issues/19) | Mobile validation and launch of verified Loopy specifications                        | #18                               | `codex/issue-19-mobile-loopy-launch`                        | `c17e871`                            | [PR #35](https://github.com/MaTriXy/not-codex/pull/35)       |
|    13 | [#20](https://github.com/MaTriXy/not-codex/issues/20) | Mobile inspect, cancel, resume, and retry controls                                   | #19                               | `codex/issue-20-mobile-run-controls`                        | `3c221d8`                            | [PR #36](https://github.com/MaTriXy/not-codex/pull/36)       |
|    14 | [#21](https://github.com/MaTriXy/not-codex/issues/21) | Secret-safe mobile LoopAny configuration and diagnostics                             | #20                               | `codex/issue-21-mobile-loopany-settings`                    | `26c50fe`                            | [PR #37](https://github.com/MaTriXy/not-codex/pull/37)       |
|    15 | [#22](https://github.com/MaTriXy/not-codex/issues/22) | Cross-platform reconnect, authorization, accessibility, and compact-layout hardening | #21                               | `codex/issue-22-mobile-integration-hardening`               | `7b08a15`                            | [PR #38](https://github.com/MaTriXy/not-codex/pull/38)       |
|  Gate | [#14](https://github.com/MaTriXy/not-codex/issues/14) | Proven end-to-end LoopAny poll, harness execution, progress, and terminal report     | #15 and safe external credentials | No code branch required unless the live test finds a defect | Pending external acceptance evidence | Open gate                                                    |
| Final | [#23](https://github.com/MaTriXy/not-codex/issues/23) | One accurate epic, dependency graph, review order, and completion record             | #7–#22 and #14 evidence           | `codex/issue-23-integrations-epic`                          | `44b5671`                            | [Draft PR #39](https://github.com/MaTriXy/not-codex/pull/39) |

## Dependency and merge order

Independent foundation PRs can merge first in any order:

1. #7 / PR #24
2. #8 / PR #25
3. #16 / PR #27
4. #17 / PR #26

The web/server run stack then merges in dependency order:

1. #9 / PR #28
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

1. ✅ Push issue branches #18–#23 without force.
2. ✅ Open one PR per branch using the dependency base shown above; the mobile stack remains separately
   reviewable.
3. ✅ Add `Closes #<issue>` to implementation PRs #34–#38 and leave #14 open. Draft PR #39 tracks #23
   without closing it prematurely.
4. Recheck CI and review comments from the oldest dependency to the newest.
5. Merge in the order above, retargeting descendant PRs to the next live base when GitHub requires it.
6. Run and attach the issue #14 live acceptance transcript with tokens, unrestricted paths, workflow
   source, and agent transcripts redacted.
7. Update issue #23 with final merged PR links and close it only when all required evidence is present.

## Honest remaining boundary

- No live LoopAny server round-trip has been claimed. Issue #14 needs a configured safe server URL,
  device token, and disposable allowed root supplied outside Git.
- Hands-on VoiceOver, TalkBack, dynamic-type, and smallest-supported-device review remains release QA;
  automated semantics, native lint, shared behavior tests, and both production bundles are complete.
