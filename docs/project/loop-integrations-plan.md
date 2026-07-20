# Not Codex Loop Integrations Plan

Status: **Foundation, run lifecycle, web/mobile recovery UX, LoopAny diagnostics/configuration, and mobile cross-platform hardening implemented; live acceptance remains**

## TL;DR

Not Codex will become the local execution harness for two complementary integrations:

- **Monkey.D.Loopy** supplies validated, bounded, crash-resumable loop execution.
- **LoopAny** may schedule and deliver work to a local Not Codex machine.

## Review boundary

The branch now contains the secure typed integration foundation, full Monkey D. Loopy v0.5 package
stack, bounded Loopy execution API, LoopAny configuration and connector, shared Not Codex harness,
settings UI, run launch and history UX, typed inspect/cancel/resume/retry operations, state-aware web
controls, mobile integration status, durable run observation, secret-safe LoopAny configuration, and
cross-platform mobile failure/accessibility hardening, tests, and documentation. Integration-specific
notification adapters and a demonstrated production LoopAny server round-trip remain tracked
separately.

- **Not Codex** remains the provider-neutral place that starts agent threads, applies permissions,
  records progress, and presents status to the user.

This work extends the existing Automations and orchestration infrastructure. It does not add another
cron engine, Slack/email adapters, or a second agent runtime. Mobile remains a client of a selected Not
Codex execution environment and never runs the connector or agent harness on the phone.

## Git and delivery rules

- Keep `main` unchanged while this feature is reviewed.
- Work only on the normal descendant branch `codex/loop-integrations`.
- Preserve every milestone as an ordinary commit. Do not amend, squash, reset, or force-push.
- Keep the local recovery refs:
  - `codex/rescue-pre-automations-99f3596`
  - `codex/rescue-current-automations-e0806d7`
- Never store integration credentials, bearer tokens, or unredacted transcripts in Git.
- Do not deploy, merge to `main`, publish packages, or mutate external repositories as part of this plan.

## Product model

```text
Monkey.D.Loopy spec ──> validated runtime ──┐
                                            ├─> shared Not Codex harness runner
LoopAny delivery ─────> connector/gate ─────┘        │
                                                     ├─> ordinary Not Codex thread
                                                     ├─> selected provider
                                                     └─> progress/result timeline
```

Monkey.D.Loopy and LoopAny are integrations, not replacements for Not Codex Automations. A user may:

1. Run a Loopy YAML specification locally through Not Codex.
2. Register safe Loopy authoring/inspection tools with supported agent providers.
3. Connect Not Codex to a LoopAny server and let it claim eligible work.
4. Observe, cancel, retry, and diagnose integration runs through Not Codex.

## Reuse audit

The implementation must extend these existing paths:

- `AutomationExecutor` already creates ordinary orchestration threads, dispatches turns, monitors
  projection state, handles approval/input pauses, retries, completion, worktrees, and publication.
- `OrchestrationEngine` and provider adapters are the only supported path for agent execution.
- `ServerSettingsService` persists non-secret server configuration.
- `ServerSecretStore` persists sensitive values with restricted filesystem permissions.
- `McpSessionRegistry` and provider adapters already inject Not Codex MCP configuration.
- Automation persistence and event history already provide durable run/timeline concepts.
- Web settings routes and `SettingsSidebarNav` already provide the place for an Integrations panel.

The first implementation step is to extract the provider-neutral create/dispatch/monitor behavior into a
shared harness service used by Automations and integrations. Duplicating this logic is not acceptable.

## Integration contracts

### Shared descriptor and status

Each built-in integration exposes:

- stable id, display name, description, version, and capabilities;
- lifecycle state: `disabled`, `disconnected`, `connecting`, `ready`, or `error`;
- sanitized health details and last successful activity time;
- typed configuration with secrets represented only by `configured: boolean` to clients.

### Monkey.D.Loopy

Use the published `@loopyc` packages at an exact reviewed version. Do not copy their source into Not
Codex. The integration must:

