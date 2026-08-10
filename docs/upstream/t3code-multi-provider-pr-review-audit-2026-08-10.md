# T3 Code multi-provider pull-request review audit — 2026-08-10

## Decision

Accept upstream commit `cad2c93616a7c25110670c151a816d5c68341bd4`
(`feat: multi-provider pull requests page with in-app reviews (#4849)`) as a
**staged Not Codex semantic port**.

Do not cherry-pick the commit or merge its tree wholesale. The commit changes
143 files with 34,121 additions and 443 deletions. Of those changes, 21,864
added lines and 433 deleted lines are production code, while 12,257 additions
and 10 deletions are tests. It spans 54 server files, 73 web files, eight
contract files, six client-runtime files, and two other files.

The product is worth bringing into Not Codex: it adds GitHub, GitLab,
Bitbucket, and Azure DevOps pull-request lists, details, activity, checks,
diffs, comments, reviews, reviewer management, merge/state actions, links from
chat, and pull-request-to-agent handoff. Its tests and failure handling are a
strong reference implementation. The port must preserve Not Codex's existing
multi-environment architecture, authorization scopes, provider discovery,
Sidebar v2, branding, storage namespace, and reliability guarantees.

This is a pre-port audit. The findings below are requirements for code that is
not currently shipped by Not Codex; they are not claims of exploitable defects
in the current product.

## Upstream controls to retain

- The service resolves the authoritative project and repository on the server,
  then rejects a client-supplied repository that does not match it
  (`apps/server/src/pullRequest/PullRequestService.ts:419-455`). This prevents a
  paired client from turning a project-scoped operation into an arbitrary
  repository operation.
- Every external write asks the source-control host for the viewer's current
  permissions instead of trusting stale UI state
  (`apps/server/src/pullRequest/PullRequestService.ts:440-455`).
- Provider commands use argument arrays; comment bodies and private GraphQL
  variables travel over standard input rather than shell interpolation.
- Diff and subprocess output, pagination, cache capacities, and refresh windows
  are bounded. Idle browser tabs stop polling.
- Bitbucket redirects are constrained to trusted origins before credentials are
  forwarded, and response bodies are bounded.
- Pull-request markdown reuses the sanitized markdown pipeline: raw HTML is
  parsed and then passed through `rehype-sanitize`
  (`apps/web/src/components/ChatMarkdown.tsx:149-183`). Attachment URLs accept
  only HTTP(S), and external anchors use `noopener`/`noreferrer`
  (`apps/web/src/components/pullRequest/PullRequestMarkdown.tsx:38-53`).
- In-app pull-request URL routing validates HTTP(S), host, repository, and a
  checked-out project; doubtful links stay ordinary external links
  (`apps/web/src/lib/openPullRequestLink.ts:82-126`).
- Merge and close actions require user confirmation.

## Required adaptations

### NC-PR-AUTHZ-001 — use Not Codex's review scope for review writes

- **Severity:** High port blocker
- **Location:** upstream
  `apps/server/src/auth/RpcAuthorization.ts:55-71`; current Not Codex
  `packages/contracts/src/auth.ts:76-103`
- **Evidence:** upstream assigns comments, submitted reviews, thread replies,
  thread resolution, and reviewer requests to `orchestration:operate`. Not
  Codex already defines the narrower `review:write` scope.
- **Impact:** copying the authorization table would let a client granted broad
  orchestration operation—but intentionally denied review writing—publish
  content and change review state on external hosts.
- **Fix:** map list, stats, detail, activity, diff reads, and invalidate to
  `orchestration:read`; map comments, review submission, replies, resolution,
  reviewer requests, and reviewer-candidate enumeration to `review:write`; map
  merge, close/reopen, draft, and ready actions to `orchestration:operate`.
- **Mitigation:** continue the upstream fresh viewer-permission check for every
  mutation. UI gating remains convenience only; the server check is required.
- **False-positive note:** standard Not Codex clients normally receive both
  scopes, but custom and least-privilege grants do not have to.

### NC-PR-LOAD-001 — add a global provider work budget

- **Severity:** High port blocker
- **Location:** upstream
  `apps/server/src/pullRequest/PullRequestService.ts:51-110`
- **Evidence:** one list request may run 12 repository operations concurrently
  and group 100 repositories per host search. Short caches deduplicate identical
  reads, but different filters, cursors, queries, or project scopes produce
  different keys.
- **Impact:** an authorized buggy or hostile client can create many concurrent
  CLI processes and consume source-control API rate limits, degrading the
  environment for every user.
- **Fix:** introduce a server-wide bounded scheduler keyed by environment,
  provider, and host. Give mutations priority, cap running work and queue
  length, reject excess work with a retryable structured error, and cap the
  repositories/projects one request may fan out across.
- **Mitigation:** retain cache sharing, stale-while-revalidate, idle-aware
  refresh, subprocess timeouts, and output limits.
- **False-positive note:** the upstream per-request concurrency measurement is
  valid for one user; it does not bound concurrency across simultaneous
  requests.

