# Open Kritt

Open Kritt support is an optional server-side connector for launching security scans, observing
durable scan runs, reviewing normalized findings, and opening a normal Not Codex remediation
thread. Open Kritt remains a separately installed and separately licensed service. Not Codex does
not vendor, link, patch, or silently redistribute Open Kritt.

## Compatibility baseline

The connector claims compatibility only with Open Kritt **v1.2.0**, reviewed at commit
[`dabd3d5f82e759bf783955ecc245fea3a984cd38`](https://github.com/Kritt-ai/open-kritt/commit/dabd3d5f82e759bf783955ecc245fea3a984cd38).
The reviewed protocol manifest and live-captured fixtures are checked in at
[`open-kritt-v1.2.0.json`](../../apps/server/src/integrations/fixtures/open-kritt-v1.2.0.json).
The official source, release, API, installation, and threat-model references are:

- [Open Kritt source](https://github.com/Kritt-ai/open-kritt)
- [v1.2.0 release](https://github.com/Kritt-ai/open-kritt/releases/tag/v1.2.0)
- [installation and setup](https://docs.kritt.ai/getting-started/installation-and-setup)
- [create a scan API](https://docs.kritt.ai/scans/create)
- [threat model](https://github.com/Kritt-ai/open-kritt/blob/main/docs/threat-model.md)
- [AGPL-3.0 license](https://github.com/Kritt-ai/open-kritt/blob/main/LICENSE)

The connector does not infer compatibility with later releases. A maintainer must review the
upstream revision, update the manifest and fixtures, and run focused and opt-in live acceptance
before changing the advertised baseline.

### Verification status: partially live-verified against the pinned revision

The request and response shapes this connector encodes and decodes were captured from a running
Open Kritt v1.2.0 deployment at `dabd3d5f82e759bf783955ecc245fea3a984cd38` and cross-read against
that revision's `backend/src` route, validation, and serialization code. Coverage is partial: the
engine service was never running, so the `running`, `post_processing`, and `completed` lifecycle
states and the real vulnerability payload shape were not observed. The compatibility manifest
therefore records `verification: "partially-live-verified"`, and the captures (with long prompt and ruleset bodies
truncated) are checked in at
[`open-kritt-v1.2.0.json`](../../apps/server/src/integrations/fixtures/open-kritt-v1.2.0.json).

What the acceptance run covered:

- `GET /api/health` — service identity is `open-kritt-backend`, not `open-kritt`.
- The six catalog endpoints. Five return bare JSON arrays; `GET /api/model-providers` returns
  `{ "providers": [id] }` and per-provider models come from `GET /api/model-catalog`.
- `POST /api/scans` `201`, `409 scan_launch_policy_required`, and `422`. The selection
  (`workflowId`, `postScriptId`, `model`, `model_provider`, `harness`, `thinking_effort`,
  `severity_ranker`, `job_limit`, repo fields) is read from the request **root**, not from
  `configuration`, and the severity ranker is submitted as its combined Markdown **body**, not an
  id. The `409` carries `code` and `errors[]` but does not enumerate the policy options, so the
  connector offers the documented `immediate` / `queue` set.
- `GET /api/scans` — a bare array without pagination parameters, an
  `{ items, page, pageSize, totalItems, totalPages, … }` envelope with them (`pageSize`, not
  `page_size`).
- `GET /api/scans/:id`, `PATCH /api/scans/:id`, `GET /api/scans/:id/vulnerabilities` (a bare
  array, `includeDuplicates=1` to include duplicates), `GET /api/vulnerabilities/:id`, and
  `PATCH /api/vulnerabilities/:id`.
- Scan responses are camelCase (`repoFull`, `commitSha`, `modelProvider`, `thinkingEffort`,
  `updatedAt`), `progress` is a display string such as `"42%"`, and there is no `phase` field —
  `progressLabel` is the human-readable stage.
- A finding is model-authored output: `severity` comes from post-script enrichment and may be any
  string or absent, `exploitable` is a boolean, `interesting` is `1`/`0`/`null`, `rank` may be
  null, and nearly every content field is nullable. The connector normalizes these rather than
  trusting them; an unrecognized severity becomes `unknown` instead of being invented.
- A `PATCH /api/scans/:id` transition outside the upstream `USER_STATUS_TRANSITIONS` table answers
  **500**, not `409`, so the connector refuses unauthorized transitions before sending them.

**What the run did not cover: no model-backed vulnerability scan was executed.** No provider
credential was configured and the engine service was not running, so the run exercised the API
contract, the launch/idempotency path, and lifecycle transitions — not a real analysis. The finding
serialization was captured from a seeded acceptance record written directly to the disposable
acceptance database. Nothing here claims Open Kritt found a real vulnerability under Not Codex.
Before advertising a later Open Kritt release, re-capture the fixtures and rerun this exercise.

This gap is recorded as machine-checkable state rather than prose alone:
`OPEN_KRITT_PROTOCOL_COMPATIBILITY.modelBackedScanVerified` and the fixture's
`metadata.modelBackedScanVerified` are both `false`, and
`assertOpenKrittCompatibilityFixture` fails closed if the two disagree. Flipping it to `true`
requires an opt-in live run against a disposable repository containing one known vulnerability
and no real secrets, with the real `GET /api/scans/:id/vulnerabilities` and
`GET /api/vulnerabilities/:id` bodies captured into the fixture. That run consumes model-provider
quota and requires an operator-supplied provider credential, so it cannot be performed as part of
ordinary development.

#### The request marker round trip is observed

The reserved `configuration.not_codex.request_id` marker is the only defense against a timed-out
`POST /api/scans` becoming a second paid scan, because upstream documents no idempotency key. The
round trip was observed directly: `POST /api/scans` stores the submitted `configuration` object
verbatim (it spreads it and only adds `post_script_ids` / `agent_skill_ids`), and both the `201`
response and `GET /api/scans?page=1&pageSize=100` return the marker unchanged. The manifest records
`markerRoundTripVerified: true`, which is what permits the one flow that reuses a request id:
answering a `409 scan_launch_policy_required`. That retry reuses the original marker so upstream
reconciles it to one scan. An uncertain launch still stays `waiting` with
`launchResolution: unknown` and is only ever resolved by bounded, read-only marker reconciliation,
never by a blind retry. If a future baseline is ever recorded as unverified, the guard in
`openKrittRequestIdReuseRefusal` refuses the reuse again.

#### Acceptance run record

- Deployment: Open Kritt v1.2.0 at `dabd3d5f82e759bf783955ecc245fea3a984cd38`, run from the
  upstream Compose project on a disposable local host, bound to loopback only.
- Provider credential: none configured (a deliberately fake placeholder key). The engine service
  was not running, so no scan consumed provider quota and no analysis was performed.
- Exercised: `GET /api/health`, all six catalog endpoints, `POST /api/scans` (`201` with the exact
  body this connector builds, `409 scan_launch_policy_required`, `422`), `GET /api/scans` both
  paginated and unpaginated, `GET /api/scans/:id`, `PATCH /api/scans/:id` (authorized and
  unauthorized transitions), `GET /api/scans/:id/vulnerabilities`,
  `GET /api/vulnerabilities/:id`, and `PATCH /api/vulnerabilities/:id`.
- Marker round trip: confirmed on multiple scans via both the `201` body and
  `GET /api/scans?page=1&pageSize=100`.
- Finding serialization: captured from an acceptance record seeded directly into the disposable
  acceptance database, because no analysis run was performed. This is called out in the fixture
  metadata; do not read it as a real Open Kritt result.
- No Not Codex source checkout was written by the run, and every scan created during it was left
  in a terminal `stopped` state.

## Configure safely

Open **Settings → Integrations → Open Kritt** on the web or desktop. The integration is disabled
by default. Configure the server URL, optionally configure a reverse-proxy bearer token, test the
connection, and then enable the connector. The token is write-only: it is stored in the server
secret store under a dedicated name and the client receives only `tokenConfigured`. It is never
placed in ordinary settings, descriptors, diagnostics, logs, traces, or error messages.

Only loopback may use plain HTTP. A non-loopback endpoint must use HTTPS and requires an explicit
warning acknowledgement. The endpoint must be private and protected by operator network policy
and authentication; Open Kritt's documented unauthenticated default is not suitable for a public
network. The connector rejects URL credentials, query strings, fragments, unsafe schemes, and
cross-origin or scheme-changing redirects. A same-origin, credential-free redirect (such as a
reverse proxy adding a trailing slash) is followed exactly once **and only for a `GET`**; a second
hop is reported as an unsafe redirect rather than chased. A redirect answering a `POST`, `PATCH`
or `DELETE` is always refused, never replayed: re-sending `POST /api/scans` at a redirect target
could create a second, separately billed scan that no reconciliation would catch, because the
original call neither failed nor timed out. A reverse-proxy base path such as
`https://ops.example/kritt` is supported, because the recommended way to authenticate an upstream
that ships unauthenticated is an operator-run proxy and those commonly terminate at a subpath. The
prefix is validated strictly — bounded literal segments only, no traversal and no percent-encoded
separators — it is re-applied to every request path, and any redirect that leaves it (for example
`/kritt/api/...` to `/admin`) is refused. After the host resolves, only the approved addresses are used for
the connection, so a DNS answer that changes between validation and connect cannot redirect the
request to a loopback or metadata address. Both IPv4 and IPv6 answers are classified: global
unicast is allowed, while loopback (outside an explicit loopback endpoint), unique-local,
link-local, multicast, documentation, benchmarking, reserved and IPv4-mapped private/metadata
ranges are refused. Because Open Kritt is recommended on a dedicated private host, a private
address becomes reachable only when the operator adds it to the bounded **Allowed private
addresses** setting (at most eight literal IPv4/IPv6 addresses or CIDR ranges, alongside the same
non-loopback acknowledgement). That allowlist covers private unicast ranges only — link-local
(including the cloud metadata address `169.254.169.254`), multicast, `0.0.0.0/8` and the other
reserved blocks stay refused no matter what is listed. With an empty allowlist only loopback
endpoints are reachable, and all of `127.0.0.0/8` counts as loopback. A
dual-stack host whose answers are partly unusable still connects over its approved addresses; the
request fails only when no resolved address is approved. It exposes explicit health, catalog, scan, run, finding,
remediation, rescan, and comparison operations rather than a general upstream proxy. Observation
operations (runs, findings, finding detail, scan comparison) need `orchestration:read`; everything that
produces an outbound Open Kritt request — including the connection test and catalog refresh — requires
`orchestration:operate`, so a read-only session cannot cause egress to the operator's instance.

Open Kritt is recommended on a dedicated host or isolated service boundary. Its documented
deployment may give the engine Docker-host privileges, run disposable scan jobs as root, and allow
outbound network access. Review the deployment and operator network policy before enabling it.
Open Kritt's configured model provider may receive repository source and finding context; this is
separate from Not Codex provider credentials, which are never sent to Open Kritt.

## Sources and snapshots

Remote scans require a canonical repository identity and a full immutable commit SHA. Branches,
moving refs, abbreviated SHAs, credentials, query strings, fragments, unsupported remote forms,
and project/repository mismatches are rejected. Dirty or unpushed local changes are disclosed as
excluded from a remote scan. Not Codex never forwards its GitHub or provider credentials.

Local snapshots are opt-in and require an operator-configured `snapshotRoot`; the client cannot
choose an arbitrary server destination. Not Codex copies a reviewed source tree into a new opaque
folder using temporary storage and an atomic rename, calculates bounded manifest metadata, and
sends only the immediate folder name as `repo_full`. The live workspace is never mounted writable.
`.git`, Not Codex state, dependency/build caches, credential files (every `.env*` variant,
`.git-credentials`, `.netrc`, `.pgpass`, SSH/GPG/keystore material, and `.ssh`/`.aws`/`.gnupg`/
`.kube`/`.docker` directories), symlinks, sockets and devices are excluded from the snapshot and
reported individually in the confirmation preview. Path escapes, excessive files/bytes, and partial
copies fail closed. Reviewed files are copied through an `O_NOFOLLOW` descriptor, so a file swapped
for a symlink during publication fails closed instead of pulling in a file from outside the
workspace. Before creation, users must confirm that included source contents are safe to send to the
configured Open Kritt model provider. That confirmation is bound to the reviewed content: the client
returns the previewed manifest digest, the copy pass recomputes the digest from the bytes it
actually stages, and a mismatch is rejected before publication, so the bytes sent to the provider are
exactly the bytes the user approved. Snapshots have bounded retention and may be
retained only through an explicit debugging setting.

## Runs, findings, and remediation

The server persists a launch intent before calling `POST /api/scans`, uses a stable opaque request
marker, and stores only bounded correlation, source, configuration-summary, lifecycle, and
normalized finding data. It does not persist arbitrary upstream JSON, prompts, logs, or enrichment
blobs. A timed-out or interrupted create request is reconciled by a bounded marker search across up to
five scan pages of 100 before any retry; if ownership cannot be proven, the run remains queued/waiting with an unknown launch
resolution and requires inspection rather than risking a duplicate paid scan.

Polling is server-owned and coalesced by environment and external scan identity. Client reconnects
do not launch scans or create pollers. Consecutive ticks that fail for transport or protocol reasons
widen the poll delay exponentially up to five minutes, and any successful observation resets it, so an
unreachable Open Kritt is not polled at the flat configured interval. An upstream 404 is treated as a
missing scan, not a transport failure, and does not trigger backoff. Upstream lifecycle is mapped to durable Not Codex states
while preserving upstream status and phase. Connection loss retains the last authoritative state
and marks it stale; restart reconciliation observes persisted non-terminal scans. Unauthorized,
missing, malformed, oversized, and rate-limited responses are surfaced as safe typed guidance
without exposing response bodies.

Two upstream responses are questions rather than failures, and both are answered against the
original launch request so no duplicate paid scan can result:

- **`409 scan_launch_policy_required`** — the scan form presents the exact options Open Kritt
  offered and starts nothing until one is chosen. The elected answer is resubmitted with the same
  request id and marker, so Open Kritt reconciles it to the original launch. The durable run waits
  with a `policy-required` launch resolution until it is answered, and the pending question
  survives a reload.
- **`422`** — each bounded field error is attached to the control that caused it. The run is
  recorded as `rejected`; nothing was started.

### Not implemented

Finding triage (`PATCH /api/vulnerabilities/:id`) and scan deletion (`DELETE /api/scans/:id`) are
not implemented in this release, and the connector does not advertise a triage capability. Triage
state is shown read-only as reported by Open Kritt. Delete a scan in Open Kritt itself; Not Codex
keeps its own bounded run history either way.

Findings are normalized into bounded plain-text/strict-Markdown fields. Upstream HTML, scripts,
file actions, JavaScript URLs, control characters, raw logs, and arbitrary blobs are not rendered
or persisted. Finding text is rendered through a strict allowlisted Markdown subset — paragraphs,
fenced code blocks, bullet and numbered lists, and inline code — with no links, images, or raw
HTML; every segment reaches the DOM as a text node, so an unrecognised construct degrades to
inert text rather than to a new capability. Finding links are built only from the configured
origin and validated identifiers.
The Security view distinguishes canonical and duplicate findings, source identity, lifecycle
freshness, and comparison uncertainty.

“Fix with Not Codex” revalidates the project, repository, and exact scanned revision, then creates
an ordinary governed Not Codex thread/worktree. Open Kritt content is inserted only as delimited
untrusted evidence; embedded instructions are not followed. Approval, provider credentials,
diffs, history, commits, pushes, and merges remain under normal Not Codex controls. Nothing is
automatically committed, pushed, merged, or approved.

A rescan requires a newly confirmed immutable revision or snapshot and is linked to the prior scan as
a child run. It reuses the configuration persisted with the prior launch intent rather than current
settings defaults, so the two scans stay comparable; an explicitly confirmed edited configuration may
be supplied instead, and the configuration actually used is disclosed after launch.

The Security view compares two linked scans by stable normalized fingerprint (type, normalized path
and location, root-bug and dedupe metadata). The comparison reports four distinct outcomes and never
overstates remediation:

- **still present** — a prior fingerprint is reported again.
- **uncertain** — the scan configuration or scope differed, or the prior scan produced no comparable
  findings, so nothing can be concluded.
- **not reproduced** — the finding is absent, but either the source revision did not change (so the
  code cannot have been fixed) or the new scan reported nothing at all.
- **proven fixed** — the only case where absence is treated as evidence: a new immutable revision, an
  identical configuration, and a new scan that still produced findings.

Mobile support is observation-only in the initial scope. The durable Runs list labels Open Kritt
scans and the run detail screen shows the server-owned upstream status, phase, progress, and
finding/duplicate counts alongside the existing stale-snapshot warning. Open Kritt launch,
remediation, triage, and rescan mutations are not exposed on mobile.

## Troubleshooting and removal

- **Disabled or misconfigured:** confirm the URL policy, warning acknowledgement, required token,
  and operator network access; run the connection test from the server.
- **Unauthorized:** reconfigure the reverse-proxy bearer token. Response bodies are intentionally
  discarded.
- **Protocol error:** verify the separately installed service is the pinned v1.2.0 revision; later
  releases are unsupported until compatibility review is complete.
- **Stale run:** keep the server connected and inspect the durable run. Reconnect/restart triggers
  bounded reconciliation; the connector does not guess a terminal outcome.
- **Local snapshot warning:** review excluded and included paths and the model-provider egress
  disclosure before confirming. Do not configure a live project directory as a writable service
  mount.

To remove the integration, stop and remove the separately installed Open Kritt service according to
its official documentation, clear the Not Codex bearer token, disable the connector, remove the
server-side snapshot root and any retained snapshots after verifying no scan needs them, and remove
the server settings. Durable Not Codex run history remains as bounded historical evidence and is
not silently deleted by disconnecting the service.

## Disclosure

Open Kritt is an independent project. Not Codex is not affiliated with, sponsored by, endorsed by,
or maintained by Kritt or the Open Kritt contributors. Open Kritt is licensed under AGPL-3.0 and
remains governed by its own source distribution, notices, and license. This engineering disclosure
is not legal advice; see the [planned legal review](../legal-review/open-kritt.md).
