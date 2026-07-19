import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { IntegrationRun } from "@notcodex/contracts";

import {
  createdAfterForRange,
  deriveRunTimeline,
  projectsForEnvironment,
  runDurationLabel,
} from "./IntegrationRunsPage.logic";

const decode = Schema.decodeUnknownSync(IntegrationRun);
const run = decode({
  id: "run-1",
  source: "monkey-d-loopy",
  state: "succeeded",
  projectId: "project-1",
  parentRunId: null,
  attempt: 2,
  threadIds: [],
  journalRef: null,
  outputSummary: null,
  failure: null,
  createdAt: "2026-07-19T10:00:00.000Z",
  startedAt: "2026-07-19T10:01:00.000Z",
  completedAt: "2026-07-19T10:03:05.000Z",
  updatedAt: "2026-07-19T10:03:05.000Z",
});

describe("IntegrationRunsPage logic", () => {
  it("derives a stable lifecycle for records written before timeline metadata", () => {
    expect(deriveRunTimeline(run).map((event) => event.state)).toEqual([
      "queued",
      "running",
      "succeeded",
    ]);
    expect(runDurationLabel(run, Date.parse("2026-07-19T11:00:00.000Z"))).toBe("2m 5s");
    expect(run.attempt).toBe(2);
  });

  it("sorts persisted events by durable sequence", () => {
    const withTimeline = {
      ...run,
      timeline: [
        { sequence: 1, state: "running" as const, occurredAt: run.startedAt!, summary: "Started" },
        { sequence: 0, state: "queued" as const, occurredAt: run.createdAt, summary: "Queued" },
      ],
    };
    expect(deriveRunTimeline(withTimeline).map((event) => event.sequence)).toEqual([0, 1]);
  });

  it("creates bounded UTC time filters", () => {
    const now = Date.parse("2026-07-19T12:00:00.000Z");
    expect(createdAfterForRange("all", now)).toBeUndefined();
    expect(createdAfterForRange("24h", now)).toBe("2026-07-18T12:00:00.000Z");
    expect(createdAfterForRange("7d", now)).toBe("2026-07-12T12:00:00.000Z");
  });

  it("keeps project filters scoped to the selected environment", () => {
    const projects = [
      { environmentId: "local", id: "project-local" },
      { environmentId: "remote", id: "project-remote" },
    ];
    expect(projectsForEnvironment(projects, "remote")).toEqual([projects[1]]);
    expect(projectsForEnvironment(projects, null)).toEqual([]);
  });
});
