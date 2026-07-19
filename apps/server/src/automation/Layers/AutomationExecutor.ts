import {
  ThreadId,
  type AutomationRun,
  type AutomationRunEventKind,
  type OrchestrationMessage,
  type OrchestrationProjectShell,
} from "@notcodex/contracts";
import { HostProcessPlatform } from "@notcodex/shared/hostProcess";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";

import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import { AgentHarnessRunner } from "../../orchestration/Services/AgentHarnessRunner.ts";
import * as ProjectionSnapshotQuery from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { AutomationRepository } from "../../persistence/Services/AutomationRepository.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import { AutomationService } from "../Services/AutomationService.ts";
import { AutomationExecutionError, AutomationExecutor } from "../Services/AutomationExecutor.ts";

const LEASE_MINUTES = 2;
const POLL_INTERVAL = "1 second";
const SAFE_AUTOMATIC_RETRY_PHASES = new Set([
  "turn-failed",
  "completion-not-reached",
  "run-checks",
]);

export function shouldAutomaticallyRetryAutomation(
  phase: string,
  attempt: number,
  maxAttempts: number,
): boolean {
  return SAFE_AUTOMATIC_RETRY_PHASES.has(phase) && attempt < maxAttempts;
}

export function renderAutomationPullRequestTitle(
  template: string | null,
  name: string,
  runId: string,
): string | undefined {
  return template?.replaceAll("{name}", name).replaceAll("{runId}", runId);
}

function executionError(phase: string, cause: unknown): AutomationExecutionError {
  const message =
    cause instanceof Error && cause.message.trim().length > 0
      ? cause.message
      : `Automation execution failed during ${phase}.`;
  return new AutomationExecutionError({ phase, message, cause });
}

function slug(value: string): string {
  const normalized = value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized.length > 0 ? normalized : "run";
}

function lastAssistantMessage(messages: ReadonlyArray<OrchestrationMessage>): string {
  return messages.findLast((message) => message.role === "assistant")?.text ?? "";
}

