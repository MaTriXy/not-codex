# T3 Code upstream review — 2026-08-05

This review covers every commit from `7a820abfddbf` (exclusive) through `41ebf22eea64` (inclusive). Changes are semantic-port candidates only; upstream branding, release identity, hosted-service assumptions, and protected assets are never imported automatically.

## Outcome

- Reviewed: **292 commits**.
- Ported across the upstream integration batches: **28** in-window commits, including 24 new reliability/performance ports and 4 commits already integrated before this review.
- Deferred into explicit queues: **256**.
- Rejected as upstream release/brand identity: **8**.
- The ledger `lastAudited` boundary can advance to `41ebf22eea64e177b11a0709a16d6716581cc78c`; `lastIntegrated` must remain at the earlier boundary while deferred candidates remain unported.

## Recommended next batches

1. **Cross-client Git ref cache migration.** Review `38a6e3ce` as a dedicated contracts/server/web/mobile migration; its generation-based invalidation and persistence changes should land atomically rather than as a partial server cache.
2. **Glass and appearance foundation.** Start with the application-surface refresh (`c5ff51ec`), glass settings/primitives (`14b6bfdf`), light-mode restoration (`e51538b8`), unified dialog/composer overlays (`4d834364`), Appearance navigation (`4f584da0`), and configurable typography (`8eca2000`). Adapt tokens and primitives first; do not copy T3 artwork.
3. **Sidebar v2 as a staged program.** Port the settled lifecycle and persistence from `32c6012d` separately from the UI. Then build the flat web list and apply its stabilization chain. Add snoozing (`202e5609`), search (`bfc31507`), and pinning (`da6e1a96`) only after the lifecycle is stable. Mobile should remain a separate native batch.

## Sidebar v2 and glass assessment

Sidebar v2 is architecturally valuable because it replaces implicit client-only grouping with a server-backed settled lifecycle and makes later pin/snooze/search behavior predictable across reconnects. Its initial commit touches 79 files and adds roughly 5,800 lines across contracts, persistence, orchestration, web, desktop, and mobile, so a wholesale cherry-pick would be high risk. The recommended adaptation is: contracts and migration → projector/decider invariants → client-runtime reducer → web list → stabilization fixes → optional organization features.

The glass redesign is a better near-term visual win. It is mostly separable from the lifecycle work if we first extract appearance tokens and shared surface primitives. The strongest pieces are consistent dialog/popover/composer materials, light/dark contrast restoration, configurable opacity and typography, translucent toasts, and cleaner application spacing. Header artwork and all T3-specific colors/assets should be redesigned for Not Codex rather than ported.

## Review queues

| Queue                         | Commits | Decision   |
| ----------------------------- | ------: | ---------- |
| already-integrated            |       4 | integrated |
| connect-and-relay             |      17 | defer      |
| cross-platform-product        |       9 | defer      |
| glass-and-appearance          |      38 | defer      |
| mobile                        |      34 | defer      |
| performance-follow-up         |      10 | defer      |
| ported-now                    |      24 | integrated |
| protected-release             |       8 | reject     |
| server-and-provider           |      25 | defer      |
| sidebar-v2                    |      31 | defer      |
| tooling-docs-and-dependencies |      13 | defer      |
| web-product                   |      79 | defer      |

## Exhaustive commit ledger

