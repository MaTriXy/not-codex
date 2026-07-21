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
- Static-site metadata, sitemap, robots policy, security headers, documentation link checks, immutable
  GitHub Action revisions, and dependency update configuration.

## Owner actions before publication

1. Have an Israeli-qualified lawyer review the privacy policy, terms, trademark policy, and operator
   disclosure. Do not treat repository text as legal advice.
2. Configure `notcodex.bpro.dev` in the chosen static host, add the host-provided DNS record, verify TLS,
   and smoke-test every route. Do not add DNS for the reserved app or Connect names yet.
3. Configure a real mail provider for the `notcodex.bpro.dev` subdomain. Create the four addresses above
   as distinct aliases or mailboxes with monitored destinations; do not rely on an unmonitored catch-all.
4. Publish the provider's MX, SPF, and DKIM records. Start DMARC in monitoring mode, review reports, then
   tighten the policy when legitimate delivery is confirmed. Keep exactly one SPF record for the name.
5. Send and receive a test message for every role address. Test the security address from outside the
   provider and document who is responsible for responding.
6. Resolve GitHub Actions billing/spend restrictions, run all required checks on the publication commit,
   enable private vulnerability reporting, and configure branch protection/rulesets available to the
   repository plan.
7. Confirm no secrets exist in the current tree or Git history, then change repository visibility only
   after the owner approves the final diff and launch checklist.

## Separate future gates

Do not advertise or activate npm packages, signed desktop/mobile binaries, automatic updates, a hosted
web app, or Connect merely because their source is present. Each needs signing/provenance, rollback,
cross-platform smoke testing, production monitoring, service-specific privacy/terms updates, and an
explicit launch decision.
