import type { AutomationTemplate } from "@notcodex/contracts";

const safeExecution = {
  worktreeMode: "isolated",
  approvalHandling: "pause",
  maxDurationMinutes: 60,
  baseBranch: null,
  cleanupOnSuccess: false,
} as const;

const notifyOutcome = {
  onStarted: false,
  onWaiting: true,
  onSucceeded: true,
  onFailed: true,
} as const;

export const AUTOMATION_TEMPLATES: ReadonlyArray<AutomationTemplate> = [
  {
    id: "daily-repository-health",
    name: "Daily repository health check",
    description: "Review current repository health, run configured checks, and summarize risks.",
    prompt:
      "Review this repository for failing checks, risky changes, dependency problems, and documentation drift. Run the project checks that are safe in this environment, make focused fixes when appropriate, and summarize the outcome.",
    schedule: { type: "calendar", timeZone: "UTC", localTime: "09:00", weekdays: [1, 2, 3, 4, 5] },
    execution: safeExecution,
    completion: { type: "turn-completed" },
    retry: { maxAttempts: 2, initialDelaySeconds: 60, maxDelaySeconds: 600 },
    publish: { type: "never" },
    notifications: notifyOutcome,
  },
  {
    id: "dependency-draft-pr",
    name: "Dependency update with draft PR",
    description: "Prepare a focused dependency update in an isolated worktree and open a draft PR.",
    prompt:
      "Find one safe, useful dependency update. Apply it with the smallest compatible change, run the relevant checks, document any migration risk, and prepare the result for review.",
    schedule: { type: "manual" },
    execution: safeExecution,
    completion: { type: "turn-completed" },
    retry: { maxAttempts: 1, initialDelaySeconds: 0, maxDelaySeconds: 0 },
    publish: { type: "draft-pr", titleTemplate: "chore: update dependency" },
    notifications: notifyOutcome,
  },
  {
    id: "follow-plan",
    name: "Follow a plan until complete",
    description:
      "Continue a bounded implementation plan until the agent emits a completion signal.",
    prompt:
      "Review the implementation plan in this repository, choose the next unfinished item, implement and verify it, then emit NOT_CODEX_GOAL_COMPLETE only when the full plan is genuinely complete.",
    schedule: { type: "manual" },
    execution: { ...safeExecution, maxDurationMinutes: 240 },
    completion: {
      type: "follow-until-complete",
      until: { type: "goal-signal", marker: "NOT_CODEX_GOAL_COMPLETE" },
      maxTurns: 12,
      maxDurationMinutes: 240,
      followUpPrompt:
        "Continue with the next unfinished plan item. Verify prior work before proceeding.",
    },
    retry: { maxAttempts: 2, initialDelaySeconds: 60, maxDelaySeconds: 900 },
    publish: { type: "never" },
    notifications: notifyOutcome,
  },
  {
    id: "weekly-docs-audit",
    name: "Weekly documentation drift audit",
    description:
      "Compare docs with current behavior and repair stale, broken, or misleading guidance.",
    prompt:
      "Audit public documentation against the current code and commands. Fix broken links, stale architecture claims, and misleading setup steps. Keep product claims evidence-based and run documentation-related checks.",
    schedule: { type: "calendar", timeZone: "UTC", localTime: "10:00", weekdays: [1] },
    execution: safeExecution,
    completion: { type: "turn-completed" },
    retry: { maxAttempts: 1, initialDelaySeconds: 0, maxDelaySeconds: 0 },
    publish: { type: "never" },
    notifications: notifyOutcome,
  },
];
