# Not Codex Marketing Site Redesign Process

Status: **Implementation-ready draft awaiting owner approval**

## Decision

Rebuild the marketing homepage as a product-led editorial site. Preserve the first draft's clean
layout and restrained motion, but replace its generic product story with the real Not Codex logo,
authentic product screenshots, and a complete explanation of the shared execution model spanning
interactive sessions, repository workflows, Automations, Monkey D. Loopy, and optional LoopAny
deliveries.

The implementation must distinguish shipped, experimental, optional, and planned behavior. It must
not imply that a hosted app, signed package, production LoopAny round trip, or production model-quality
verification exists when it does not.

## Goals

1. Explain what Not Codex is within the first viewport.
2. Show the real product instead of a decorative imitation.
3. Make the relationship between ordinary sessions, Automations, Monkey D. Loopy, and LoopAny clear.
4. Demonstrate repository safety, durable execution, recovery, and human review.
5. Present current and future behavior without blending them together.
6. Establish a distinct Not Codex brand based on the existing logo.
7. Keep the static Astro site fast, accessible, responsive, and inexpensive to host on Cloudflare.
8. Preserve the existing legal, privacy, security, and support routes and contact addresses.

## Non-goals

- Redesigning the product application itself.
- Adding a hosted Not Codex service or downloadable release.
- Claiming full compatibility with untested provider or LoopAny versions.
- Creating a fake LoopAny server success state.
- Building a JavaScript-heavy carousel, interactive demo, or animated provider-logo cloud.
- Replacing the existing legal documents or performing legal review.
- Deploying before explicit owner approval.

## Audience and primary questions

### Primary audience

Developers already using one or more coding-agent CLIs who want a reliable, inspectable workspace for
real repository work.

They need the homepage to answer, in order:

1. What is Not Codex?
2. Which agents can it run?
3. Does it work on real repositories safely?
4. Can I inspect, approve, recover, and review what the agent does?
5. How do Automations and Monkey D. Loopy change the workflow?
6. What is LoopAny, and do I need it?
7. What is available today, and how can I try it?

### Secondary audience

- Contributors evaluating the architecture and source quality.
- Teams exploring repeatable local agent workflows.
- Security-conscious users evaluating execution and credential boundaries.
- Future users arriving from Monkey D. Loopy or LoopAny documentation.

## Reuse-audit findings (REVIEW BEFORE PROCEEDING)

The following pre-existing infrastructure matches the requested redesign:

- **Logo assets**: `apps/marketing/public/icon.png`, `icon.webp`, favicons, and the matching web-app
  icon already contain the official Not Codex mark. Reuse these rather than drawing a replacement.
- **Marketing runtime**: `apps/marketing/src/pages/index.astro` renders the homepage through
  `apps/marketing/src/layouts/Layout.astro`; `apps/marketing/public/site.js` supplies the small shared
  navigation behavior. Extend this static path rather than introducing a frontend runtime.
- **Site configuration**: `apps/marketing/src/lib/site.ts` already owns the canonical site URL,
  repository URL, issue URL, and role addresses. Reuse these constants.
- **Existing product routes**: `/automations`, `/settings/integrations`, `/runs`, and
  `/runs/$environmentId/$runId` already render the product surfaces required for authentic captures.
- **Existing integration UI**: `IntegrationsSettings`, `IntegrationRunsPage`,
  `IntegrationRunReceipt`, and `LoopAnyDiagnosticsPanel` already express the real product vocabulary
  and state model. Capture these components through the running app rather than reconstructing them.
- **Existing isolation control**: `NOT_CODEX_HOME` and the dev runner's instance/port controls allow a
  disposable product environment that does not touch the owner's normal Not Codex data.
- **Existing architecture asset**: `not-codex-control-plane.webp` can support the trust-boundary
  explanation, but it is a concept diagram and cannot replace interface screenshots.
- **Existing documentation**: `README.md`, `ROADMAP.md`, `docs/integrations/README.md`,
  `docs/integrations/monkey-d-loopy.md`, and `docs/integrations/loopany.md` are the claim authority.
