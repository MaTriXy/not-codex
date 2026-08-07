import { describe, expect, it } from "vite-plus/test";

import {
  integrationRunSourceLabel,
  openKrittMobileOperations,
  openKrittObservationPresentation,
  openKrittRunObservation,
} from "./integrationRunsPresentation.ts";

describe("mobile Open Kritt observation-only scope", () => {
  it("labels Open Kritt durable runs and exposes stale read-only details", () => {
    expect(integrationRunSourceLabel("open-kritt")).toBe("Open Kritt");
    expect(
      openKrittObservationPresentation({
        state: "running",
        connectionPhase: "reconnecting",
        findingCount: 2,
      }),
    ).toMatchObject({ stale: true, readOnly: true, findingCount: 2 });
  });

  it("surfaces server-owned scan progress and finding counts on the detail screen", () => {
    expect(
      openKrittRunObservation({
        source: "open-kritt",
        outputSummary:
          "external-scan:scan-77\nOpen Kritt status: running, phase post_processing, 60%, 4 findings, 1 duplicates.",
        projectId: "project-126",
      }),
    ).toEqual({
      isOpenKritt: true,
      upstreamDetail:
        "Open Kritt status: running, phase post_processing, 60%, 4 findings, 1 duplicates.",
      findingCount: 4,
      duplicateCount: 1,
    });
  });

  it("reports no Open Kritt observation for other integration sources", () => {
    expect(
      openKrittRunObservation({
        source: "loopany",
        outputSummary: "Open Kritt status: running.",
        projectId: null,
      }),
    ).toMatchObject({ isOpenKritt: false, upstreamDetail: null });
  });

  it("does not expose launch, remediation, triage, or rescan mutations on mobile", () => {
    expect(openKrittMobileOperations).toEqual([]);
  });
});