const makeAutomationExecutor = Effect.gen(function* () {
  const repository = yield* AutomationRepository;
  const automations = yield* AutomationService;
  const harness = yield* AgentHarnessRunner;
  const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const processes = yield* ProcessRunner.ProcessRunner;
  const hostPlatform = yield* HostProcessPlatform;
  const crypto = yield* Crypto.Crypto;
  const owner = `automation-executor-${yield* crypto.randomUUIDv4.pipe(
    Effect.mapError((cause) => executionError("initialize", cause)),
  )}`;

  const now = Effect.map(DateTime.now, (value) => ({
    value,
    iso: DateTime.formatIso(value),
  }));

  const saveRun = (run: AutomationRun, phase: string) =>
    automations.updateRun(run).pipe(Effect.mapError((cause) => executionError(phase, cause)));

  const appendEvent = (
    run: AutomationRun,
    kind: AutomationRunEventKind,
    message: string,
    payload: unknown = {},
  ) =>
    Effect.gen(function* () {
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* automations.appendRunEvent({
        run,
        kind,
        message,
        payload,
        createdAt,
      });
    }).pipe(Effect.mapError((cause) => executionError("record-event", cause)));

  const revision = (cwd: string) =>
    git
      .execute({
        operation: "AutomationExecutor.revision",
        cwd,
        args: ["rev-parse", "HEAD"],
      })
      .pipe(
        Effect.map((result) => result.stdout.trim() || null),
        Effect.mapError((cause) => executionError("resolve-revision", cause)),
      );

  const renewLease = (run: AutomationRun) =>
    Effect.gen(function* () {
      const current = yield* DateTime.now;
      return yield* repository.renewRunLease({
        runId: run.id,
        owner,
        now: DateTime.formatIso(current),
        leaseExpiresAt: DateTime.formatIso(DateTime.add(current, { minutes: LEASE_MINUTES })),
      });
    }).pipe(Effect.mapError((cause) => executionError("renew-lease", cause)));

  const terminalCompletionReached = Effect.fn("AutomationExecutor.completionReached")(function* (
    run: AutomationRun,
    project: OrchestrationProjectShell,
    cwd: string,
  ) {
    const completion =
      run.definitionSnapshot.completion.type === "follow-until-complete"
        ? run.definitionSnapshot.completion.until
        : run.definitionSnapshot.completion;

    if (completion.type === "turn-completed") {
      return true;
    }

    const detail = yield* projections
      .getThreadDetailById(run.threadId!)
      .pipe(Effect.mapError((cause) => executionError("read-thread-detail", cause)));
    if (Option.isNone(detail)) {
      return false;
    }
    if (completion.type === "goal-signal") {
      return lastAssistantMessage(detail.value.messages).includes(completion.marker);
    }

    const scripts = completion.scriptIds.map((id) =>
      project.scripts.find((script) => script.id === id),
    );
    if (scripts.some((script) => script === undefined)) {
      const missing = completion.scriptIds.filter(
        (id) => !project.scripts.some((script) => script.id === id),
      );
      return yield* executionError(
        "run-checks",
        new Error(
          `Unknown project check script${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
        ),
      );
    }
    for (const script of scripts) {
      const shellCommand =
        hostPlatform === "win32"
          ? { command: "powershell.exe", args: ["-NoProfile", "-Command", script!.command] }
          : {
              command: hostPlatform === "darwin" ? "/bin/zsh" : "/bin/bash",
              args: ["-lc", script!.command],
            };
      const result = yield* processes
        .run({
          ...shellCommand,
          cwd,
          timeout: `${run.definitionSnapshot.execution.maxDurationMinutes} minutes`,
          timeoutBehavior: "timedOutResult",
          maxOutputBytes: 2 * 1024 * 1024,
          outputMode: "truncate",
          truncatedMarker: "\n[output truncated]\n",
        })
        .pipe(Effect.mapError((cause) => executionError("run-checks", cause)));
      if (result.timedOut || result.code !== ExitCode(0)) {
        return false;
      }
    }
    return true;
  });

  const dispatchTurn = Effect.fn("AutomationExecutor.dispatchTurn")(function* (
    run: AutomationRun,
    threadId: ThreadId,
    prompt: string,
    titleSeed?: string,
  ) {
    yield* harness
      .startTurn({
        threadId,
        prompt,
        modelSelection: run.definitionSnapshot.modelSelection,
        ...(titleSeed ? { titleSeed } : {}),
        runtimeMode: run.definitionSnapshot.runtimeMode,
      })
      .pipe(Effect.mapError((cause) => executionError("start-turn", cause)));
  });

  const publish = Effect.fn("AutomationExecutor.publish")(function* (
    run: AutomationRun,
    cwd: string,
  ) {
    const policy = run.definitionSnapshot.publish;
    if (policy.type === "never") {
      return run;
    }
    const titleTemplate =
      policy.type === "draft-pr" || policy.type === "ready-pr" ? policy.titleTemplate : null;
    const pullRequestTitle = renderAutomationPullRequestTitle(
      titleTemplate,
      run.definitionSnapshot.name,
      run.id,
    );
    const result = yield* gitWorkflow
      .runStackedAction({
        actionId: `automation-${run.id}`,
        cwd,
        action: policy.type === "branch" ? "commit_push" : "commit_push_pr",
        commitMessage: `chore: complete ${run.definitionSnapshot.name}`,
        ...(policy.type === "draft-pr" ? { draftPullRequest: true } : {}),
        ...(pullRequestTitle ? { pullRequestTitle } : {}),
      })
      .pipe(Effect.mapError((cause) => executionError("publish", cause)));
    const published: AutomationRun = {
      ...run,
      branch: result.push.branch ?? result.branch.name ?? run.branch,
      pullRequestUrl: result.pr.url ?? run.pullRequestUrl,
      headRevision: yield* revision(cwd),
      updatedAt: DateTime.formatIso(yield* DateTime.now),
    };
    yield* saveRun(published, "save-publish-result");
    yield* appendEvent(published, "published", "Automation result published.", {
      branch: published.branch,
      pullRequestUrl: published.pullRequestUrl,
      requestedPolicy: policy.type,
    });
    return published;
  });

  const markFailed = Effect.fn("AutomationExecutor.markFailed")(function* (
    run: AutomationRun,
    cause: AutomationExecutionError,
  ) {
    const current = yield* DateTime.now;
    if (
      shouldAutomaticallyRetryAutomation(
        cause.phase,
        run.attempt,
        run.definitionSnapshot.retry.maxAttempts,
      )
    ) {
      const exponent = Math.max(0, run.attempt - 1);
      const delaySeconds = Math.min(
        run.definitionSnapshot.retry.maxDelaySeconds,
        run.definitionSnapshot.retry.initialDelaySeconds * 2 ** exponent,
      );
      const retry: AutomationRun = {
        ...run,
        status: "retry-wait",
        scheduledFor: DateTime.formatIso(DateTime.add(current, { seconds: delaySeconds })),
        attempt: run.attempt + 1,
        threadId: null,
        turnId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        startedAt: null,
        finishedAt: null,
        errorCode: cause.phase,
        errorMessage: cause.message,
        updatedAt: DateTime.formatIso(current),
      };
      yield* saveRun(retry, "schedule-retry");
      yield* appendEvent(retry, "retry-scheduled", "Automation run scheduled for retry.", {
        attempt: retry.attempt,
        delaySeconds,
        error: cause.message,
      });
      return;
    }
    const failed: AutomationRun = {
      ...run,
      status: "failed",
      leaseOwner: null,
      leaseExpiresAt: null,
      finishedAt: DateTime.formatIso(current),
      errorCode: cause.phase,
      errorMessage: cause.message,
      updatedAt: DateTime.formatIso(current),
    };
    yield* saveRun(failed, "mark-failed");
    yield* appendEvent(failed, "failed", cause.message, { phase: cause.phase });
  });

  const monitor = Effect.fn("AutomationExecutor.monitor")(function* (
    initialRun: AutomationRun,
    project: OrchestrationProjectShell,
    cwd: string,
  ) {
    let run = initialRun;
    let turns = 1;
    const maxTurns =
      run.definitionSnapshot.completion.type === "follow-until-complete"
        ? run.definitionSnapshot.completion.maxTurns
        : 1;
    const deadlineMinutes =
      run.definitionSnapshot.completion.type === "follow-until-complete"
        ? Math.min(
            run.definitionSnapshot.execution.maxDurationMinutes,
            run.definitionSnapshot.completion.maxDurationMinutes,
          )
        : run.definitionSnapshot.execution.maxDurationMinutes;
    const startedAt = DateTime.makeUnsafe(run.startedAt ?? run.updatedAt);
    const deadline = DateTime.add(startedAt, { minutes: deadlineMinutes });

    while (true) {
      yield* Effect.sleep(POLL_INTERVAL);
      const currentAt = yield* DateTime.now;
      if (DateTime.toEpochMillis(currentAt) >= DateTime.toEpochMillis(deadline)) {
        return yield* executionError(
          "timeout",
          new Error("Automation exceeded its duration limit."),
        );
      }

      const persisted = yield* repository
        .getRun(run.id)
        .pipe(Effect.mapError((cause) => executionError("read-run", cause)));
      if (Option.isNone(persisted)) {
        return yield* executionError("read-run", new Error("Automation run disappeared."));
      }
      run = persisted.value;
      if (run.status === "cancelled") {
        if (run.threadId) {
          yield* harness.interrupt(run.threadId).pipe(Effect.catch(() => Effect.void));
        }
        return;
      }

      yield* renewLease(run);
      const shell = yield* projections
        .getThreadShellById(run.threadId!)
        .pipe(Effect.mapError((cause) => executionError("read-thread", cause)));
      if (Option.isNone(shell)) {
        continue;
      }
      const thread = shell.value;
      const waitingStatus = thread.hasPendingApprovals
        ? "waiting-for-approval"
        : thread.hasPendingUserInput
          ? "waiting-for-input"
          : null;
      if (waitingStatus) {
        if (run.definitionSnapshot.execution.approvalHandling === "fail") {
          return yield* executionError(
            waitingStatus,
            new Error(`Automation paused in ${waitingStatus.replaceAll("-", " ")}.`),
          );
        }
        if (run.status !== waitingStatus) {
          run = { ...run, status: waitingStatus, updatedAt: DateTime.formatIso(currentAt) };
          yield* saveRun(run, "mark-waiting");
          yield* appendEvent(
            run,
            waitingStatus === "waiting-for-approval" ? "waiting-for-approval" : "waiting-for-input",
            waitingStatus === "waiting-for-approval"
              ? "Automation is waiting for approval in its thread."
              : "Automation is waiting for input in its thread.",
          );
        }
        continue;
      }

      const latestTurn = thread.latestTurn;
      if (latestTurn && run.turnId !== latestTurn.turnId) {
        run = {
          ...run,
          turnId: latestTurn.turnId,
          updatedAt: DateTime.formatIso(currentAt),
        };
        yield* saveRun(run, "save-turn");
      }
      if (!latestTurn || latestTurn.state === "running") {
        if (run.status !== "running") {
          run = { ...run, status: "running", updatedAt: DateTime.formatIso(currentAt) };
          yield* saveRun(run, "resume-running");
        }
        continue;
      }
      if (latestTurn.state === "error" || latestTurn.state === "interrupted") {
        return yield* executionError(
          "turn-failed",
          new Error(`Provider turn ended in state ${latestTurn.state}.`),
        );
      }

      if (yield* terminalCompletionReached(run, project, cwd)) {
        run = yield* publish(run, cwd);
        const completedAt = DateTime.formatIso(yield* DateTime.now);
        const succeeded: AutomationRun = {
          ...run,
          status: "succeeded",
          leaseOwner: null,
          leaseExpiresAt: null,
          finishedAt: completedAt,
          updatedAt: completedAt,
          headRevision: yield* revision(cwd),
          errorCode: null,
          errorMessage: null,
        };
        yield* saveRun(succeeded, "mark-succeeded");
        yield* appendEvent(succeeded, "succeeded", "Automation completed successfully.");
        if (succeeded.worktreePath && succeeded.definitionSnapshot.execution.cleanupOnSuccess) {
          yield* gitWorkflow
            .removeWorktree({
              cwd: project.workspaceRoot,
              path: succeeded.worktreePath,
              force: false,
            })
            .pipe(Effect.catch(() => Effect.void));
        }
        return;
      }

      if (run.definitionSnapshot.completion.type !== "follow-until-complete" || turns >= maxTurns) {
        return yield* executionError(
          "completion-not-reached",
          new Error("Automation reached its turn limit before the completion condition."),
        );
      }
      turns += 1;
      yield* dispatchTurn(run, run.threadId!, run.definitionSnapshot.completion.followUpPrompt);
      const followedUpAt = DateTime.formatIso(yield* DateTime.now);
      run = { ...run, turnId: null, status: "running", updatedAt: followedUpAt };
      yield* saveRun(run, "save-follow-up");
      yield* appendEvent(run, "turn-started", `Follow-up turn ${turns} requested.`, {
        turn: turns,
      });
    }
  });

  const executeRun = Effect.fn("AutomationExecutor.executeRun")(function* (claimed: AutomationRun) {
    let run = claimed;
    const projectOption = yield* projections
      .getProjectShellById(run.definitionSnapshot.projectId)
      .pipe(Effect.mapError((cause) => executionError("resolve-project", cause)));
    if (Option.isNone(projectOption)) {
      return yield* executionError(
        "resolve-project",
        new Error("Automation project was not found."),
      );
    }
    const project = projectOption.value;

    let cwd = run.worktreePath ?? project.workspaceRoot;
    if (run.threadId === null) {
      const started = yield* now;
      let branch = run.branch;
      let worktreePath = run.worktreePath;
      const baseRevision = run.baseRevision ?? (yield* revision(project.workspaceRoot));

      if (run.definitionSnapshot.execution.worktreeMode === "isolated" && worktreePath === null) {
        const status = yield* gitWorkflow
          .localStatus({ cwd: project.workspaceRoot })
          .pipe(Effect.mapError((cause) => executionError("inspect-repository", cause)));
        const baseBranch = run.definitionSnapshot.execution.baseBranch ?? status.refName ?? "HEAD";
        const suffix = run.id.replaceAll("-", "").slice(0, 8);
        const requestedBranch = `automation/${slug(run.definitionSnapshot.name)}-${suffix}`;
        const worktree = yield* gitWorkflow
          .createWorktree({
            cwd: project.workspaceRoot,
            refName: baseBranch,
            newRefName: requestedBranch,
            baseRefName: baseBranch,
            path: null,
          })
          .pipe(Effect.mapError((cause) => executionError("prepare-worktree", cause)));
        branch = worktree.worktree.refName;
        worktreePath = worktree.worktree.path;
        cwd = worktreePath;
      } else if (worktreePath !== null) {
        cwd = worktreePath;
      }

      const threadId = yield* harness
        .createThread({
          projectId: project.id,
          title: `[Automation] ${run.definitionSnapshot.name}`,
          modelSelection: run.definitionSnapshot.modelSelection,
          runtimeMode: run.definitionSnapshot.runtimeMode,
          branch,
          worktreePath,
        })
        .pipe(Effect.mapError((cause) => executionError("create-thread", cause)));

      run = {
        ...run,
        status: "running",
        threadId,
        worktreePath,
        branch,
        baseRevision,
        startedAt: started.iso,
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
        updatedAt: started.iso,
      };
      yield* saveRun(run, "save-thread");
      if (worktreePath) {
        yield* appendEvent(run, "worktree-prepared", "Isolated automation worktree prepared.", {
          worktreePath,
          branch,
          baseRevision,
        });
      }
      yield* appendEvent(run, "thread-started", "Automation thread created.", { threadId });
      yield* dispatchTurn(
        run,
        threadId,
        run.definitionSnapshot.prompt,
        run.definitionSnapshot.name,
      );
      yield* appendEvent(run, "turn-started", "Initial automation turn requested.");
    }

    yield* monitor(run, project, cwd);
  });

  const executeAndRecord = (run: AutomationRun) =>
    executeRun(run).pipe(
      Effect.catch((cause) =>
        repository.getRun(run.id).pipe(
          Effect.mapError((readCause) => executionError("read-run-after-failure", readCause)),
          Effect.flatMap((current) =>
            markFailed(
              Option.getOrElse(current, () => run),
              cause,
            ),
          ),
        ),
      ),
    );

  const tick = Effect.fn("AutomationExecutor.tick")(function* () {
    const current = yield* DateTime.now;
    const claimed = yield* repository
      .claimNextRun({
        owner,
        now: DateTime.formatIso(current),
        leaseExpiresAt: DateTime.formatIso(DateTime.add(current, { minutes: LEASE_MINUTES })),
      })
      .pipe(Effect.mapError((cause) => executionError("claim", cause)));
    if (Option.isNone(claimed)) {
      return 0;
    }
    yield* appendEvent(claimed.value, "claimed", "Automation run claimed by the local executor.", {
      owner,
    });
    yield* executeAndRecord(claimed.value);
    return 1;
  });

  return AutomationExecutor.of({ tick, executeRun });
});

export const AutomationExecutorLive = Layer.effect(AutomationExecutor, makeAutomationExecutor);

export const AutomationExecutorRuntimeLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const executor = yield* AutomationExecutor;
    yield* executor.tick().pipe(
      Effect.catch((error) =>
        Effect.logError("automation executor tick failed").pipe(
          Effect.annotateLogs({ phase: error.phase, error: error.message }),
        ),
      ),
      Effect.repeat(Schedule.spaced("2 seconds")),
      Effect.forkScoped,
    );
  }),
);
