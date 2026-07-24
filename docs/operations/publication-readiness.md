# Publication readiness

This checklist separates repository changes from owner-controlled launch actions. The source repository
and marketing site are the first public surface. Packaged downloads, npm publication, the hosted app,
and Not Codex Connect remain unavailable until their own acceptance work is complete.

## Implemented in the repository

- Canonical marketing origin: `https://notcodex.bpro.dev`.
- Reserved, inactive product origins: `app.notcodex.bpro.dev`,
  `latest.app.notcodex.bpro.dev`, `nightly.app.notcodex.bpro.dev`, and
  `connect.notcodex.bpro.dev`.
- Role-specific contacts:
  - `security@notcodex.bpro.dev`
  - `privacy@notcodex.bpro.dev`
  - `legal@notcodex.bpro.dev`
  - `support@notcodex.bpro.dev`
- Source-first website copy and build instructions; no fabricated package or download availability.
- Website-only privacy, terms, and security documents for Yossi Elkrief, operating under the MaTrixy
  and BPro names in Israel.
- Static-site metadata, sitemap, robots policy, Cloudflare static-asset security headers, documentation link
  checks, immutable GitHub Action revisions, dependency update configuration, and a full-history
  Gitleaks CI gate with narrowly reviewed synthetic-fixture exceptions.
- The desktop updater resolves `electron-updater` 6.8.9 and patched `builder-util-runtime` 9.7.0;
  the vulnerable 9.5.1 runtime is absent from the lockfile.

## Owner actions before publication

1. [ ] Have an Israeli-qualified lawyer review the privacy policy, terms, trademark policy, and operator
       disclosure. Track approval and counsel-approved changes in
       [GitHub issue #43](https://github.com/MaTriXy/not-codex/issues/43). Do not treat repository text as
       legal advice.
   - [ ] Add counsel-approved third-party brand attribution across the README, notices, trademark
         policy, and website terms. It should cover Claude and Claude Code as Anthropic brands, OpenCode
         as the OpenCode project's brand, and Cursor as the Cursor/cursor.ai brand; state clearly that
         Not Codex has no affiliation with, sponsorship by, or endorsement from any of their owners.
   - [ ] Before publishing that wording, have counsel verify each exact trademark owner and legal
         entity (including whether Cursor should be attributed to Anysphere, Inc.), the preferred product
         names, and whether any trademark symbols or jurisdiction-specific wording are appropriate.
2. [x] Deploy `apps/marketing` as Cloudflare Workers static assets using its checked-in Wrangler
       configuration. Build from the repository root with `pnpm --filter @notcodex/marketing build`, then
       run `npx wrangler deploy --config apps/marketing/wrangler.jsonc`. Verify TLS and headers on
       `notcodex.bpro.dev` and smoke-test every route. Do not add DNS for the reserved app or Connect names
       yet. Workers static assets are used because their Custom Domain can coexist with the Email Routing
       MX and TXT records on the same product hostname; Pages requires a conflicting CNAME.
3. [x] Enable Cloudflare Email Routing for the `notcodex.bpro.dev` subdomain. Create the four addresses
       above as distinct routes to verified, monitored destinations; do not enable a catch-all. Choose a
       real mailbox or SMTP provider that supports sending replies from those addresses because Email
       Routing only handles inbound forwarding.
4. [ ] Operate and harden email authentication.
   - [x] Keep the active Cloudflare Email Routing MX records and single SPF record intact, and publish
         DMARC in monitoring mode. The public records were verified on 2026-07-24.
   - [ ] Retain and review aggregate reports using the
         [email and DMARC runbook](./email-and-dmarc.md), then tighten the policy only after legitimate
         delivery is confirmed.
   - [ ] Before sending replies from the role addresses, configure a real outbound provider and publish
         its aligned SPF and DKIM records. Keep exactly one SPF record for the name.
5. [x] Send and receive a test message for every role address. Test the security address from outside the
       provider and document who is responsible for responding.
6. [ ] When the monthly GitHub Actions usage limit resets, rerun the unchanged required workflows on the
       publication commit, enable private vulnerability reporting, and configure the branch
       protection/rulesets available to the repository plan. Until then, treat the usage cap as an accepted
       external limitation, run the equivalent local gates, and do not weaken or remove CI checks.
7. [x] Confirm no secrets exist in the current tree or Git history. A full-history scan with the
       checksum-verified Gitleaks 8.30.1 binary was completed on 2026-07-24 and found no leaks. The scan
       covered all reachable commits and is rerun on the final merged publication state.
8. [ ] Change repository visibility only after the owner approves the final diff, the remaining launch
       gates above, and this checklist.

## Separate future gates

Do not advertise or activate npm packages, signed desktop/mobile binaries, automatic updates, a hosted
web app, or Connect merely because their source is present. Each needs signing/provenance, rollback,
cross-platform smoke testing, production monitoring, service-specific privacy/terms updates, and an
explicit launch decision.
