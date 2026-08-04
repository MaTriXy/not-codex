import { assert, it } from "@effect/vitest";
import { describe, expect, it as test } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { OpenKrittScanRepository } from "./Services/OpenKrittScanRepository.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import {
  comparisonEntry,
  priorScanConfiguration,
  sameOpenKrittConfiguration,
} from "./openKrittComparison.ts";
import { compareFindingSets, fingerprintFinding } from "./openKrittFingerprint.ts";
import { FULL_COMMIT_SHA } from "./test/openKrittTestFixtures.ts";

const CONFIGURATION_SUMMARY = {
  workflowId: "workflow-synthetic-1",
  postScriptIds: ["post-a", "post-b"],
  agentSkillIds: [],
  severityRankerId: null,
  severityRankerContent: "Rank only findings with a concrete production trigger.",
  providerId: "openrouter",
  modelId: "model-synthetic",
  harness: "codex",
  thinkingEffort: "low",
  jobLimit: 8,
} as const;

const NEXT_COMMIT_SHA = "f".repeat(40);

function finding(scanId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `finding-${scanId}`,
    scanId,
    canonical: true,
    duplicateOf: null,
    severity: "high" as const,
    rank: 9,
    type: "command-injection",
    summary: "safe summary",
    explanation: "safe explanation",
    path: "src/example.ts",
    line: 42,
    column: 7,
    triggerFlow: ["step one"],
    maliciousInput: null,
    exploitability: "likely" as const,
    maliciousActor: null,
    rootBug: "root-bug-1",
    triage: "untriaged" as const,
    sourceCommitSha: FULL_COMMIT_SHA,
    snapshotId: null,
    cwe: null,
    cvss: null,
    ...overrides,
  };
}

describe("Open Kritt rescan configuration reuse", () => {
  test("decodes a persisted launch configuration so a rescan can reuse it verbatim", () => {
    expect(priorScanConfiguration(CONFIGURATION_SUMMARY)).toEqual({
      ...CONFIGURATION_SUMMARY,
      postScriptIds: ["post-a", "post-b"],
      agentSkillIds: [],
    });
  });

  test("returns null instead of guessing when no configuration was persisted", () => {
    expect(priorScanConfiguration(undefined)).toBeNull();
    expect(priorScanConfiguration({ workflowId: "only-a-workflow" })).toBeNull();
  });

  test("treats reordered bounded id lists as the same configuration", () => {
    expect(
      sameOpenKrittConfiguration(CONFIGURATION_SUMMARY, {
        ...CONFIGURATION_SUMMARY,
        postScriptIds: ["post-b", "post-a"],
      }),
    ).toBe(true);
  });

  test("treats a changed thinking effort or job limit as a different configuration", () => {
    expect(
      sameOpenKrittConfiguration(CONFIGURATION_SUMMARY, {
        ...CONFIGURATION_SUMMARY,
        thinkingEffort: "high",
      }),
    ).toBe(false);
    expect(
      sameOpenKrittConfiguration(CONFIGURATION_SUMMARY, {
        ...CONFIGURATION_SUMMARY,
        jobLimit: 1,
      }),
    ).toBe(false);
    expect(sameOpenKrittConfiguration(CONFIGURATION_SUMMARY, undefined)).toBe(false);
  });

  test("emits only bounded normalized fields in a comparison entry", () => {
    const entry = comparisonEntry(finding("scan-1"), "fingerprint-1");
    expect(entry).toEqual({
      fingerprint: "fingerprint-1",
      findingId: "finding-scan-1",
      severity: "high",
      type: "command-injection",
      location: { path: "src/example.ts", line: 42, column: 7 },
      summary: "safe summary",
    });
    expect(JSON.stringify(entry)).not.toContain("safe explanation");
  });
});