### NC-PR-INPUT-001 — bound review batches and identifiers

- **Severity:** High port blocker
- **Location:** upstream
  `packages/contracts/src/pullRequest.ts:613-645`
- **Evidence:** each review body and line-comment body is bounded to 65,536
  characters, but `comments` is an unbounded array. Several repository, path,
  thread, and cursor strings are non-empty without a practical maximum.
- **Impact:** a single authorized request can consume excessive memory and
  provider calls, or publish an unexpectedly large partial review.
- **Fix:** cap one review at 100 line comments and 1 MiB aggregate UTF-8 body
  bytes. Add practical length/count bounds to repositories, hosts, paths,
  thread/comment identifiers, cursors, and cursor-record entries. Recheck the
  aggregate bound server-side after schema decoding.
- **Mitigation:** keep transport, subprocess, diff, pagination, and response
  limits independent of these request limits.
- **False-positive note:** an outer WebSocket frame limit may reject very large
  payloads, but it is not a product-level review or provider-call bound.

### NC-PR-MUTATION-001 — surface non-atomic provider review results

- **Severity:** High reliability blocker
- **Location:** upstream
  `apps/server/src/pullRequest/GitLabPullRequestCli.ts:1077-1129` and
  `apps/server/src/pullRequest/BitbucketPullRequestApi.ts:716-753`
- **Evidence:** GitLab and Bitbucket post each inline comment, then a summary,
  then the verdict. The code deliberately puts the verdict last, but a failure
  still leaves earlier comments visible. The generic error does not describe
  which phase completed.
- **Impact:** a retry can duplicate externally visible comments, and the user
  cannot tell what the host accepted. GitHub's review submission is atomic, so
  behavior otherwise differs silently by provider.
- **Fix:** return a structured partial-completion error containing provider,
  completed phase, posted comment count, summary status, and verdict status.
  Show a durable warning and refresh the activity before permitting an explicit
  retry. Never automatically retry a review mutation.
- **Mitigation:** retain verdict-last ordering. A short-lived client mutation ID
  can suppress duplicate delivery inside one server process, but must not be
  presented as host-level idempotency.
- **False-positive note:** this is acknowledged by upstream comments; the gap is
  user-visible recovery, not ignorance of provider semantics.

### NC-PR-DRAFT-001 — persist environment-scoped review drafts safely

- **Severity:** Medium reliability/privacy requirement
- **Location:** upstream
  `apps/web/src/components/pullRequest/pullRequestReviewStore.ts:1-99`
- **Evidence:** drafts intentionally live only for the tab lifetime, and their
  key is `projectId/repository#number` without `environmentId`.
- **Impact:** a renderer reload loses unsent review work. Identical project IDs
  or repository references across connected environments can collide when the
  store becomes shared with Not Codex's multi-environment UI.
- **Fix:** key drafts by environment, project, host, repository, and pull-request
  number. Persist a schema-validated, size-bounded draft with an age limit.
  Clear only the exact submitted snapshot, preserve edits made while the
  mutation is in flight, and expose an explicit discard action.
- **Mitigation:** never persist credentials or host responses in the draft.
- **False-positive note:** upstream's single-primary-environment route makes the
  collision less visible there; Not Codex supports several environments.

### NC-PR-STORAGE-001 — expire private pull-request list snapshots

- **Severity:** Medium privacy requirement
- **Location:** upstream
  `apps/web/src/components/pullRequest/pullRequestList.logic.ts:203-297`
- **Evidence:** up to 99 feed rows plus authored and reviewing partitions are
  stored in `localStorage`, keyed by environment, with schema validation but no
  timestamp, expiration, or removal hook. Rows can contain private repository,
  title, author, and review metadata.
- **Impact:** project metadata can remain on a shared browser profile after an
  environment is disconnected or a user stops using it.
- **Fix:** use the Not Codex storage namespace, include `writtenAt`, enforce a
  short TTL, and remove snapshots when an environment is unpaired, removed, or
  signed out. Prefer session storage if warm state across full browser restarts
  is not a firm requirement.
- **Mitigation:** continue schema validation and row caps, and never persist
  errors, cursors, credentials, bodies, diffs, or comments.
- **False-positive note:** Web Storage is not a secret store; this finding is
  bounded retention of private metadata, not token exposure.

### NC-PR-PROVIDER-001 — extend the existing provider architecture

- **Severity:** Medium maintainability/correctness requirement
- **Location:** upstream
  `apps/server/src/pullRequest/PullRequestProviderRegistry.ts`; current Not Codex
  `apps/server/src/sourceControl/SourceControlProviderRegistry.ts:42-62,196-282`
- **Evidence:** upstream introduces a second provider registry, while Not Codex
  already resolves provider kind, remote context, CLI availability, and
  credentials through `SourceControlProviderRegistry` and its provider handles.
- **Impact:** parallel discovery and credential paths can disagree about the
  selected remote, supported provider, host, or sanitized error behavior.
