# Brand assets

Not Codex uses its own terminal-grid mark and wordmark. The repository does not use or ship the T3
Code logo. Text references to T3 Code are historical attribution and non-affiliation disclosures,
not product branding.

## Sources of truth

- `assets/prod/not-codex-original-lockup.png` — original full lockup.
- `assets/prod/not-codex-original-mark.png` — original standalone mark.
- `assets/prod/black-*.png` and `assets/prod/notcodex-black-*` — production platform icons.
- `assets/nightly/` — nightly channel icons.
- `assets/dev/` — development channel icons.
- `scripts/lib/brand-assets.ts` — typed build-time inventory for desktop, web, and integrity checks.

Platform tools require several physical copies or derived formats. The asset-integrity test verifies
that the first-party launcher, desktop, web, marketing, and in-app mobile marks remain the approved
Not Codex artwork even when they live in different platform bundles.

## Usage rules

- Product UI uses the production mark. Development and nightly variants identify launcher/build
  channels; they must not leak into the in-app identity.
- Build and publication scripts should reference `BRAND_ASSET_PATHS` instead of adding new path
  literals when the consuming runtime permits it.
- React Native image `require` calls must remain static literals. The mobile `BrandMark` therefore
  points directly at the production Icon Composer asset, and the integrity test guards that exception.
- Do not redraw, substitute, or recolor the mark without updating all platform outputs and visual
  acceptance evidence together.

## Third-party provider artwork

Files under `apps/marketing/public/harnesses/` represent supported third-party agent providers. They
are not Not Codex brand assets and do not imply affiliation, sponsorship, or endorsement. Their
ownership, permitted use, attribution, and non-affiliation wording remain part of the legal review in
[GitHub issue #43](https://github.com/MaTriXy/not-codex/issues/43).
