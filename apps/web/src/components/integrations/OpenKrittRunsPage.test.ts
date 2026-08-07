import { describe, expect, it } from "vite-plus/test";

import {
  filterIntegrationRunsBySource,
  integrationRunSourceLabel,
} from "./IntegrationRunsPage.logic.ts";

describe("Open Kritt durable Runs presentation", () => {
  it("filters environment-scoped runs by open-kritt without dropping parent/child links", () => {
    const runs = [
      { id: "run-kritt", source: "open-kritt", projectId: "project-1", parentRunId: null },
      { id: "run-loopany", source: "loopany", projectId: "project-1", parentRunId: null },
      { id: "run-rescan", source: "open-kritt", projectId: "project-1", parentRunId: "run-kritt" },
    ];
    expect(filterIntegrationRunsBySource(runs, "open-kritt")).toEqual([runs[0], runs[2]]);
  });

  it("uses native labels and never leaks raw upstream status as the durable state", () => {
    expect(integrationRunSourceLabel("open-kritt")).toBe("Open Kritt");
    expect(integrationRunSourceLabel("open-kritt", "prewarming_cache")).toMatch(
      /queued|preparing/i,
    );
  });
});