- **Fix:** compose a focused pull-request/review capability adapter from the
  existing provider handle and discovery layers. Share CLI execution, remote
  identity, credentials, and error redaction. Do not duplicate provider login
  or remote-selection logic.
- **Mitigation:** provider-specific JSON decoders and review operations may stay
  in focused modules behind that shared adapter.
- **False-positive note:** a separate capability interface is useful; a second
  independent discovery/credential registry is the part to avoid.

### NC-PR-WEB-001 — adapt the shell to Sidebar v2 and multi-environment state

- **Severity:** Medium product-integration requirement
- **Location:** upstream `apps/web/src/components/LegacySidebar.tsx`,
  `apps/web/src/components/Sidebar.tsx`, and
  `apps/web/src/routes/_chat.pull-requests.tsx`; current Not Codex
  `apps/web/src/components/AppSidebarLayout.tsx:86-97` and
  `apps/web/src/components/SidebarV2.tsx:1304-1334`
- **Evidence:** upstream wires the feature into its legacy/current sidebar and a
  primary-environment route. Not Codex defaults to Sidebar v2 and retains
  Automations, Usage, Monkey.D.Loopy/LoopAny, Open Kritt Security, and explicit
  environment scoping.
- **Impact:** a direct port would hide or bypass current Not Codex navigation,
  route state, environment identity, and right-panel isolation.
- **Fix:** add a Sidebar v2 destination and environment-aware route. Key list,
  detail, draft, query, panel, and pull-request-to-thread state by environment.
  Use Not Codex labels, storage keys, theme roles, and `ScopedThreadRef`-style
  isolation while preserving the existing product destinations.
- **Mitigation:** keep the upstream environment capability flag so older
  servers remain inert rather than receiving unsupported calls.
- **False-positive note:** upstream's primary-environment model is internally
  consistent; the mismatch is with Not Codex's product architecture.

### NC-PR-URL-001 — define a remote-image policy for PR markdown

- **Severity:** Low hardening requirement
- **Location:** upstream
  `apps/web/src/components/pullRequest/PullRequestMarkdown.tsx:8-53` and
  `apps/web/src/components/ChatMarkdown.tsx:149-183`
- **Evidence:** markdown is sanitized and active schemes are rejected, but
  image URLs in host-provided markdown can still cause a public web client to
  contact a remote origin. The desktop CSP blocks remote media more strongly.
- **Impact:** a pull-request author can use a remote image as a tracking pixel
  for browser readers. This does not expose Not Codex credentials, but it leaks
  a request, IP address, user-agent, and timing to the image host.
- **Fix:** decide and document one consistent policy: block remote images until
  clicked, proxy them through a privacy-preserving bounded fetcher, or allow
  only known source-control/attachment hosts. Apply it to PR markdown before
  launch on the public web app.
- **Mitigation:** lazy-load remote images, set a restrictive referrer policy,
  and retain URL scheme validation and markdown sanitization.
- **False-positive note:** this risk already exists anywhere untrusted markdown
  permits remote images; the PR product substantially broadens that content.

## Implementation batches

### PR 1 — read-only contracts and server foundation

- Add bounded pull-request contracts and the environment capability.
- Reuse current source-control provider discovery, CLI execution, credentials,
  remote identity, and transport-safe error handling.
- Port provider decoders and read-only list/detail/activity/diff services.
- Add the global host/provider work scheduler before enabling list fan-out.
- Port focused contract, provider, cache, repository-binding, and authorization
  tests.

### PR 2 — read-only web product

- Add the Sidebar v2 destination, multi-environment list route, filters,
  pagination, details, checks, timeline, diff expansion, and shared styled diff
  renderer.
- Add environment-scoped right-panel surfaces and safe PR-link routing.
- Add the expiring Not Codex list snapshot and the remote-image policy.
- Preserve Automations, Usage, Loopy/LoopAny, Open Kritt Security, contextual
  project settings, theming, responsive behavior, and older-server capability
  fallback.

### PR 3 — comments, reviews, and host mutations

- Add the authorization split from `NC-PR-AUTHZ-001`.
- Port fresh viewer permissions, action confirmations, comments, review
  submission, replies, resolution, reviewer management, merge/state actions,
  and all provider tests.
- Enforce review count/aggregate limits and structured partial-completion
  recovery before enabling GitLab or Bitbucket review submission.
- Add environment-scoped persisted drafts that preserve in-flight edits.

### PR 4 — pull-request-to-agent workflow and polish

- Connect pull requests to the existing thread/worktree materialization flow.
- Add chat deep links and PR surfaces without duplicating thread state.
- Complete accessibility, responsive/mobile-web, reconnect, stale-data, and
  failure-state coverage. Native mobile UI remains a separate product decision.

## Completion gates

Each PR must run focused tests for every affected provider and failure mode.
`vp check` and `vp run typecheck` must pass before any batch is complete. A
future batch changing native mobile code must also pass `vp run lint:mobile`.
No external write should launch until the authorization, batch-limit,
fresh-permission, partial-completion, and no-automatic-retry tests pass.