1. Parse and validate YAML with `@loopyc/core`.
2. Verify and score the loop with `@loopyc/verify` before execution.
3. Execute with `@loopyc/runtime` and a custom `not-codex` agent harness.
4. Map each agent step to the shared Not Codex harness runner.
5. Keep runtime journals under the Not Codex data directory, outside the project repository.
6. Surface validation, verification, bounded-cap, breakpoint, cancellation, and resume outcomes.
7. Offer safe MCP authoring/inspection capabilities to providers without exposing an ungoverned raw
   execution path.

Minimum run input: project, YAML spec, optional input values, provider/model selection, and permission
policy. Minimum result: run id, state, final output, duration, verification summary, journal reference,
thread ids, and a sanitized failure when applicable.

### LoopAny

LoopAny is an optional external scheduler/control plane. Not Codex acts as a local machine connector. The
integration must:

1. Store server URL, enabled state, allowed project roots, and polling preferences as non-secret settings.
2. Store the device bearer token only in `ServerSecretStore`.
3. Poll `POST /api/machine/poll`, claim deliveries once, and avoid concurrent duplicate run ids.
4. Accept only `exec`, `evolve`, and `edit` delivery roles with validated size and shape limits.
5. Resolve work directories beneath explicitly allowed roots; reject traversal and symlink escapes.
6. Treat delivered workflow JavaScript as inert input and fall back to the original task until a
   reviewed runtime can isolate filesystem, process, environment, and network access.
7. Dispatch requested agent work through the shared Not Codex harness runner.
8. Send heartbeats/progress and report a sanitized terminal result to `POST /machine/report` using the
   run token supplied with that delivery.
9. Back off with jitter on transient failures, stop promptly when disabled, and resume safely after a
   server restart without reporting the same terminal result twice.

The connector must not copy LoopAny implementation source. It implements only the public wire contract
and documented behavior necessary for interoperability.

## Security boundaries

- Treat external YAML, workflow JavaScript, delivery metadata, task text, and prior state as untrusted.
- Enforce request/body/output limits before persistence or execution.
- Never evaluate delivered workflow JavaScript in the connector's Node process or a Node permission
  subprocess; Node permissions do not isolate outbound or localhost network access.
- Never return or log LoopAny device/run tokens.
- Never let a LoopAny workdir escape configured roots.
- Preserve Not Codex approval, sandbox, and permission behavior for every dispatched agent turn.
- Do not automatically publish branches, create pull requests, or merge code unless the delivery and the
  local Not Codex policy both explicitly allow it.
- Redact transcripts and errors before sending them to an external control plane.

## Milestones and acceptance evidence

### 1. Corrected specification and normal Git workflow

- Replace the over-scoped Automations completion document and process.
- Commit this plan as the first normal feature commit.
- Evidence: `main` unchanged; feature branch is a descendant; rescue refs remain available.

### 2. Shared harness runner

- Extract ordinary thread creation, turn dispatch, projection monitoring, timeout, cancellation, and
  normalized result mapping from `AutomationExecutor` into one server service.
- Keep existing Automations behavior and tests green.
- Add unit/integration tests for success, provider failure, approval/input pause, cancellation, timeout,
  and restart-visible thread ids.

### 3. Integrations foundation

- Add schema-only integration contracts and RPC methods.
- Add settings and secret-backed configuration with client redaction.
- Add an integration registry/manager with sanitized status and lifecycle control.
- Add persistence only where current settings and automation history cannot represent the data safely.

### 4. Monkey.D.Loopy integration

- Pin and use the reviewed `@loopyc` packages.
- Add validate, verify, execute, cancel, inspect, and resume paths.
- Connect its custom harness to the shared Not Codex harness runner.
- Add safe provider MCP registration and adapter coverage.
- Test valid and invalid specs, cap enforcement, resume, cancellation, provider failures, journal location,
  secret redaction, and MCP configuration for every supported provider adapter.

### 5. LoopAny connector

- Add configuration, connection testing, lifecycle, poll/claim, progress, report, and recovery.
- Add root-jail, payload-size, role, environment, and output limits. Preserve the original task and do
  not advance the cursor when workflow source triggers the security fallback.
