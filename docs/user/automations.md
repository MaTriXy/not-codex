# Automations

Automations let Not Codex run a coding-agent task now, once at a future time, on an interval, or on a
weekly calendar. Every run is an ordinary thread: you can inspect the conversation, approvals, files,
diffs, branch, and pull request through the same product surfaces used for an interactive task.

## Create an automation

Open **Automations** in the primary sidebar and select **New automation**, or start from a template.
Choose a project, write an outcome-oriented prompt, and configure:

- **Schedule:** manual, one time, recurring interval, or weekly calendar with an IANA time zone.
- **Workspace:** an isolated Git worktree (recommended) or the active project checkout.
- **Permissions:** approval required, auto-accept edits, or full access.
- **Approval handling:** pause the run for a person, or fail it immediately.
- **Completion:** a completed turn, an assistant marker, selected project checks, or bounded follow-up
  turns until one of those conditions is true.
- **Retries:** the maximum number of attempts after a confirmed terminal failure.
- **Publishing:** keep changes local, push a branch, open a draft pull request, or—after explicit
  confirmation—open a ready-for-review pull request.
- **Notifications:** in-app and, when browser permission is granted, system notifications.

The editor previews the next three scheduled instants. Calendar schedules use the selected time zone;
the server persists the next UTC instant so restarts do not reset the schedule.

## Follow a run

Run history shows the durable status and event timeline. A run may be queued, preparing, running,
waiting for approval or input, waiting to retry, succeeded, failed, cancelled, or skipped. Use
**Open thread** to resolve an approval or answer structured input, and **Open PR** when publishing has
created a pull request.

Cancelling a run interrupts an active provider turn when possible. It does not delete its thread or
discard an isolated worktree. A failed or cancelled run can be retried manually as a new auditable run.

## Safety defaults

New automations default to an isolated worktree, approval-required agent permissions, pause-and-notify
approval handling, no publishing, a wall-clock limit, and bounded retries. Keep those defaults unless
the task has a clear reason to broaden them.

Full access and project-root execution can affect files outside an isolated branch. Ready pull requests
change external source-control state and therefore require an explicit stored confirmation. Not Codex
never merges an automation pull request automatically.

## Local-first and Connect

The environment server owns the schedule, database, repository, provider process, and execution lease.
The web, desktop, or mobile client may disconnect without stopping a run. Not Codex Connect can make a
reachable environment visible to another authenticated client and carry its normal RPC/status stream,
but Connect is not required to schedule or execute an automation and never runs the provider in the
cloud.

## Recovery behavior

Schedules and runs live in the environment SQLite database. After a restart, the scheduler queues only
the latest missed occurrence instead of replaying an unbounded backlog. The executor reclaims queued or
expired leased work. It resumes a known thread when state is certain and refuses unsafe automatic retry
after ambiguous thread creation, dispatch, timeout, or publishing failures. See the
[operator guide](../operations/automations.md) for recovery details.