- **Existing screenshot tooling**: `playwright-core` is already present through the desktop package.
  Reuse it if automated capture is needed; do not install a second browser automation stack.
- **No data migration, API route, new SDK, or production environment variable is required.** A
  development-only capture helper may be added only after proving manual disposable capture is not
  repeatable enough.

## Runtime call paths

### Public marketing page

```text
GET /
  -> apps/marketing/src/pages/index.astro
  -> apps/marketing/src/layouts/Layout.astro
  -> static assets under apps/marketing/public
  -> Astro static build
  -> Cloudflare Pages deployment
```

### Product screenshot sources

```text
Web application router
  -> ordinary session route and Sidebar
  -> /automations -> AutomationsPage
  -> /settings/integrations -> IntegrationsSettings
  -> /runs -> IntegrationRunsPage
  -> /runs/:environmentId/:runId -> IntegrationRunReceipt
```

Only files on these live paths, shared marketing components they directly import, static assets, and
verification files should change.

## Product claim taxonomy

Every material claim must have one visible status in the content specification:

| Status       | Meaning                                                           | Presentation                                   |
| ------------ | ----------------------------------------------------------------- | ---------------------------------------------- |
| Available    | Implemented in the repository and supported by current docs/tests | Plain declarative copy                         |
| Experimental | Implemented but early, bounded, or subject to sharp edges         | `Experimental` label near the claim            |
| Optional     | Requires a separately configured external service                 | `Optional integration` label                   |
| Planned      | Directional intent, not currently shipped                         | Contained in a dedicated `What's next` section |

### Available claims

- Provider-neutral sessions using configured Codex, Claude Code, Cursor, and OpenCode adapters.
- Branch, worktree, checkpoint, diff, stacked-change, and pull-request preparation workflows.
- Inspectable streaming execution, tool activity, approvals, structured input, and failures.
- Web, desktop, mobile companion, remote pairing, reconnect recovery, and durable projections.
- Local-first, restart-safe Automations with immediate, once, interval, and weekly schedules.
- Durable integration run history and state-authorized cancel, resume, and retry controls.

### Experimental claims

- Monkey D. Loopy v0.5 authoring context, verified recipes, inference, validation, dry-run
  verification, bounded execution, journals, and recovery.
- Source-first distribution and early-work-in-progress product status.

### Optional claims

- LoopAny polling and reporting protocol support.
- Root-constrained delivery, connector health, and sanitized diagnostic history.
- Not Codex Connect or other separately configured remote infrastructure where mentioned.

### Claims that require qualification

- Monkey D. Loopy verification proves control-flow properties with mocked effects; it does not prove
  provider or model quality.
- Inference creates scaffolding; it does not prove semantic equivalence with the source loop.
- Mobile controls a paired execution environment; it does not execute loops or connectors locally.
- LoopAny is disabled by default and requires the user's compatible server and token.
- No live production LoopAny server round trip has been demonstrated by this project.
- Not Codex implements the pinned public machine protocol surface; do not claim broader compatibility.
- The website and source are public, but a hosted app and signed packages are not currently offered.

## Messaging architecture

### Positioning statement

> Not Codex is a local-first control plane for coding agents: one inspectable workspace for interactive
> sessions, repository workflows, durable automations, and bounded agent loops.

### Hero copy contract

- **Eyebrow**: `Local-first control plane for coding agents`
- **Headline**: `One reliable workspace for every coding agent.`
- **Supporting copy**: Explain that Codex, Claude Code, Cursor, and OpenCode run through one durable,
  reviewable workflow without hiding tool activity or repository changes.
- **Primary CTA**: `Explore the source`
- **Secondary CTA**: `See how it works`
- **Availability note**: `Early work in progress · build from source today`

Copy may be polished during implementation, but it may not change the meaning or availability boundary.

## Information architecture and section contract

### 1. Header

- Official mark plus `Not Codex` word label.
- Anchors: `Product`, `Workflows`, `Integrations`, `Trust`.
- Repository CTA.
- Mobile navigation must work without JavaScript-dependent content access.

### 2. Hero: the real workspace

- Two-column editorial composition on wide screens; stacked on mobile.
- Real workspace screenshot is the dominant object.
- Provider names appear as restrained text, not a logo spectacle.
- The screenshot caption identifies it as the actual Not Codex interface.