| SHA          | Disposition | Queue                         | Subject                                                                                            |
| ------------ | ----------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `2b180a2b2d` | defer       | connect-and-relay             | Refine T3 Connect authorization surfaces (#4159)                                                   |
| `398140a9bd` | port        | ported-now                    | fix: increase OpenCode server startup timeout from 5s to 30s (#4132)                               |
| `e8ff6bc7f8` | port        | already-integrated            | fix(shared): delete unused agentAwareness phase predicates (#4134)                                 |
| `271454cbd2` | defer       | mobile                        | fix(mobile): Stabilize native stack option updates (#4037)                                         |
| `69c8be2ee5` | defer       | tooling-docs-and-dependencies | Make test-t3-app skill discoverable by Claude Code (#4162)                                         |
| `b511227b7a` | defer       | glass-and-appearance          | fix(web): improve dev sidebar backdrop contrast & remove version pills (#4166)                     |
| `7e1a0d551c` | defer       | web-product                   | Fix draft banner stack overlap (#4164)                                                             |
| `e34250df46` | defer       | mobile                        | Add portable mobile app testing guidance (#4165)                                                   |
| `2640e6dcfc` | port        | ported-now                    | fix(client): use lightweight connection probe (#4137)                                              |
| `3795dbb017` | port        | ported-now                    | fix(server): resolve Claude SDK executable path on Windows npm installs (#3740)                    |
| `63b6b44627` | defer       | web-product                   | Fix project action preview settings persistence (#3842)                                            |
| `78485e6d50` | defer       | cross-platform-product        | fix(desktop): allow clipboard writes in the preview browser (#3889)                                |
| `dfbda84362` | defer       | web-product                   | fix(web): handle sidebar shortcut before editors (#3921)                                           |
| `68ea280388` | port        | ported-now                    | fix(server): recognize Bedrock-backed Claude as authenticated (#3931)                              |
| `d7baa37e5c` | defer       | web-product                   | Fix incorrect pluralization of “entry” (#3933)                                                     |
| `749baec353` | defer       | server-and-provider           | feat(server): title background-task work-log rows with the task name (#3751)                       |
| `3235658c08` | defer       | server-and-provider           | fix: delegate OpenCode session titles to provider (#3720)                                          |
| `df65a6c3ad` | defer       | web-product                   | Archive selected threads from the context menu (#3895)                                             |
| `5fcfe242c1` | defer       | server-and-provider           | fix(cli): support force removing projects (#3922)                                                  |
| `d266c068d0` | defer       | web-product                   | fix: allow sidebar to be shrunk when wider than viewport (#2456)                                   |
| `33f1cb4224` | defer       | server-and-provider           | fix(codex): show web search query and url in tool call details (#2093)                             |
| `40c0ab0883` | defer       | web-product                   | Add Codex launch arguments setting (#2892)                                                         |
| `501ce27b81` | port        | ported-now                    | [orchestration] Clear stale active turn when session becomes inactive (#3159)                      |
| `08993a5ec8` | defer       | tooling-docs-and-dependencies | Regenerate Codex reset credit protocol bindings (#4173)                                            |
| `2fae0d0ac3` | defer       | web-product                   | fix(preview): preserve direct localhost navigation (#3939)                                         |
| `8e3467fe60` | defer       | mobile                        | Synchronize mobile threads with authoritative shell snapshots (#4163)                              |
| `b6d9ce325c` | defer       | glass-and-appearance          | Gate iOS glass layout on native support (#4032)                                                    |
| `f4da4f3b40` | port        | ported-now                    | fix(opencode): resume the OpenCode session on follow-ups instead of starting an empty one (#3617)  |
| `0ca3240691` | port        | ported-now                    | fix(server): use CLI for OpenCode health check instead of spawning server (#4153)                  |
| `946b867666` | defer       | web-product                   | fix(web): scope timeline minimap hover target to the side gutter (#3869)                           |
| `a135f2c2d3` | defer       | web-product                   | [codex] show complete approval details (#4111)                                                     |
| `c710167bde` | defer       | web-product                   | fix(web): paint text selection over composer chips (#4139)                                         |
| `fa69f05b69` | defer       | web-product                   | [codex] preserve custom model slugs (#4168)                                                        |
| `0936fd271f` | defer       | web-product                   | fix(web): preview workspace images in the file panel (#3996)                                       |
| `8ca4eec9ca` | defer       | web-product                   | feat(web): drag files from the explorer into the chat composer (#4140)                             |
| `2c199aacac` | defer       | web-product                   | fix(desktop): preserve main window bounds (#3851)                                                  |
| `db4b2d8a0f` | port        | ported-now                    | perf(orchestration): speed up new-chat propagation and offline catch-up (#4177)                    |
| `c8a04bd59b` | defer       | web-product                   | Finale: upgrade changed files card to fix various UI issues (#4113)                                |
| `5d34f9ff23` | defer       | connect-and-relay             | Pass CLI OAuth config to hosted web deploy (#4186)                                                 |
| `c0bb237345` | defer       | web-product                   | fix(web): always show environment chip for remote projects (#4217)                                 |
| `23c18fda7a` | defer       | web-product                   | fix(web): keep composer editable while disconnected (#4241)                                        |
| `62cf461759` | defer       | mobile                        | fix: better defaults — Claude 1M context, Codex gpt-5.6, worktrees from origin main (#4240)        |
| `6f34ad3e87` | port        | ported-now                    | fix(claude): handle all SDK stream messages; stop spurious work-log warning rows (#4244)           |
| `32c6012dab` | defer       | sidebar-v2                    | Sidebar v2 beta: flat thread list with a server-backed settled lifecycle (#4026)                   |
| `282ecb3178` | defer       | web-product                   | fix(settings): validate the add-provider wizard step before advancing (#2813) (#3100)              |
| `aa5ec80364` | port        | ported-now                    | fix(claude): isolate capability probe from user MCP servers (#4015)                                |
| `783692afc1` | defer       | server-and-provider           | Preserve connecting status while a turn starts (#4101)                                             |
| `4e09cddb40` | defer       | server-and-provider           | fix(server): stop restoring stale OpenCode models (#4095)                                          |
| `c7b21ff172` | port        | already-integrated            | [codex] keep scoped package references as text (#4167)                                             |
| `b6e1b39335` | defer       | web-product                   | fix(web): default provider selection for users without Codex (#4117)                               |
| `571a8b44bd` | port        | already-integrated            | Unify temporary worktree branch naming (#4278)                                                     |
| `020179c19a` | defer       | sidebar-v2                    | fix(web): use message-square icon for settled icon-less project threads in sidebar v2 (#4279)      |
| `18b468871e` | defer       | sidebar-v2                    | Stabilize sidebar settling animations (#4280)                                                      |
| `e5fba263e6` | defer       | web-product                   | Restore Copy Link in chat link context menu (#4161)                                                |
| `f74eb62661` | port        | ported-now                    | fix(desktop): handle EPIPE errors on stdout/stderr to prevent crash dialog (#4213)                 |
| `18fa89c4ad` | defer       | sidebar-v2                    | Preserve draft thread highlighting during promotion (#4283)                                        |
| `7e2bb47504` | defer       | mobile                        | Move mobile working timer into the thread timeline (#4285)                                         |
| `376c149eac` | defer       | server-and-provider           | Stabilize PR status lookups and provider session lifecycle (#4281)                                 |
| `9fe4832a3f` | defer       | sidebar-v2                    | fix: open command palette instead of custom dialog for new thread picker in SidebarV2 (#4269)      |
| `9a0a07167f` | defer       | server-and-provider           | fix(server): don't drop sticky PR fallback when remote URL can't be resolved (#4289)               |
| `78a0ea55c1` | defer       | web-product                   | feat(web): copy branch name via right-click in the branch selector (#4275)                         |
| `ab4a88386d` | defer       | web-product                   | Add remote server updates and standalone service management (#4286)                                |
| `593289c3c7` | defer       | sidebar-v2                    | Refine light-mode sidebar surfaces (#4268)                                                         |
| `bc9428a06a` | defer       | connect-and-relay             | fix(mobile): don't mark Android VPN/Tailscale as offline when connected (#3949)                    |
| `2d31cb022d` | defer       | web-product                   | improve and prevent silent thread branch drift and PR fetching (#2284)                             |
| `c5ff51ec1f` | defer       | glass-and-appearance          | feat(web): refresh application surfaces                                                            |
| `b6a2563db7` | defer       | glass-and-appearance          | style(web): polish dark mode dialogs                                                               |
| `14b6bfdf15` | defer       | glass-and-appearance          | fix(web): unify and tune glass surfaces                                                            |
| `29b1abc45e` | defer       | glass-and-appearance          | fix(web): apply glass opacity to thread tooltip                                                    |
| `6e5df67f15` | defer       | glass-and-appearance          | fix(web): override thread tooltip background                                                       |
| `10da67b9da` | defer       | glass-and-appearance          | fix(web): apply glass opacity to model picker                                                      |
| `0b1ce58824` | defer       | glass-and-appearance          | style(web): polish glass opacity slider                                                            |
| `5961d36769` | defer       | glass-and-appearance          | fix(web): apply glass opacity to command palette                                                   |
| `d330759f58` | defer       | glass-and-appearance          | fix(web): add glass composer alerts                                                                |
| `160d97f403` | defer       | glass-and-appearance          | fix(web): honor composer glass opacity                                                             |
| `39cd15b954` | defer       | web-product                   | test(web): stabilize timeline module setup                                                         |
| `c38225ef1c` | defer       | glass-and-appearance          | style(web): fade settings content beneath navbar                                                   |
| `936394b6f2` | defer       | glass-and-appearance          | test(desktop): include glass opacity in settings fixture                                           |
| `9c9916aefe` | defer       | glass-and-appearance          | fix(web): address redesign review findings                                                         |
| `b44ed835c6` | defer       | web-product                   | fix(web): sync provider banner dismissal                                                           |
| `16491a84b9` | defer       | web-product                   | fix(web): new-thread defaults ignored for remote environments (#4276)                              |
| `fbd77420f2` | defer       | mobile                        | feat: add "Auto" runtime mode — AI-reviewed approvals for Codex and Claude (#4272)                 |
| `1c9a6de26e` | defer       | web-product                   | Add shared t3.json project configuration support (#4317)                                           |
| `e51538b812` | defer       | glass-and-appearance          | Restore light-mode surfaces and refine dialog styling                                              |
| `4d83436415` | defer       | glass-and-appearance          | Unify dialog glass and fix composer overlays (#4365)                                               |
| `b41e89eba9` | defer       | web-product                   | fix(web): warn before silent Windows updates (#4350)                                               |
| `7609495bf7` | defer       | sidebar-v2                    | [codex] Move project grouping to General settings (#4313)                                          |
| `0542abc75e` | defer       | sidebar-v2                    | [codex] Group project scopes in mobile thread lists (#4314)                                        |
| `719c905eac` | defer       | sidebar-v2                    | [codex] Move mobile project grouping to General settings (#4315)                                   |
| `315b27385d` | defer       | web-product                   | [codex] Deduplicate connection failure messaging (#4367)                                           |
| `3afb4a9ef9` | defer       | sidebar-v2                    | Restore grouped project filtering in Sidebar V2 (#4282)                                            |
| `57100fba85` | defer       | sidebar-v2                    | [codex] restore Sidebar V2 project actions (#4373)                                                 |
| `9d9208cec5` | defer       | sidebar-v2                    | [codex] Group projects in new-thread pickers (#4312)                                               |
| `9cbe50d10d` | defer       | glass-and-appearance          | fix(web): restore dark composer toolbar styling                                                    |
| `979854895c` | defer       | glass-and-appearance          | Fix thread tooltip folder icon color (#4383)                                                       |
| `88c69ffff6` | defer       | server-and-provider           | fix(server): parse CLI version in update preflight (#4389)                                         |
| `ddd5a46f39` | defer       | sidebar-v2                    | fix(web): sidebar v2 polish — jump hints, working duration, in-flight fade, settled sort (#4274)   |
| `b3e51317e4` | defer       | mobile                        | Fix logical project grouping labels on mobile (#4391)                                              |
| `79fe11bc1c` | defer       | web-product                   | Add preview color scheme controls and simplify project grouping (#4385)                            |
| `edb12401e5` | reject      | protected-release             | fix(cli): publish nightly branded favicons (#4372)                                                 |
| `91dfe60a99` | defer       | sidebar-v2                    | Fix thread loading flash (#4396)                                                                   |
| `193e3c62e6` | defer       | sidebar-v2                    | fix(client-runtime): keep a warm thread un-settled despite a merged/closed PR (#4309)              |
| `6ef7aa8399` | defer       | glass-and-appearance          | Fix composer context strip alignment and glass shell (#4404)                                       |
| `ce467da9cf` | defer       | glass-and-appearance          | Polish iOS git progress overlay with glass effects (#4387)                                         |
| `67a7b1a1d3` | defer       | glass-and-appearance          | Improve composer glass fallbacks (#4406)                                                           |
| `51672b6ecb` | defer       | web-product                   | feat(web): collapse large git diffs by default to make chat more readable (#4409)                  |
| `2f41c073a2` | defer       | web-product                   | Stop new threads inheriting checkout/branch from viewed thread (#4411)                             |
| `fc3f78f5d9` | defer       | web-product                   | fix: tone down branch-mismatch banner (#4416)                                                      |
| `6b9a5987f6` | defer       | server-and-provider           | fix: Claude Code skills discoverable for the composer $ picker (#4414)                             |
| `bb38c3320d` | defer       | sidebar-v2                    | fix(web): keep settled threads reachable when opened directly (#4413)                              |
| `202e5609ff` | defer       | sidebar-v2                    | feat(sidebar-v2): thread snoozing (#4311)                                                          |
| `5d173547ff` | defer       | mobile                        | Upgrade Clerk packages and Expo integration (#4440)                                                |
| `15e875a2d9` | defer       | glass-and-appearance          | Increase light-mode contrast for user message bubbles (#4441)                                      |
| `f7cc776488` | defer       | web-product                   | Restore model picker layout and retain iterative test state (#4450)                                |
| `a7ee3092c3` | defer       | glass-and-appearance          | Color settled PR labels on hover (#4451)                                                           |
| `ece05087a7` | defer       | glass-and-appearance          | [codex] Fix glass hover compositing artifacts (#4446)                                              |
| `41a430a88e` | port        | already-integrated            | Add Claude Opus 5 model (#4472)                                                                    |
| `38cfc25e54` | defer       | web-product                   | feat(web): add collapse-all toggle to diff panel (#4475)                                           |
| `5719e8ac40` | defer       | web-product                   | feat(web): show fast mode as a bolt instead of a "Normal" label (#4488)                            |
| `a17cbc3b40` | defer       | tooling-docs-and-dependencies | feat(dev): keep worktree dev state isolated on T3 Code dev servers (#4555)                         |
| `23b5502217` | defer       | web-product                   | feat(dev): Make t3 code dev instances shareable over Tailscale (#4556)                             |
| `89c5a192f4` | defer       | tooling-docs-and-dependencies | fix(dev): skip browser-blocked ports (#4608)                                                       |
| `d60f6e971f` | port        | ported-now                    | fix: cut websocket throughput in half by pruning activity payloads (#4622)                         |
| `b4680cbfd0` | defer       | performance-follow-up         | perf(mobile): defer work-log detail serialization (#4607)                                          |
| `23ea08daf2` | defer       | performance-follow-up         | test: account for lazy thread feed details (#4628)                                                 |
| `a78f245dff` | defer       | connect-and-relay             | feat(relay): limit managed tunnels per user (#4530)                                                |
| `2b06c08a4b` | defer       | connect-and-relay             | Add managed tunnel limits migration (#4635)                                                        |
| `f4c394323d` | defer       | web-product                   | Add background preview capture and picture-in-picture support (#4397)                              |
| `200fa826b0` | defer       | web-product                   | feat(web): prompt stash — cmd+S saves the composer to a per-provider queue (#4453)                 |
| `108e01746c` | defer       | mobile                        | Upgrade Effect and Alchemy betas (#4643)                                                           |
| `bdf99c17bf` | defer       | web-product                   | feat: allow new thread creation through project breadcrumbs (#4638)                                |
| `724887717f` | defer       | web-product                   | fix(web): scope PR state to the thread branch (#4460)                                              |
| `d2d40b6c1a` | defer       | connect-and-relay             | Drop redundant Relay user indexes (#4648)                                                          |
| `96398e3775` | defer       | connect-and-relay             | feat(connect): release the Cloudflare tunnel when the environment shuts down (#4531)               |
| `180620e436` | defer       | connect-and-relay             | Fix Relay Worker RuntimeContext wiring (#4653)                                                     |
| `da11342e03` | defer       | web-product                   | Fix live sidebar resize limits and defer Alchemy runtime context (#4655)                           |
| `32843c2551` | defer       | web-product                   | fix(web): constrain branch toolbar context (#4657)                                                 |
| `0e19c103ef` | port        | ported-now                    | Keep MCP credentials alive across provider turns (#4659)                                           |
| `f0121f31d0` | defer       | web-product                   | fix: close actions dropdown when editing (#4660)                                                   |
| `32af2f0024` | defer       | web-product                   | fix(preview): stabilize PiP viewport identity (#4661)                                              |
| `80ead5f3a7` | defer       | glass-and-appearance          | Add glass styling for thread tooltips and simplify preview tab handling (#4665)                    |
| `5ba6ef7f84` | defer       | connect-and-relay             | Use tarball archiving for hosted web deploys (#4669)                                               |
| `6e3b73884b` | port        | ported-now                    | fix(server): bound editor discovery during config loading (#4291)                                  |
| `e77f42c111` | defer       | web-product                   | Prevent draft thread detail polling before shell registration (#4670)                              |
| `10bca3f44e` | defer       | web-product                   | feat: add configurable source control writing settings (#4204)                                     |
| `eea3ea4c6f` | defer       | web-product                   | feat(diff-panel): show total line additions and deletions (#4674)                                  |
| `6afbed3c36` | defer       | web-product                   | Clear provider update actions while updating (#4676)                                               |
| `6a3df51707` | defer       | web-product                   | Fix sidebar highlighting for draft threads (#4679)                                                 |
| `3957a95818` | defer       | glass-and-appearance          | Use glass surfaces for web toasts (#4681)                                                          |
| `a2ffb122e2` | defer       | web-product                   | Show origin ref in branch trigger label (#4680)                                                    |
| `1153afb4fb` | defer       | mobile                        | fix(mobile): match react version to react-native 0.85.3 vendored renderer (19.2.3) (#4675)         |
| `831eb66fee` | reject      | protected-release             | chore(release): prepare v0.0.29                                                                    |
| `a148e08197` | defer       | mobile                        | Add OTA update checks to mobile settings (#4686)                                                   |
| `476d69cd1d` | defer       | mobile                        | fix(mobile): threads load snapped to bottom on iOS (#4689)                                         |
| `c13a021e43` | defer       | sidebar-v2                    | feat: default sidebar v2 on for nightly and dev builds (#4491)                                     |
| `dd5ea32488` | defer       | sidebar-v2                    | fix(web): 33 web UI fixes (#4700)                                                                  |
| `b0c4992c79` | defer       | sidebar-v2                    | Make mobile Thread List v2 the default (#4717)                                                     |
| `d25b15737a` | defer       | mobile                        | Fix mobile showcase workflow without Clerk (#4718)                                                 |
| `e00781a661` | defer       | connect-and-relay             | Fix relay credential lookup for unlinked environments (#4692)                                      |
| `9cf9fc9c5c` | defer       | cross-platform-product        | Settle merged PR threads immediately (#4704)                                                       |
| `362f127922` | defer       | sidebar-v2                    | feat(web): add maria's sidebar header artwork toggle (#4652)                                       |
| `4f584da0f8` | defer       | glass-and-appearance          | feat(web): add appearance settings category (#4715)                                                |
| `9ccfd9dfef` | defer       | cross-platform-product        | fix(desktop): allow updater-controlled relaunch (#4721)                                            |
| `3c50a64885` | defer       | web-product                   | fix(web): prevent diff panel scroll jumping (#4724)                                                |
| `55dd01612e` | defer       | web-product                   | Link inline code file paths in chat markdown (#4726)                                               |
| `f1a68ac9b0` | defer       | sidebar-v2                    | Fix Android showcase capture and rebuild v2 queued rows (#4730)                                    |
| `887dd6e455` | port        | ported-now                    | perf(server): negotiate permessage-deflate on the websocket (#4705)                                |
| `b64ae880e0` | defer       | tooling-docs-and-dependencies | docs: overhaul agent guidance (#4782)                                                              |
| `2deea7abb0` | defer       | sidebar-v2                    | Prevent sidebar row labels from truncating (#4789)                                                 |
| `8829e2f9b9` | port        | ported-now                    | perf(server): gzip large thread snapshots (#4788)                                                  |
| `f2d2fb2f24` | defer       | web-product                   | fix(web): stashed prompts now survive switching providers (#4787)                                  |
| `38a6e3ce65` | defer       | performance-follow-up         | Fix Git ref refresh resource storms (#4727)                                                        |
| `5fcdefd057` | port        | ported-now                    | perf(server): trim stale context-window rows and drop dead replay RPC (#4791)                      |
| `1ba3d01bc6` | defer       | web-product                   | fix(web): defer command palette filesystem navigation (#2109)                                      |
| `2919147c80` | defer       | web-product                   | fix(release): skip scripts during Vercel installs (#4796)                                          |
| `936593c258` | defer       | mobile                        | refactor(client): share filesystem browse navigation (#4797)                                       |
| `8fe8f9a9c1` | defer       | mobile                        | fix(mobile): defer filesystem navigation (#4799)                                                   |
| `8650f05f95` | port        | ported-now                    | refactor(server): use native HTTP compression streams (#4798)                                      |
| `60af905e70` | defer       | connect-and-relay             | Remove Connect waitlist and add GA announcement tooling (#4691)                                    |
| `1b61ce1112` | defer       | connect-and-relay             | Fix Connect sign-in settings label (#4806)                                                         |
| `694f8d1c6e` | reject      | protected-release             | chore(release): prepare v0.0.30                                                                    |
| `1b4830ff06` | defer       | connect-and-relay             | fix(desktop): restore T3 Connect sign-in (#4809)                                                   |
| `08e4932f04` | defer       | web-product                   | Simplify files panel header (#4828)                                                                |
| `72b960fa39` | defer       | tooling-docs-and-dependencies | build(desktop): reduce installed app size by ~300MB (#4824)                                        |
| `c3e8fb67d7` | defer       | tooling-docs-and-dependencies | Update model version from claude-opus-4-8 to claude-opus-5 (#4832)                                 |
| `3137c2b162` | defer       | web-product                   | Preserve the thread shell while detail loads (#4830)                                               |
| `49c0d96edf` | defer       | performance-follow-up         | Reduce idle work and disk churn with native resource diagnostics (#2679)                           |
| `d19039aeef` | port        | ported-now                    | fix(server): detect repositories after initialization (#4848)                                      |
| `faea70aeba` | port        | ported-now                    | perf(server): merge separate staged/unstaged numstat calls into single diff HEAD --numstat (#4843) |
| `85a8986870` | port        | ported-now                    | fix(git): disable external diff for review diff previews (#4854)                                   |
| `fc28abf24b` | defer       | web-product                   | Fix editable file focus and live syntax highlighting (#3979)                                       |
| `e6987965f6` | defer       | web-product                   | fix(web): remember the rendered-markdown choice across threads (#4853)                             |
| `a8e05cbb92` | reject      | protected-release             | chore(release): prepare v0.0.31                                                                    |
| `9e3e9bb4f0` | defer       | performance-follow-up         | fix(mobile): reduce thread feed scroll jank (#4874)                                                |
| `35a684000d` | defer       | sidebar-v2                    | fix(web): restore sidebar v2 thread actions and terminal icon (#4712)                              |
| `2d9066e089` | defer       | sidebar-v2                    | fix(web): settle button now works on hover, not just right-click (#4905)                           |
| `758decaa56` | defer       | mobile                        | fix(clients): disable add project while disconnected (#4834)                                       |
| `b125b76351` | defer       | web-product                   | fix(composer): hide default Codex service tier (#4784)                                             |
| `748203ea19` | reject      | protected-release             | docs: link iOS and Android app store downloads (#4902)                                             |
| `6efcf3e10c` | defer       | web-product                   | fix(web): align remote server update action (#4731)                                                |
| `6ab2f16809` | defer       | connect-and-relay             | fix(connect): suggest a serve command that matches how you ran connect (#4897)                     |
| `00da6b57a4` | defer       | mobile                        | fix(mobile): stop shared content errors in Personal Team builds (#4943)                            |
| `f0f16e4f6e` | defer       | performance-follow-up         | perf(mobile): sends respond instantly, thread opens stop freezing (#4882)                          |
| `9146ed2f49` | defer       | web-product                   | fix(web): show Codex fast mode as a bolt (#4947)                                                   |
| `2f466ffc9c` | defer       | tooling-docs-and-dependencies | docs: seed worktrees with a copy of real userdata instead of banning it (#4949)                    |
| `2652fee49b` | defer       | mobile                        | fix(mobile): support dragged images in the composer (#4953)                                        |
| `90f3913a81` | defer       | performance-follow-up         | fix(mobile): stop long iOS threads from jumping while scrolling up (#4867)                         |
| `f0c6ba9946` | defer       | web-product                   | fix(web): keep worktree default when switching a draft's machine (#4964)                           |
| `69a18ce912` | defer       | performance-follow-up         | perf(mobile): reconnect environments immediately on resume (#4878)                                 |
| `cbe8052020` | defer       | web-product                   | feat(web): pasting a huge screenshot now compresses it instead of erroring (#4967)                 |
| `5c9358acaa` | defer       | web-product                   | feat(web): regenerate thread titles from sidebar (#4810)                                           |
| `197d348711` | defer       | web-product                   | fix(web): show server update progress through reconnect (#4903)                                    |
| `4b71a2ae2f` | defer       | mobile                        | feat(search): find threads by conversation content (#4959)                                         |
| `50871eb5de` | defer       | tooling-docs-and-dependencies | fix: marketing site Vercel builds no longer die after ~100 deploys (#4975)                         |
| `9dd425b223` | defer       | tooling-docs-and-dependencies | docs: split user and maintainer docs, fix 100+ stale claims (#4807)                                |
| `e0513d2983` | defer       | web-product                   | fix(web): server updates no longer look like warnings (#4992)                                      |
| `1877237c7a` | defer       | connect-and-relay             | fix(connect): reboots no longer strand the relay link, 403s now say why (#4988)                    |
| `abc409c2d4` | defer       | web-product                   | Add project file picker (⌘P) and project content search (⇧⌘F) (#4855)                              |
| `6154b46cb8` | defer       | mobile                        | Check for mobile app updates on launch (#4958)                                                     |
| `323dc321a2` | defer       | glass-and-appearance          | fix(mobile): support pre-Liquid-Glass iOS bottom toolbar (#4984)                                   |
| `edc503a7a8` | defer       | server-and-provider           | fix(server): restore PR detection without HOME (#4985)                                             |
| `4ba4871af7` | defer       | web-product                   | fix(web): fill fast mode icon (#5004)                                                              |
| `1d77cec991` | defer       | mobile                        | fix: cache project favicons across web and mobile (#4767)                                          |
| `e4829603ff` | defer       | performance-follow-up         | perf(ci): cut stale runs and redundant setup (#4802)                                               |
| `bc142f84a2` | reject      | protected-release             | chore(mobile): bump app version to 1.0.1                                                           |
| `5b2577f6a9` | defer       | glass-and-appearance          | style(web): make scroll-to-end pill translucent (#5036)                                            |
| `4029b858ea` | defer       | tooling-docs-and-dependencies | fix(ci): drop sparse-checkout from EAS workflows                                                   |
| `fbecb7365e` | defer       | tooling-docs-and-dependencies | fix(desktop): bump Clerk Electron SDK to 0.0.24 and register t3code:// scheme on Linux (#5015)     |
| `34b15a9ace` | defer       | performance-follow-up         | perf(server): cache default branch name and origin existence across status refreshes (#5008)       |
| `063ed7120a` | defer       | cross-platform-product        | feat(shared): support shorthand (major-only) versions in the semver helpers (#5027)                |
| `162e774294` | defer       | mobile                        | fix(mobile): remove unnecessary photo library permission (#4929)                                   |
| `32407df9c5` | port        | ported-now                    | fix(shared): lenient JSON parser deletes commas inside string values (#5025)                       |
| `1d694dcbd8` | defer       | mobile                        | fix(mobile): default bare IP pairing to HTTP (#4990)                                               |
| `cb293fe790` | reject      | protected-release             | fix(mobile): restore iOS Threads branding (#4862)                                                  |
| `b0b275227b` | defer       | mobile                        | chore: add mobile issue template area (#4895)                                                      |
| `41124c7260` | defer       | web-product                   | fix(desktop): link release notes from the update downloaded toast (#4771)                          |
| `cb11a71d63` | defer       | mobile                        | fix(mobile): accept Android clipboard images in composer (#4836)                                   |
| `605c2bb734` | defer       | mobile                        | fix(mobile): show the correct build channel in Android's Threads page header (#4861)               |
| `df78cda8bf` | defer       | cross-platform-product        | fix(contracts): decode growing config unions forward-compatibly (#5055)                            |
| `e259dd23c7` | defer       | mobile                        | fix(mobile): server model, worktree, and origin preferences now apply to new tasks (#5064)         |
| `50a3d6b872` | defer       | mobile                        | fix(ci): repair the mobile showcase screenshots workflow (#5057)                                   |
| `fccec9f097` | defer       | mobile                        | fix(ci): capture iPad App Store screenshots in landscape (#5065)                                   |
| `894d6d68f5` | defer       | tooling-docs-and-dependencies | fix(oxlint-plugin): Resolve the oxlint bin without assuming a pnpm layout (#5066)                  |
| `61514c1294` | defer       | server-and-provider           | feat(cli): `npx t3 pair` - generate QR code from a running server (#4955)                          |
| `ef4ec2ad4b` | defer       | server-and-provider           | fix(server): self-update no longer rolls itself back on restart (#5095)                            |
| `ab8182cb4e` | defer       | mobile                        | fix(ci): rotate iPad showcase captures without Simulator UI scripting (#5094)                      |
| `acf761b2f5` | defer       | mobile                        | feat(web): render terminals with libghostty-vt (#4860)                                             |
| `964cc27901` | defer       | mobile                        | refactor: move the canonical libghostty-vt vendor to the repository root (#5102)                   |
| `a041981276` | defer       | sidebar-v2                    | feat(mobile): add thread snoozing (#5053)                                                          |
| `916cff733c` | defer       | sidebar-v2                    | feat(mobile): make settled threads collapsible (#5056)                                             |
| `03adf215ce` | defer       | sidebar-v2                    | follow-up normalization after #4700. (#4498)                                                       |
| `bfc31507f8` | defer       | sidebar-v2                    | feat(web): search threads from the sidebar (#4769)                                                 |
| `e5c7547067` | defer       | web-product                   | feat(web): add settings sidebar search (#4682)                                                     |
| `491219bf1f` | defer       | cross-platform-product        | fix: threads with open PRs no longer auto-settle (#5151)                                           |
| `ca72e381c6` | port        | ported-now                    | fix(server): bound thread catch-up replay and stop full-DB snapshot hydration (#5147)              |
| `0ad91b6e7f` | defer       | server-and-provider           | fix(server): follow branch drift in dedicated worktrees so PRs link to their thread (#5159)        |
| `d3037064e6` | defer       | server-and-provider           | fix(server): make remote updates rollback-safe (#5181)                                             |
| `78eb3ecae9` | defer       | sidebar-v2                    | fix(web): stop settle controls overlapping the status label (#4574)                                |
| `283c7ac4ba` | reject      | protected-release             | fix: normalize app icon glyph sizing (#5202)                                                       |
| `5192f777fe` | defer       | connect-and-relay             | fix(server): surface cloudflared FTL/PNC relay logs as warnings, not debug (#5076)                 |
| `64bf016191` | defer       | server-and-provider           | fix(server): stop npx service updates from silently leaving the old server running (#5217)         |
| `e60821f0e0` | defer       | mobile                        | feat: fold legacy models into separate menus (#5190)                                               |
| `69dfb7f09a` | defer       | cross-platform-product        | fix(desktop): claim the t3code:// scheme default on Linux at startup (#5054)                       |
| `30c9622806` | defer       | glass-and-appearance          | fix(web): polish interface spacing (#5252)                                                         |
| `6f04a5cffb` | defer       | cross-platform-product        | fix(desktop): Niri/Hyprland - Linux secret storage backend (#2916)                                 |
| `a261a6440a` | defer       | glass-and-appearance          | fix(web): match loading screen to dark theme (#5303)                                               |
| `11639bf439` | defer       | web-product                   | fix(web): blink the terminal cursor again (#5314)                                                  |
| `553867262c` | defer       | web-product                   | fix(terminal): protect held Ctrl/Cmd+W close shortcut (#5322)                                      |
| `1cbd88aba0` | defer       | server-and-provider           | fix(server): strip replayable terminal queries from history (#5319)                                |
| `966cc05a90` | defer       | cross-platform-product        | fix(contracts): decode ServerProviders forward-compatibly (#5327)                                  |
| `25ec0b9d13` | defer       | glass-and-appearance          | fix(web): simplify chat code blocks (#5301)                                                        |
| `cec1bb9de3` | defer       | glass-and-appearance          | fix(web): align multiline error alert controls (#5304)                                             |
| `2b1d4fecb8` | defer       | server-and-provider           | Upgrade Effect to beta.103 (#5331)                                                                 |
| `8a16cadbaf` | defer       | glass-and-appearance          | fix(web): increase tooltip z-index to overlay popovers and menus (#5326)                           |
| `82b76e2138` | defer       | server-and-provider           | fix(server): use a Cursor todo's title when its content is blank (#5073)                           |
| `37ae1abbe9` | defer       | connect-and-relay             | fix(ssh): isolate managed tunnel processes (#4347)                                                 |
| `c30a6d9b99` | defer       | server-and-provider           | fix(server): scrub AppImage XDG_DATA_DIRS and GSETTINGS_SCHEMA_DIR from terminals (#5075)          |
| `94331c58ec` | defer       | mobile                        | fix(mobile): show correct provider icons for Grok, Cursor, and OpenCode (#4586)                    |
| `90e3778660` | defer       | glass-and-appearance          | fix(web): stop the chat timeline reading through the provider status banner (#5353)                |
| `36caf34c68` | port        | ported-now                    | fix(desktop,web): contain renderer memory growth and recover from renderer OOM crashes (#5148)     |
| `d7950ac153` | defer       | server-and-provider           | fix(server): generate durable thread titles (#5357)                                                |
| `4fb03aff0b` | defer       | glass-and-appearance          | fix(web): better right panel (new diffs styling) (#5260)                                           |
| `9bd2a4c688` | defer       | server-and-provider           | fix(server): keep regenerated titles on topic (#5365)                                              |
| `2fa1fec8d8` | defer       | server-and-provider           | refactor(server): make title prompts plaintext (#5368)                                             |
| `8eca20005b` | defer       | glass-and-appearance          | feat(web): configurable fonts and sizes under Settings → Appearance (#5103)                        |
| `da6e1a9678` | defer       | sidebar-v2                    | feat(sidebar-v2): thread pinning for sidebar v2 (#5312)                                            |
| `fff6a5b028` | defer       | web-product                   | feat(web): make pairing QR codes actually scannable, with endpoint choice (#5360)                  |
| `94696b0f54` | defer       | web-product                   | fix(desktop,web): improve in-app browser shortcuts and URL behavior (#4703)                        |
| `7537adc30f` | defer       | web-product                   | fix(web): prevent legacy model picker layout shift (#5349)                                         |
| `7b38fb5c6b` | defer       | server-and-provider           | fix(server): allow remote updates with database migrations (#5374)                                 |
| `3d429662c9` | defer       | server-and-provider           | fix(mcp): unblock Kimi models in OpenCode with preview tools (#5128)                               |
| `41ebf22eea` | defer       | web-product                   | fix(web): clear main branch lint warnings (#5384)                                                  |
