import { describe, expect, it } from "vite-plus/test";

import {
  buildSecurityFindingRows,
  canRescanFromRun,
  deriveProjectSecurityEmptyState,
  deriveProjectSecurityStaleness,
  deriveRescanSource,
  deriveScanComparisonPair,
  formatSecuritySourceIdentity,
  securityComparisonLabel,
} from "./ProjectSecurityPage.tsx";

describe("Project Security presentation", () => {
  it("explains disconnected Open Kritt setup without presenting a launch control", () => {
    expect(
      deriveProjectSecurityEmptyState({ connectorState: "disabled", projectId: "project-1" }),
    ).toEqual({
      kind: "not-configured",
      message: expect.stringMatching(/connect|Open Kritt/i),
      canLaunch: false,
    });
  });

  it("shows immutable source identity and dirty/unpushed warnings", () => {
    expect(
      formatSecuritySourceIdentity({
        repoFull: "Kritt-ai/open-kritt",
        commitSha: "dabd3d5f82e759bf783955ecc245fea3a984cd38",
        dirty: true,
        unpushed: true,
      }),
    ).toEqual({
      label: "Kritt-ai/open-kritt @ dabd3d5f",
      warnings: expect.arrayContaining([
        expect.stringMatching(/dirty|uncommitted/i),
        expect.stringMatching(/unpushed/i),
      ]),
    });
  });

  it("renders canonical findings in a bounded severity/location table without raw blobs", () => {
    const rows = buildSecurityFindingRows({
      items: [
        {
          id: "finding-9007199254740993",
          canonical: true,
          duplicateOf: null,
          severity: "high",
          rank: 9,
          type: "command-injection",
          path: "src/example.ts",
          line: 42,
          summary: "safe summary",
          exploitability: "likely",
          triage: "untriaged",
        },
      ],
      includeDuplicates: false,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        id: "finding-9007199254740993",
        severityLabel: expect.stringMatching(/high/i),
        locationLabel: "src/example.ts:42",
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain("jsonAnswer");
  });

  it("marks cached observations stale during reconnect and preserves them read-only", () => {
    expect(
      deriveProjectSecurityStaleness({
        connectionPhase: "connected",
        lastUpdatedAt: "2026-08-04T10:00:00.000Z",
      }),
    ).toEqual({
      stale: false,
      readOnly: false,
    });
    expect(
      deriveProjectSecurityStaleness({
        connectionPhase: "reconnecting",
        lastUpdatedAt: "2026-08-04T10:00:00.000Z",
      }),
    ).toEqual({
      stale: true,
      readOnly: true,
    });
  });

  it("distinguishes not reproduced, still present, and uncertain rescan comparisons", () => {
    expect(securityComparisonLabel("not-reproduced")).toMatch(/not reproduced/i);
    expect(securityComparisonLabel("still-present")).toMatch(/still present/i);
    expect(securityComparisonLabel("uncertain")).toMatch(/uncertain|not proven/i);
    expect(securityComparisonLabel("proven-fixed")).toMatch(/proven fixed/i);
  });

  it("pairs the two most recent linked scans and never offers a self-comparison", () => {
    expect(
      deriveScanComparisonPair([
        { outputSummary: "external-scan:scan-2\nOpen Kritt status: completed." },
        { outputSummary: "external-scan:scan-1" },
      ]),
    ).toEqual({ currentScanId: "scan-2", priorScanId: "scan-1" });
    expect(deriveScanComparisonPair([{ outputSummary: "external-scan:scan-1" }])).toBeNull();
    // A repeated external id (two runs of one scan) is not a comparable pair.
    expect(
      deriveScanComparisonPair([
        { outputSummary: "external-scan:scan-1" },
        { outputSummary: "external-scan:scan-1" },
      ]),
    ).toBeNull();
    expect(deriveScanComparisonPair([{ outputSummary: null }])).toBeNull();
  });

  it("offers a rescan only from a terminal scan", () => {
    expect(canRescanFromRun({ state: "succeeded" })).toBe(true);
    expect(canRescanFromRun({ state: "failed" })).toBe(true);
    expect(canRescanFromRun({ state: "cancelled" })).toBe(true);
    expect(canRescanFromRun({ state: "running" })).toBe(false);
    expect(canRescanFromRun({ state: "queued" })).toBe(false);
    expect(canRescanFromRun({ state: "waiting" })).toBe(false);
  });

  it("requires a new immutable revision or reviewed snapshot before a rescan", () => {
    const sha = "a".repeat(40);
    expect(
      deriveRescanSource({ localSnapshotSource: null, repository: "owner/repo", commitSha: sha }),
    ).toEqual({ kind: "remote", repoFull: "owner/repo", commitSha: sha });
    // Abbreviated, moving, and empty revisions are all refused client-side too.
    expect(
      deriveRescanSource({
        localSnapshotSource: null,
        repository: "owner/repo",
        commitSha: "HEAD",
      }),
    ).toBeNull();
    expect(
      deriveRescanSource({
        localSnapshotSource: null,
        repository: "owner/repo",
        commitSha: sha.slice(0, 8),
      }),
    ).toBeNull();
    expect(
      deriveRescanSource({ localSnapshotSource: null, repository: null, commitSha: sha }),
    ).toBeNull();
    // A reviewed local snapshot is itself a new immutable source.
    expect(
      deriveRescanSource({
        localSnapshotSource: { kind: "local", snapshotId: "snapshot-1", commitSha: null },
        repository: null,
        commitSha: "",
      }),
    ).toEqual({ kind: "local", snapshotId: "snapshot-1", commitSha: null });
  });
});
