import { EnvironmentId, ProjectId, ThreadId, type IntegrationRun } from "@notcodex/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  integrationRunDetailIsLoading,
  integrationRunDurationLabel,
  integrationRunHistoryHasRefreshWarning,
  integrationRunIsActive,
  integrationRunIsStale,
  integrationRunProjectLabel,
  integrationRunThreadLinks,
  integrationRunTone,
  popIntegrationRunPage,
  pushIntegrationRunPage,
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
    expect(integrationRunHistoryHasRefreshWarning("request failed", 2)).toBe(true);
    expect(integrationRunHistoryHasRefreshWarning("request failed", 0)).toBe(false);
    expect(integrationRunHistoryHasRefreshWarning(null, 2)).toBe(false);
  });

  it("does not leave offline run detail requests on an endless loading state", () => {
    expect(integrationRunDetailIsLoading(true, false, false)).toBe(true);
    expect(integrationRunDetailIsLoading(true, false, true)).toBe(false);
    expect(integrationRunDetailIsLoading(true, true, false)).toBe(false);
  });
});
