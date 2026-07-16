# Contributing

## Read This First

Contributions are welcome. Not Codex is still early, so we keep scope, quality, and direction under
careful review. Opening a pull request does not guarantee that it will be merged, but focused fixes and
well-scoped improvements are encouraged.

PRs are automatically labeled with a `vouch:*` trust status and a `size:*` diff size based on changed lines.

If you are an external contributor, expect `vouch:unvouched` until we explicitly add you to [.github/VOUCHED.td](.github/VOUCHED.td).

Participation is governed by [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). Report
vulnerabilities through [SECURITY.md](./SECURITY.md), never in a public issue.

## What We Are Most Likely To Accept

Small, focused bug fixes.

Small reliability fixes.

Small performance improvements.

Tightly scoped maintenance work that clearly improves the project without changing its direction.

## What We Are Least Likely To Accept

Large PRs.

Drive-by feature work.

Opinionated rewrites.

Anything that expands product scope without us asking for it first.

Large feature pull requests may be closed or redirected unless they were discussed with the
maintainers first.

## Opening a Pull Request

Keep it small.

Explain exactly what changed.

Explain exactly why the change should exist.

Do not mix unrelated fixes together.

If the PR makes anything resembling a UI change, include clear before/after images.

If the change depends on motion, timing, transitions, or interaction details, include a short video.

If we have to guess what changed, we are much less likely to review it.

## Development Setup

Not Codex requires Node.js 24 and uses Vite+ with the pnpm version pinned in
`package.json`.

```bash
curl -fsSL https://vite.plus | bash
vp install
vp run dev
```

Before opening a pull request, run:

```bash
vp check
vp run typecheck
vp run test
```

If native mobile code changed, also run `vp run lint:mobile`. Keep provider-neutral
runtime code free of Codex-, Claude-, Cursor-, or OpenCode-native event shapes; provider
translation belongs in the relevant adapter.

## Issues First

If you are thinking about a non-trivial change, open an issue first.

That still does not mean we will want the PR, but it gives you a chance to avoid wasting your time.

## Be Realistic

Opening a PR does not create an obligation on our side.

We may close it. We may ignore it. We may ask you to shrink it. We may reimplement the idea ourselves later.

If you are fine with that, proceed.

## Contribution License

By submitting a contribution to this repository, you represent that you have the right to submit it
and agree to license it under the MIT License that applies to this repository. You retain copyright in
your contribution; submitting a pull request does not assign that copyright to MaTrixy or Not Codex.

You also understand that accepted contributions may be used, copied, modified, published,
distributed, sublicensed, or sold under the MIT License without compensation to you.

Do not submit third-party code, media, logos, or other materials unless their license permits inclusion
and you include all required attribution. Do not submit new logos or changes to the Not Codex brand
assets unless requested by a maintainer; brand contributions may require separate written terms. See
[NOTICE.md](./NOTICE.md) and [TRADEMARKS.md](./TRADEMARKS.md).