### 3. Product proof strip

Four concise facts:

1. Provider-neutral sessions.
2. Isolated repository work.
3. Durable, inspectable execution.
4. Desktop, web, and mobile supervision.

### 4. Repository workflow

- Explain branch/worktree isolation, checkpoints, diffs, stacked changes, and PR preparation.
- Show the actual session plus Git/diff surface.
- Emphasize reviewability rather than agent autonomy as the value proposition.

### 5. One execution model

Render a lightweight HTML/CSS flow, not a bitmap-only diagram:

```text
Human prompt ─┐
Automation ───┤
Loopy spec ───┼─> Not Codex harness -> agent thread -> tools/approvals -> Git review
LoopAny task ─┘
```

The diagram must remain understandable to screen readers and at mobile widths.

### 6. Automations

- Show the real Automations page.
- Explain immediate/once/interval/weekly triggers, bounded follow-up, project checks, isolated
  worktrees, notifications, and optional branch/PR outcomes.
- State that Automations remain ordinary Not Codex threads with durable timelines.

### 7. Monkey D. Loopy

- Label as `Experimental integration`.
- Show authoring/validation and a durable run receipt.
- Explain recipes, inference, explicit caps, validation versus execution readiness, durable journals,
  and cancel/resume/retry.
- Include the mocked-effects/model-quality boundary in adjacent text, not hidden in the footer.

### 8. LoopAny

- Label as `Optional integration`.
- Explain scheduling/delivery remains external while Not Codex stays the local execution authority.
- Show the real configuration and diagnostics interface.
- If no real compatible server is available during capture, show the honest disabled or unconfigured
  state. Never synthesize a healthy production connection.
- Explain root constraints, inert handling of workflow source, sanitized diagnostics, and token privacy.

### 9. Cross-device supervision

- Show mobile run detail beside a desktop receipt if a sanitized mobile capture is available.
- Explain paired-environment control, explicit confirmations, and offline read-only behavior.
- State that execution and journals stay on the selected Not Codex environment.

### 10. Trust and boundaries

- Local execution authority.
- User-owned provider credentials.
- Explicit approvals and durable receipts.
- External delivery root constraints and secret redaction.
- Early-WIP recovery warning.
- Link to Security Policy, Privacy Policy, Terms, and legal notice.

### 11. Available now / What's next

- `Available now`: source, provider adapters, clients, repository workflows, Automations, and current
  integration foundation.
- `What's next`: only items copied from the current roadmap, visibly marked `Planned`.
- This section must not invent dates or promise releases.

### 12. Final CTA and footer

- Source-first CTA with build-from-source language.
- Documentation and issue tracker links.
- Support, legal, privacy, and security email links from `site.ts`.
- Trademark/non-affiliation disclosure covering OpenAI/Codex, Anthropic/Claude and Claude Code,
  Cursor, OpenCode, T3 Tools, and T3 Code.

## Visual system

### Brand direction

- Use the existing logo as the color authority.
- Warm paper background, ink typography, quiet neutral surfaces, and the logo's red/orange as the
  principal accent.
- Use the warm-white terminal tile from the mark as a recurring framing motif.
- Keep borders crisp and shadows restrained.
- Do not imitate T3 Code's dark neon presentation.

### Typography

- Continue with fast system/font-stack typography unless the existing draft already loads a local,
  license-safe face.
- Display type should feel editorial rather than terminal-themed.
- Monospace is reserved for labels, states, paths, commands, and execution metadata.

### Motion

- Limit motion to navigation state, subtle reveal/hover transitions, and optional screenshot focus.
- Respect `prefers-reduced-motion`.
- Do not autoplay video or animate critical explanatory content.

### Responsive behavior

- Desktop reference: 1440 px wide.
- Laptop reference: 1280 px wide.
- Tablet reference: 768 px wide.
- Mobile references: 390 px and 375 px wide.
- Screenshot frames may crop nonessential chrome on mobile, but captions and feature meaning must remain.

## Authentic screenshot specification

### Asset directory and naming