- Test protocol fixtures, unauthorized/expired tokens, network recovery, duplicate deliveries, malformed
  workflows, inert malicious workflow source, cancellation, terminal-report idempotency, and filesystem
  escape attempts.

### 6. Product UI and documentation

- Add `/settings/integrations` with Monkey.D.Loopy and LoopAny cards.
- Show package/protocol version, capabilities, sanitized status, token configured state, connection test,
  allowed roots, enable/disable, and recent run links.
- Add concise setup, security, troubleshooting, and support documentation.
- Update `SUPPORT.md` to request integration name/version, sanitized run id, and redacted journal/connector
  diagnostics without asking users to disclose tokens.

### 7. Final verification and handoff

- Run focused tests after each milestone.
- Run `vp check` and `vp run typecheck` before completion.
- Run the relevant full test/build suite and a local smoke test for both integrations.
- Commit each milestone normally and push only `codex/loop-integrations`.
- Report a plain-language TL;DR with commit ids, tests, known limitations, and exact review steps.

## Explicit non-goals

- Slack, email, Teams, APNs, or Live Activity adapters.
- A second cron/scheduling implementation inside Not Codex.
- Rebuilding LoopAny's hosted dashboard or Monkey.D.Loopy's package internals.
- Running the LoopAny connector or Monkey.D.Loopy runtime directly on a phone. Mobile remains a secure
  client for a connected Not Codex execution environment.
- Copying server-side integration secrets, journals, or unrestricted project paths onto a mobile device.
- Automatic release, deployment, branch merge, or destructive Git history cleanup.
- Claiming full LoopAny compatibility beyond the tested protocol version.

## Post-merge product roadmap

### A. Run and observe loops

1. ✅ Persist integration-run lifecycle records and expose environment-scoped list/detail queries.
2. ✅ Add a prominent web action to validate and run a Monkey.D.Loopy specification.
3. ✅ Add a run list, detail page, timeline, linked Not Codex threads, and sanitized diagnostics.

### B. Control and recover loops

1. ✅ Add explicit inspect and cancel operations for active runs.
2. ✅ Add journal-backed resume and linked retry operations with distinct, documented semantics.
3. ✅ Expose only server-authorized controls for each run state and test reconnect/restart behavior.

### C. Prove LoopAny interoperability

1. Demonstrate a live poll, workflow or fallback, harness execution, and terminal report against a
   configured LoopAny server.
2. ✅ Add connector diagnostics and delivery history backed by the shared integration-run lifecycle.
3. Pin protocol fixtures so upstream changes cannot silently break the connector.

### D. Mobile integration management

Mobile reuses the shared contracts and client-runtime integration atoms. It controls integrations on a
paired Not Codex execution environment; it does not create a phone-local agent runtime or connector.

1. ✅ Add a native Integrations destination under mobile Settings with environment selection, integration
   status, versions, capabilities, and sanitized health details.
2. ✅ Add mobile run history and run detail using the same durable records as web, including timeline,
   diagnostics, and navigation to linked Not Codex threads.
3. ✅ Allow users with the required environment scope to launch a validated or saved Loopy specification
   and select project, model, permission mode, inputs, and timeout.
4. ✅ Add state-aware inspect, cancel, resume, and retry controls after the shared server operations land.
5. ✅ Add secret-safe LoopAny configuration and connection diagnostics. Device tokens remain write-only,
   server-side, and removable; the mobile client never reads a stored token back.
6. ✅ Verify iOS and Android behavior for reconnects, offline/read-only states, authorization failures,
   interrupted commands, accessibility, and compact-screen layouts.

Mobile integration notifications are a separate follow-up. The first mobile milestone relies on
in-app status and existing thread navigation and does not add integration-specific APNs or Live
Activity infrastructure.

## Definition of done

The goal is complete only when a user can configure both integrations without exposing secrets, run a
validated Monkey.D.Loopy loop through a real Not Codex provider thread, optionally receive and report a
LoopAny delivery through the same harness, inspect sanitized status/results in the UI, follow the support
documentation, and reproduce the passing verification commands from a reviewable series of commits.