it.layer(Layer.mergeAll(SqlitePersistenceMemory))("Open Kritt scan comparison", (it) => {
  it.effect("reports a disappeared finding on a changed revision as not proven fixed", () =>
    Effect.gen(function* () {
      const repository = yield* OpenKrittScanRepository;
      yield* runMigrations();

      for (const [index, scanId] of ["scan-prior", "scan-child"].entries()) {
        yield* repository.insertLaunchIntent({
          runId: `run-${scanId}`,
          requestId: `request-${scanId}`,
          environmentId: "environment-1",
          projectId: "project-126",
          source: {
            repoKind: "remote",
            repoFull: "Kritt-ai/open-kritt",
            commitSha: index === 0 ? FULL_COMMIT_SHA : NEXT_COMMIT_SHA,
          },
          configurationSummary: CONFIGURATION_SUMMARY,
          launchResolution: "accepted",
        });
        yield* repository.saveCorrelation({
          requestId: `request-${scanId}`,
          externalScanId: scanId,
          launchResolution: "accepted",
        });
      }
      yield* repository.upsertNormalizedFinding(finding("scan-prior"));

      const prior = yield* repository.listFindings({
        scanId: "scan-prior",
        includeDuplicates: false,
        limit: 200,
        environmentId: "environment-1",
      });
      const priorCorrelation = yield* repository.findByExternalScanId(
        "scan-prior",
        "environment-1",
      );
      const childCorrelation = yield* repository.findByExternalScanId(
        "scan-child",
        "environment-1",
      );
      assert.isNotNull(priorCorrelation);
      assert.isNotNull(childCorrelation);

      const sameSourceRevision =
        priorCorrelation!.source.commitSha === childCorrelation!.source.commitSha;
      const sameConfiguration = sameOpenKrittConfiguration(
        priorCorrelation!.configurationSummary,
        childCorrelation!.configurationSummary,
      );
      assert.isFalse(sameSourceRevision);
      assert.isTrue(sameConfiguration);

      // The child scan reported nothing at all, so absence proves nothing.
      const comparison = compareFindingSets(prior.items, [], {
        sameSourceRevision,
        sameConfiguration,
      });
      assert.equal(comparison.conclusion, "not-reproduced");
      assert.deepEqual(
        comparison.disappeared.map((entry) => entry.fingerprint),
        [fingerprintFinding(finding("scan-prior"))],
      );
    }),
  );

  it.effect("reports a finding that survives a new revision as still present", () =>
    Effect.gen(function* () {
      const repository = yield* OpenKrittScanRepository;
      yield* runMigrations();

      // Findings are only readable through an environment-scoped correlation,
      // so both scans must be linked before they can be compared.
      for (const [index, scanId] of ["scan-a", "scan-b"].entries()) {
        yield* repository.insertLaunchIntent({
          runId: `run-${scanId}`,
          requestId: `request-${scanId}`,
          environmentId: "environment-1",
          projectId: "project-126",
          source: {
            repoKind: "remote",
            repoFull: "Kritt-ai/open-kritt",
            commitSha: index === 0 ? FULL_COMMIT_SHA : NEXT_COMMIT_SHA,
          },
          configurationSummary: CONFIGURATION_SUMMARY,
          launchResolution: "accepted",
        });
        yield* repository.saveCorrelation({
          requestId: `request-${scanId}`,
          externalScanId: scanId,
          launchResolution: "accepted",
        });
      }
      yield* repository.upsertNormalizedFinding(finding("scan-a"));
      yield* repository.upsertNormalizedFinding(finding("scan-b", { id: "finding-scan-b" }));
      const prior = yield* repository.listFindings({
        scanId: "scan-a",
        includeDuplicates: false,
        limit: 200,
      });
      const current = yield* repository.listFindings({
        scanId: "scan-b",
        includeDuplicates: false,
        limit: 200,
      });

      const comparison = compareFindingSets(prior.items, current.items, {
        sameSourceRevision: false,
        sameConfiguration: true,
      });
      assert.equal(comparison.conclusion, "still-present");
      assert.equal(comparison.stillPresent.length, 1);
      assert.equal(comparison.disappeared.length, 0);
    }),
  );
});
