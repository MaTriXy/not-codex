import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type IntegrationRun,
  type IntegrationRunRuntimeSnapshot,
} from "@notcodex/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  integrationRunDetailIsLoading,
  integrationRunDurationLabel,
  integrationRunHasRefreshWarning,
  integrationRunHistoryIsLoading,
  integrationRunHistoryIsUnavailableOffline,
  integrationRunIsActive,
  integrationRunIsStale,
  integrationRunProjectLabel,
  integrationRunThreadLinks,
  integrationRunTone,
  popIntegrationRunPage,
  pushIntegrationRunPage,
  selectIntegrationRunDetailRun,
  selectIntegrationRunRuntimeInspection,
} from "./integrationRunsPresentation";

const run: IntegrationRun = {
  id: "run-1",
  source: "monkey-d-loopy",
  state: "running",
  projectId: ProjectId.make("project-1"),
  parentRunId: null,
  attempt: 1,
  threadIds: [ThreadId.make("thread-1"), ThreadId.make("thread-missing")],
  journalRef: null,
  outputSummary: null,
  failure: null,
  verification: null,
  timeline: [],
  createdAt: "2026-07-19T10:00:00.000Z",
  startedAt: "2026-07-19T10:00:10.000Z",
  completedAt: null,
  updatedAt: "2026-07-19T10:00:20.000Z",
};

describe("mobile integration run presentation", () => {
  it("formats state and live duration without reading a journal", () => {
    expect(integrationRunTone("succeeded")).toBe("success");
    expect(integrationRunTone("failed")).toBe("danger");
    expect(integrationRunTone("waiting")).toBe("warning");
    expect(integrationRunDurationLabel(run, Date.parse("2026-07-19T10:02:10.000Z"))).toBe("2m");
    expect(integrationRunIsActive("queued")).toBe(true);
    expect(integrationRunIsActive("running")).toBe(true);
    expect(integrationRunIsActive("waiting")).toBe(true);
    expect(integrationRunIsActive("succeeded")).toBe(false);
  });

  it("keeps project and thread lookup inside the selected environment", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const otherEnvironmentId = EnvironmentId.make("environment-2");
    expect(
      integrationRunProjectLabel(
        run,
        [
          { environmentId: otherEnvironmentId, id: "project-1", title: "Wrong project" },
          { environmentId, id: "project-1", title: "Correct project" },
        ],
        environmentId,
      ),
    ).toBe("Correct project");
    expect(
      integrationRunThreadLinks(run, environmentId, [
        { environmentId: otherEnvironmentId, id: ThreadId.make("thread-1") },
        { environmentId, id: ThreadId.make("thread-1") },
      ]),
    ).toEqual([
      { threadId: "thread-1", available: true },
      { threadId: "thread-missing", available: false },
    ]);
  });

  it("marks reconnect/offline data stale and bounds page navigation", () => {
    expect(integrationRunIsStale("connected")).toBe(false);
    expect(integrationRunIsStale("reconnecting")).toBe(true);
    expect(integrationRunIsStale("offline")).toBe(true);
    const next = { createdAt: "2026-07-19T10:00:00.000Z", id: "run-1" };
    const pages = pushIntegrationRunPage([null], next);
    expect(pushIntegrationRunPage(pages, next)).toEqual(pages);
    expect(popIntegrationRunPage(pages)).toEqual([null]);
    expect(popIntegrationRunPage([null])).toEqual([null]);
  });

  it("warns when cached run history survives a failed refresh", () => {
    expect(integrationRunHasRefreshWarning("request failed", true)).toBe(true);
    expect(integrationRunHasRefreshWarning("request failed", false)).toBe(false);
    expect(integrationRunHasRefreshWarning(null, true)).toBe(false);
  });

  it("does not leave offline run detail requests on an endless loading state", () => {
    expect(integrationRunDetailIsLoading(true, false, false)).toBe(true);
    expect(integrationRunDetailIsLoading(true, false, true)).toBe(false);
    expect(integrationRunDetailIsLoading(true, true, false)).toBe(false);
  });

  it("prefers fresh durable run data when controls inspection refresh fails", () => {
    const inspectedRun = {
      ...run,
      state: "running" as const,
      updatedAt: "2026-07-19T10:00:20.000Z",
    };
    const durableRun = {
      ...run,
      state: "succeeded" as const,
      completedAt: "2026-07-19T10:01:00.000Z",
      updatedAt: "2026-07-19T10:01:00.000Z",
    };

    expect(
      selectIntegrationRunDetailRun({
        inspectedRun,
        durableRun,
        inspectionError: "inspection unavailable",
      }),
    ).toBe(durableRun);
    expect(
      selectIntegrationRunDetailRun({
        inspectedRun,
        durableRun,
        inspectionError: null,
      }),
    ).toBe(inspectedRun);
  });

  it("hides cached runtime inspection after an inspection refresh fails", () => {
    const runtime: IntegrationRunRuntimeSnapshot = {
      live: true,
      phase: "running",
      recoverable: false,
      progress: {
        agentCallsStarted: 1,
        agentCallsCompleted: 0,
        activeStep: "coding",
        activeThreadId: null,
        linkedThreadIds: [],
      },
      caps: null,
      diagnostics: [],
    };

    expect(
      selectIntegrationRunRuntimeInspection({
        runtime,
        inspectionError: "inspection unavailable",
      }),
    ).toBeNull();
    expect(
      selectIntegrationRunRuntimeInspection({
        runtime,
        inspectionError: null,
      }),
    ).toBe(runtime);
  });

  it("shows an offline fallback when run history has no cached page", () => {
    expect(integrationRunHistoryIsLoading(true, false)).toBe(true);
    expect(integrationRunHistoryIsLoading(true, true)).toBe(false);
    expect(integrationRunHistoryIsUnavailableOffline(true, 0)).toBe(true);
    expect(integrationRunHistoryIsUnavailableOffline(true, 1)).toBe(false);
    expect(integrationRunHistoryIsUnavailableOffline(false, 0)).toBe(false);
  });
});