Store approved assets under `apps/marketing/public/product/`:

| File                       | Content                                                 | Target source capture              |
| -------------------------- | ------------------------------------------------------- | ---------------------------------- |
| `workspace.webp`           | Main thread, tool activity, sidebar, and product mark   | 1600x1000 or denser                |
| `repository-workflow.webp` | Branch/worktree context and reviewable diff             | 1600x1000 or denser                |
| `automations.webp`         | Populated Automations page                              | 1600x1000 or denser                |
| `loopy-authoring.webp`     | Recipe/LoopSpec editor and validation result            | 1600x1000 or denser                |
| `loopy-run.webp`           | Durable run receipt, caps, state, and recovery controls | 1600x1000 or denser                |
| `loopany.webp`             | Configuration and honest diagnostics state              | 1600x1000 or denser                |
| `mobile-run.webp`          | Paired mobile run detail and allowed controls           | native high-density mobile capture |

Retain uncompressed PNG capture sources outside the public payload while working. Commit only the
approved optimized assets unless the lossless source is needed for reproducibility.

### Disposable capture environment

1. Create `/private/tmp/notcodex-marketing-demo` as a synthetic Git repository.
2. Use neutral content such as a small task-board application and issue names that reveal no private
   client, user, or repository information.
3. Use a dedicated base directory such as `/private/tmp/notcodex-marketing-home` through
   `NOT_CODEX_HOME`.
4. Use a separate dev instance/port so the capture app cannot attach to the owner's normal environment.
5. Configure Git identity locally inside the disposable repository with an `.example` address.
6. Use only tokens/credentials already available to the local provider CLI; never render credential
   settings or authentication output.
7. Do not save a real LoopAny token in the capture environment unless the owner explicitly provides a
   disposable server and token for this purpose.
8. Destroying the disposable directories is a separate destructive step and requires explicit approval.

### Scenario content

- Project name: `Orbit Notes` or another clearly synthetic name.
- Main task: add a keyboard-accessible project filter and tests.
- Repository screenshot: show the isolated worktree, changed files, and a small readable diff.
- Automation: weekly dependency health check with bounded follow-until-complete and project checks.
- Loopy recipe: bounded review-and-fix loop with explicit iteration and time caps.
- Loopy run: show a completed or deliberately paused synthetic run with real durable receipt controls.
- LoopAny: show configuration structure and the actual connector state available during capture.
- Mobile: show the same synthetic run ID lineage with no unrestricted path or transcript.

### Sanitization checklist

Every image must be rejected if it contains any of the following:

- `/Users/`, a real home directory, or an unrestricted filesystem path.
- Real email addresses, account names, repository URLs, or organization names.
- API tokens, device tokens, auth commands, environment variables, or credential state.
- Real external delivery IDs, journals, transcripts, or provider request IDs.
- Notifications, browser bookmarks, operating-system menu content, or unrelated applications.
- Timestamps that materially identify a private work session.

Perform both automated text/OCR-oriented inspection where practical and a manual 100% zoom review.

### Capture feasibility gate

Attempt normal disposable capture first. Add a development-only capture fixture only when one of the
required states cannot be created repeatably through supported product behavior. Any fixture must:

- be excluded from production bundles and runtime paths;
- use public contract types rather than ad-hoc screenshot-only shapes;
- contain only synthetic data;
- never bypass authorization or secret-redaction logic;
- be documented as a capture/test fixture, not a product feature;
- receive focused tests before use.

## Marketing implementation structure

### Expected modifications

- `apps/marketing/src/pages/index.astro`: new information architecture and section copy.
- `apps/marketing/src/layouts/Layout.astro`: official brand header/footer, metadata, and global tokens.
- `apps/marketing/public/site.js`: only navigation behavior still required after the redesign.
- `apps/marketing/src/lib/site.ts`: add documentation/roadmap URLs only if repeated enough to justify
  canonical constants.
- Social metadata and the Open Graph image reference.

### Expected reusable components

Create components only where repetition justifies them:

- `BrandMark.astro`: consistent logo and word label.
- `ProductFrame.astro`: responsive screenshot, caption, status, dimensions, and loading behavior.
- `SectionHeading.astro`: shared eyebrow/title/description structure.
- `StatusLabel.astro`: Available, Experimental, Optional, and Planned semantics.

