# Open Kritt integration: legal and deployment review

This document records engineering assumptions for review; it is not a legal opinion.

## Boundary and licensing

Not Codex and its connector remain under the repository's MIT license. Open Kritt is a separately
installed AGPL-3.0 service accessed through its documented HTTP API. The connector does not vendor,
link, patch, or silently redistribute Open Kritt source. The product, documentation, and notices
identify the official source and license and state that Not Codex has no affiliation, sponsorship,
or endorsement relationship with Kritt or Open Kritt contributors.

Any future maintained Open Kritt fork or modified deployment must be clearly identified and comply
with the applicable AGPL corresponding-source and notice obligations. A future installer must keep
the service as a separate runtime and preserve upstream notices; it is explicitly outside the
connector implementation.

## Operational and privacy review

Open Kritt's documented installation can involve Docker-host control, root disposable scan jobs,
outbound internet, and model-provider data egress. Operators should use a dedicated host or an
equivalent isolated boundary, restrict network exposure, and configure authentication (for example,
an authenticated reverse proxy) before enabling the connector. An unauthenticated public endpoint
is not supported or made safe by Not Codex.

The Not Codex server is the only network client. Browser and mobile code receives typed, bounded
RPC results and never receives the bearer token or calls the upstream URL. Not Codex credentials
are not forwarded to Open Kritt. Remote scans send only a normalized repository identity and full
commit SHA. Local snapshots are opt-in, copied atomically under an operator-selected root, and
require a source-content/model-egress confirmation.

## Supported-version policy

The current claim is limited to Open Kritt v1.2.0 at commit
`dabd3d5f82e759bf783955ecc245fea3a984cd38`. Compatibility fixtures, protocol bounds, and opt-in
live acceptance must be run before supporting another release. No automatic upgrade or guided
runtime manager is part of this connector.

That claim is **partially live-verified** for the protocol: the request and response shapes were
captured from a running Open Kritt v1.2.0 deployment at the pinned revision and cross-read against
that revision's source, but coverage is partial. It is **not** a claim that a model-backed
vulnerability scan was executed — no provider credential was configured and the engine service was
not running, so the running/post_processing/completed lifecycle and the real vulnerability payload
shape were not observed. Release messaging may
state that the connector is protocol-tested against v1.2.0; it must not state or imply that Not
Codex has run or validated an end-to-end Open Kritt security analysis.

Reviewers should confirm the service boundary, AGPL notice language, deployment privilege warning,
model-provider egress disclosure, secret handling, local-snapshot policy, and removal instructions
before release.
