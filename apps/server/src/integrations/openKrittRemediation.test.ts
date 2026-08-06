import { describe, expect, it } from "vite-plus/test";

import {
  buildOpenKrittRemediationLaunch,
  buildOpenKrittRescanLaunch,
  openKrittRemediationBranchName,
} from "./openKrittRemediation.ts";
import { FULL_COMMIT_SHA } from "./test/openKrittTestFixtures.ts";

describe("Open Kritt remediation and linked rescan handoff", () => {
  it("allocates a distinct safe branch for each remediation launch", () => {
    expect(openKrittRemediationBranchName("finding/one", "launch-a")).toBe(
      "security/open-kritt-finding-one-launch-a",
    );
    expect(openKrittRemediationBranchName("finding/one", "launch-b")).not.toBe(
      openKrittRemediationBranchName("finding/one", "launch-a"),
    );
  });

  it("starts an ordinary governed thread from the exact scanned revision", () => {
    const launch = buildOpenKrittRemediationLaunch({
      projectId: "project-126",
      scanId: "scan-1",
      findingId: "finding-1",
      sourceCommitSha: FULL_COMMIT_SHA,
      worktreePreference: "from-exact-commit",
      modelSelection: { instanceId: "codex", model: "gpt-5" },
      runtimeMode: "approval-required",
      evidence: {
        type: "xss",
        severity: "medium",
        summary: "Untrusted summary",
        explanation: "Untrusted explanation",
        path: "src/a.ts",
        line: 1,
      },
    });

    expect(launch).toMatchObject({
      projectId: "project-126",
      sourceCommitSha: FULL_COMMIT_SHA,
      worktree: { startPoint: FULL_COMMIT_SHA },
      execution: { kind: "ordinary-not-codex-thread" },
    });
    expect(JSON.stringify(launch)).not.toContain("githubToken");
    expect(JSON.stringify(launch)).not.toContain("providerCredential");
    expect(JSON.stringify(launch)).not.toContain("autoCommit");
    expect(JSON.stringify(launch)).not.toContain("autoPush");
  });

  it("rejects remediation when the current project repository no longer matches the scan", () => {
    expect(() =>
      buildOpenKrittRemediationLaunch({
        projectId: "project-126",
        scanId: "scan-1",
        findingId: "finding-1",
        sourceCommitSha: FULL_COMMIT_SHA,
        currentRepoFull: "other-owner/other-repo",
        scannedRepoFull: "Kritt-ai/open-kritt",
        worktreePreference: "from-exact-commit",
        modelSelection: { instanceId: "codex", model: "gpt-5" },
        runtimeMode: "approval-required",
        evidence: {
          type: "xss",
          severity: "medium",
          summary: "summary",
          explanation: "explanation",
          path: "src/a.ts",
          line: 1,
        },
      }),
    ).toThrow(/repository|project|match/i);
  });

  it("creates a child rescan launch only for a new immutable revision after configuration confirmation", () => {
    expect(
      buildOpenKrittRescanLaunch({
        projectId: "project-126",
        priorRunId: "run-1",
        priorScanId: "scan-1",
        remediationThreadId: "thread-fix-1",
        priorCommitSha: FULL_COMMIT_SHA,
        nextCommitSha: "1111111111111111111111111111111111111111",
        configurationConfirmed: true,
      }),
    ).toMatchObject({
      parentRunId: "run-1",
      priorScanId: "scan-1",
      remediationThreadId: "thread-fix-1",
      sourceCommitSha: "1111111111111111111111111111111111111111",
    });
    expect(() =>
      buildOpenKrittRescanLaunch({
        projectId: "project-126",
        priorRunId: "run-1",
        priorScanId: "scan-1",
        priorCommitSha: FULL_COMMIT_SHA,
        nextCommitSha: FULL_COMMIT_SHA,
        configurationConfirmed: true,
      }),
    ).toThrow(/new|revision|rescan/i);
    expect(() =>
      buildOpenKrittRescanLaunch({
        projectId: "project-126",
        priorRunId: "run-1",
        priorScanId: "scan-1",
        priorCommitSha: FULL_COMMIT_SHA,
        nextCommitSha: "1111111111111111111111111111111111111111",
        configurationConfirmed: false,
      }),
    ).toThrow(/confirm/i);
  });
});