Before creating each path, verify it does not already exist. Avoid splitting one-off sections into
components.

### Screenshot manifest

Prefer one typed marketing-local manifest containing asset path, dimensions, alt text, caption, and
loading priority. This prevents captions and accessibility descriptions from drifting away from their
images.

### Static behavior

- Hero image may load eagerly with `fetchpriority="high"`.
- All below-the-fold screenshots load lazily.
- Every image has intrinsic dimensions to avoid layout shift.
- Use `<picture>` only when an alternate mobile crop materially improves comprehension.
- Content and navigation remain usable when `site.js` fails.

## Verification contract authored before implementation

Add a deterministic marketing verification command before changing the page. It should build the Astro
site and inspect the generated homepage for:

- official logo reference;
- required section IDs and anchor targets;
- current/experimental/optional/planned labels;
- repository, documentation, legal, privacy, security, and support links;
- screenshot assets with nonempty alt text and intrinsic dimensions;
- absence of placeholder copy and known disallowed availability claims;
- valid local asset references.

Prefer a small script within the marketing package and Node's built-in facilities. Do not add a test
framework solely for this page. The verifier should fail against incomplete work and become a lasting
regression guardrail.

## Performance and accessibility budgets

### Performance

- No new client framework or hydration boundary.
- Shared JavaScript remains under 8 KiB uncompressed unless a measured need is approved.
- Hero screenshot target: at most 220 KiB.
- Other desktop screenshots target: at most 180 KiB each.
- Mobile screenshot target: at most 120 KiB.
- Below-the-fold images must lazy-load.
- No avoidable cumulative layout shift from media.
- Target Lighthouse performance score: 95 or better in a local production preview, treated as a
  diagnostic rather than a CI guarantee.

### Accessibility

- WCAG 2.2 AA color contrast target.
- Logical heading hierarchy with one `h1`.
- Skip link and semantic landmarks.
- Keyboard-operable header navigation and CTAs.
- Visible focus states.
- Meaningful alt text; captions must add context rather than repeat alt text.
- Flow diagram has an equivalent ordered textual explanation.
- Reduced-motion support.
- Test at 200% browser zoom and mobile reflow without horizontal page scrolling.

## Implementation phases and gates

### Phase 0 — Preserve and baseline

1. Record the current branch and uncommitted marketing draft.
2. Do not touch the user-owned untracked readiness/security reports.
3. Capture baseline desktop/mobile screenshots of the current draft.
4. Run the existing marketing build, `vp check`, and `vp run typecheck` to establish baseline health.

Exit: baseline evidence recorded; no unrelated file changes.

### Phase 1 — Freeze the claim and copy specification

1. Convert the claim taxonomy above into final section copy.
2. Cite the supporting documentation path for every nontrivial product claim in working notes.
3. Check product names, capitalization, links, availability language, and non-affiliation wording.
4. Produce a text-only homepage outline for review.

Exit: no unsupported or ambiguous claims.

### Phase 2 — Screenshot storyboard and feasibility

1. Launch the isolated application and synthetic repository.
2. Verify each required route/state can be produced through supported behavior.
3. Record any state that would require a capture fixture.
4. Produce low-resolution draft captures and captions.

**Owner breakpoint 1:** approve the copy outline, capture storyboard, and any proposed fixture before
polished implementation. If no fixture is required, approval covers the complete autonomous build phase.

### Phase 3 — Verification-first setup

1. Author the marketing verification command from this specification.
2. Confirm it detects the missing required sections/assets in the current draft.
3. Add the expected asset manifest schema and accessibility requirements.

Exit: acceptance guardrail exists before final page implementation.

### Phase 4 — Capture and sanitize product evidence

1. Create the approved synthetic state.
2. Capture desktop and mobile screens at stable dimensions.
3. Sanitize, crop, and optimize assets.
4. Review every image against the rejection checklist.
5. Confirm captions and status labels accurately describe the captured state.

Exit: complete screenshot set with zero private data and honest state descriptions.

