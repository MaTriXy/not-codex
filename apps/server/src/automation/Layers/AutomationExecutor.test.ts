import { describe, expect, it } from "vite-plus/test";

import {
  renderAutomationPullRequestTitle,
  shouldAutomaticallyRetryAutomation,
} from "./AutomationExecutor.ts";

describe("AutomationExecutor policy", () => {
  it("retries only confirmed terminal failures within the configured bound", () => {
    expect(shouldAutomaticallyRetryAutomation("turn-failed", 1, 2)).toBe(true);
    expect(shouldAutomaticallyRetryAutomation("completion-not-reached", 1, 2)).toBe(true);
    expect(shouldAutomaticallyRetryAutomation("run-checks", 1, 2)).toBe(true);
    expect(shouldAutomaticallyRetryAutomation("turn-failed", 2, 2)).toBe(false);
  });

  it.each([
    "create-thread",
    "start-turn",
    "timeout",
    "publish",
    "record-event",
    "read-thread",
    "prepare-worktree",
  ])("does not retry the ambiguous %s phase", (phase) => {
    expect(shouldAutomaticallyRetryAutomation(phase, 1, 3)).toBe(false);
  });

  it("renders bounded PR title placeholders without interpreting arbitrary syntax", () => {
    expect(
      renderAutomationPullRequestTitle("{name} · run {runId}", "Dependency audit", "run-123"),
    ).toBe("Dependency audit · run run-123");
    expect(renderAutomationPullRequestTitle(null, "Ignored", "ignored")).toBeUndefined();
  });
});
