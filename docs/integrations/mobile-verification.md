# Mobile integration verification

The Not Codex mobile app is a client of a paired execution environment. It does not run Monkey.D.Loopy,
LoopAny, or an agent harness locally. This matrix records the cross-platform acceptance boundary for the
mobile integration screens.

| Scenario              | Expected iOS and Android behavior                                                                                                                                      | Evidence                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Reconnect or offline  | Cached status and run data may remain visible, but refresh, paging, launch, settings changes, and run controls remain disabled until fresh server state arrives.       | Shared connection-state guards and presentation tests            |
| Authorization failure | The screen identifies the authorization problem without rendering raw server errors, tokens, paths, or payload fragments.                                              | Safe failure classifier and secret-leak regression test          |
| Interrupted command   | The app reports that the action did not complete and requires a refresh before another mutation. Launch also requires a fresh authoring query.                         | Command interruption handling and launch eligibility tests       |
| Concurrent command    | A pending operation disables related actions so duplicate launches, run controls, or settings writes cannot be submitted.                                              | Pending-state guards and server-authorized control policy        |
| Accessibility         | Actions have descriptive labels, disabled/checked state is announced, section titles are headings, warnings are alerts, and touch targets are at least 48 points high. | React Native semantics, mobile typecheck, and static native lint |
| Compact layout        | Status rows and runtime headings wrap, action groups flow onto additional lines, and controls do not depend on a fixed screen width.                                   | Flex-wrap layouts and minimum-width action groups                |
| Native packaging      | The same React Native integration routes and shared state compile into production bundles for both native targets.                                                     | Production Expo exports for iOS and Android                      |

## Reproducible checks

Run these commands from the repository root:

```sh
vp test run \
  apps/mobile/src/features/settings/integrationPresentation.test.ts \
  apps/mobile/src/features/integrations/integrationRunLaunchPresentation.test.ts \
  apps/mobile/src/features/integrations/integrationRunsPresentation.test.ts \
  packages/client-runtime/src/state/loopAnySettings.test.ts
vp run typecheck
vp check
vp run lint:mobile
pnpm --filter @notcodex/mobile exec expo export --platform ios --output-dir /tmp/not-codex-mobile-ios
pnpm --filter @notcodex/mobile exec expo export --platform android --output-dir /tmp/not-codex-mobile-android
vp test run
```

Production exports and automated checks prove that the shared behavior builds for both platforms.
Hands-on VoiceOver, TalkBack, dynamic-type, and smallest-supported-device review remains part of release
QA because it requires a paired environment and physical or configured simulator accessibility tooling.