### Phase 5 — Implement the design system and page

1. Install no new runtime dependencies.
2. Implement brand tokens, official logo treatment, header, and footer.
3. Implement reusable screenshot/status components.
4. Rebuild sections in the specified order.
5. Implement responsive behavior from mobile through desktop.
6. Add the accessible execution-model flow.
7. Update metadata and social preview.
8. Preserve all existing legal routes and contact constants.

Exit: complete static page satisfying the verifier.

### Phase 6 — Convergent design QA

Iterate until all gates pass:

1. Astro build and typecheck.
2. Marketing contract verifier.
3. Desktop captures at 1440 and 1280 widths.
4. Tablet capture at 768 width.
5. Mobile captures at 390 and 375 widths.
6. Keyboard navigation, reduced motion, 200% zoom, and horizontal-overflow checks.
7. Broken-link and missing-asset checks.
8. Lighthouse/performance review.
9. Visual comparison against the approved storyboard.

### Phase 7 — Repository validation and review loop

1. Run `vp check`.
2. Run `vp run typecheck`.
3. Run the marketing production build and verifier.
4. Inspect `git diff --check` and the scoped diff.
5. Commit only the redesign, verification, and approved screenshot assets.
6. Push normally and open/update the pull request.
7. Request Codex review.
8. Resolve every actionable comment on the matching thread, rerun gates, push, and request review again.
9. Repeat until Codex reports no issues on the current head and all review threads are resolved.

Exit: review-clean PR with green local evidence. GitHub Actions may remain unavailable due to the known
credits constraint; it must be reported, not misrepresented as passing.

### Phase 8 — Publication handoff

1. Present the final local/preview URL and a concise claim/readiness report.
2. Confirm Cloudflare project/account, custom domain, and existing email routing remain correct.
3. Confirm legal review is still tracked separately.

**Owner breakpoint 2:** explicit approval to merge/deploy. No deployment occurs without it.

4. Deploy to Cloudflare through the already authenticated owner account.
5. Verify `https://notcodex.bpro.dev`, headers, metadata, legal routes, and asset loading.
6. Preserve the Cloudflare Pages fallback URL as infrastructure, but promote only the custom domain.

## Acceptance criteria

The redesign is complete only when all of the following are true:

- [x] Official logo is visible in the header and hero.
- [x] Hero contains an authentic, sanitized product screenshot.
- [x] At least five authentic product captures are present; mobile is included when feasible.
- [x] Repository workflow and durable execution are visually demonstrated.
- [x] Automations, Monkey D. Loopy, and LoopAny are first-class sections.
- [x] The shared execution model is understandable without reading integration documentation.
- [x] Available, Experimental, Optional, and Planned behavior cannot be confused.
- [x] Monkey D. Loopy limitations appear beside its feature explanation.
- [x] LoopAny is identified as external, optional, disabled by default, and not live-verified.
- [x] Mobile is described as a client of a paired execution environment.
- [x] No hosted app or signed download is implied.
- [x] Trademark and non-affiliation disclosures cover all named third-party brands.
- [x] No screenshot contains private or secret information.
- [x] Required contact, legal, privacy, security, documentation, and source links work.
- [x] Page remains useful without JavaScript.
- [x] Page reflows at 375 px and 200% zoom without horizontal page scrolling.
- [x] Performance and accessibility budgets are met or any deviation is explicitly approved.
- [x] Marketing build, verifier, `vp check`, and `vp run typecheck` pass.
- [ ] Codex reports no issues on the current head and all review threads are resolved.
- [ ] Deployment occurs only after explicit owner approval.

## Rollback and preservation

- Keep the current uncommitted concept available in local Git history or a non-destructive patch before
  replacing large sections.
- Do not reset, clean, or discard unrelated user changes.
- A failed redesign iteration rolls back through ordinary commits, never destructive history rewriting.
- Screenshot source material remains outside the public site until sanitization is complete.

## Definition of done

The work is done when the acceptance criteria pass, the review-clean commit is merged, the owner has
explicitly approved deployment, and the custom domain serves the verified build. Legal sign-off remains
a separately tracked publication dependency and must not be silently marked complete by this process.
