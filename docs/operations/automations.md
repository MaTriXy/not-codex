# Operating Automations

Automations start with the environment server and require no separate worker process. Migration 033
creates the definition, run, and run-event tables in the normal environment database.

## Health checks

When diagnosing a run, inspect these surfaces in order:

1. The Automations run timeline and terminal error code.
2. The linked ordinary thread for provider state, approvals, input, and tool activity.
3. The linked branch/worktree and pull request, if publishing was enabled.
4. Environment-server logs for `AutomationScheduler` or `AutomationExecutor` spans.

An active run renews its lease while polling canonical thread state. An expired lease makes in-flight
work recoverable by the next executor tick. Only one executor claim can own the row at a time.

## Restart and missed schedules

Restarting the environment does not erase definitions or runs. On startup:

- due definitions enqueue at most one latest missed occurrence;
- duplicate scheduled instants are rejected by a unique database index;
- an active-run index prevents a second concurrent run for the same automation;
- expired preparing, running, approval-waiting, or input-waiting rows become claimable;
- a persisted thread/worktree is reused when recovery state is unambiguous.

## Failure handling

The run timeline preserves the typed failure phase and a bounded message. Confirmed terminal turn or
completion failures can enter exponential backoff up to the configured attempt limit. Ambiguous
side-effect failures do not retry automatically. Inspect the thread, worktree, remote branch, and source
control provider before selecting **Retry**.

Cancellation is durable. The service marks the run cancelled first; the executor observes that state
and requests a provider turn interrupt. Worktrees are cleaned only after success, only when configured,
and only through the existing safe worktree-removal flow.

## Verification

Repository changes to Automations must pass the normal gates plus focused automation tests:

```bash
vp check
vp run typecheck
vp run test
```

Schedule tests use deterministic instants and cover intervals, weekly calendars, DST gaps/overlaps, and
missed-run advancement. Persistence tests cover idempotency, active-run constraints, claims, leases,
renewal, and event ordering.
