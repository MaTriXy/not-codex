import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  INTEGRATION_WS_METHODS,
  IntegrationCapability,
  IntegrationId,
  IntegrationRpcSchemas,
  OpenKrittCatalog,
  OpenKrittConfigureInput,
  OpenKrittDiagnostics,
  OpenKrittFinding,
  OpenKrittFindingDetailResult,
  OpenKrittFindingsListInput,
  OpenKrittLaunchScanInput,
  OpenKrittRemediationLaunchInput,
  OpenKrittRescanInput,
  OpenKrittRescanResult,
  OpenKrittSettings,
  OpenKrittSnapshotCreateInput,
  OpenKrittSourceIdentity,
} from "./integrations.ts";
import { ServerSettings } from "./settings.ts";

const decodeUnknown = <S extends Schema.Decoder<any>>(schema: S) =>
  Schema.decodeUnknownSync(schema);

const decodeSettings = (value: unknown) => {
  if (OpenKrittSettings === undefined) throw new Error("Missing OpenKrittSettings implementation");
  return decodeUnknown(OpenKrittSettings)(value);
};
const decodeConfigure = (value: unknown) => {
  if (OpenKrittConfigureInput === undefined)
    throw new Error("Missing OpenKrittConfigureInput implementation");
  return decodeUnknown(OpenKrittConfigureInput)(value);
};
const decodeLaunch = (value: unknown) => {
  if (OpenKrittLaunchScanInput === undefined)
    throw new Error("Missing OpenKrittLaunchScanInput implementation");
  return decodeUnknown(OpenKrittLaunchScanInput)(value);
};
const decodeSource = (value: unknown) => {
  if (OpenKrittSourceIdentity === undefined)
    throw new Error("Missing OpenKrittSourceIdentity implementation");
  return decodeUnknown(OpenKrittSourceIdentity)(value);
};
const decodeFindingsInput = (value: unknown) => {
  if (OpenKrittFindingsListInput === undefined)
    throw new Error("Missing OpenKrittFindingsListInput implementation");
  return decodeUnknown(OpenKrittFindingsListInput)(value);
};
const decodeRemediation = (value: unknown) => {
  if (OpenKrittRemediationLaunchInput === undefined)
    throw new Error("Missing OpenKrittRemediationLaunchInput implementation");
  return decodeUnknown(OpenKrittRemediationLaunchInput)(value);
};
const decodeRescan = (value: unknown) => {
  if (OpenKrittRescanInput === undefined)
    throw new Error("Missing OpenKrittRescanInput implementation");
  return decodeUnknown(OpenKrittRescanInput)(value);
};
const decodeRescanResult = (value: unknown) => decodeUnknown(OpenKrittRescanResult)(value);
const decodeFinding = (value: unknown) => {
  if (OpenKrittFinding === undefined) throw new Error("Missing OpenKrittFinding implementation");
  return decodeUnknown(OpenKrittFinding)(value);
};
const decodeFindingDetail = (value: unknown) => {
  if (OpenKrittFindingDetailResult === undefined)
    throw new Error("Missing OpenKrittFindingDetailResult implementation");
  return decodeUnknown(OpenKrittFindingDetailResult)(value);
};
const decodeDiagnostics = (value: unknown) => {
  if (OpenKrittDiagnostics === undefined)
    throw new Error("Missing OpenKrittDiagnostics implementation");
  return decodeUnknown(OpenKrittDiagnostics)(value);
};
const decodeCatalog = (value: unknown) => {
  if (OpenKrittCatalog === undefined) throw new Error("Missing OpenKrittCatalog implementation");
  return decodeUnknown(OpenKrittCatalog)(value);
};

const fullSha = "dabd3d5f82e759bf783955ecc245fea3a984cd38";

describe("Open Kritt integration contracts", () => {
  it("adds one explicit integration id and only implemented capabilities", () => {
    expect(decodeUnknown(IntegrationId)("open-kritt")).toBe("open-kritt");
    expect(() => decodeUnknown(IntegrationId)("open-kritt-proxy")).toThrow();
    expect(decodeUnknown(IntegrationCapability)("scan")).toBe("scan");
    expect(decodeUnknown(IntegrationCapability)("findings")).toBe("findings");
    expect(decodeUnknown(IntegrationCapability)("rescan")).toBe("rescan");
    expect(() => decodeUnknown(IntegrationCapability)("arbitrary-proxy")).toThrow();
  });

  it("defaults disabled settings without a token or client-controlled secret field", () => {
    expect(decodeSettings({})).toMatchObject({
      enabled: false,
      serverUrl: "",
      authMode: "none",
      snapshotRoot: null,
      pollIntervalSeconds: 15,
      pollConcurrency: 2,
    });
    expect("token" in decodeSettings({})).toBe(false);
    expect("token" in ServerSettings.ast).toBe(false);
  });

  it("represents installation-specific catalog ids as bounded opaque strings", () => {
    const catalog = decodeCatalog({
      workflows: [{ id: "workflow-synthetic-1", name: "Default" }],
      postScripts: [{ id: "post-script-synthetic-1", name: "Default" }],
      agentSkills: [],
      severityRankers: [{ id: "ranker-synthetic-1", name: "Default" }],
      modelProviders: [{ id: "90071992547409931234567890", name: "Provider" }],
    });
    expect(catalog).toMatchObject({
      workflows: [{ id: "workflow-synthetic-1" }],
      modelProviders: [{ id: "90071992547409931234567890" }],
    });
  });

  it("keeps token replacement/clear write-only and bounds settings", () => {
    const configured = decodeConfigure({
      settings: {
        enabled: true,
        serverUrl: "https://kritt.internal.example",
        authMode: "bearer",
        snapshotRoot: "/srv/notcodex/open-kritt-snapshots",
        pollIntervalSeconds: 20,
        pollConcurrency: 3,
      },
      token: "synthetic-token",
    });

    expect(configured.token).toBe("synthetic-token");
    expect("token" in configured.settings).toBe(false);
    expect(() => decodeConfigure({ settings: { serverUrl: "x".repeat(4_097) } })).toThrow();
    expect(() => decodeConfigure({ settings: { pollConcurrency: 0 } })).toThrow();
    expect(() => decodeConfigure({ settings: { pollConcurrency: 65 } })).toThrow();
    expect(() => decodeConfigure({ settings: { snapshotRoot: "relative/path" } })).toThrow();
    expect(() => decodeConfigure({ settings: {}, token: "x".repeat(4_097) })).toThrow();
  });

  it("requires full immutable source identity and rejects arbitrary local paths", () => {
    expect(
      decodeSource({
        kind: "remote",
        repoFull: "Kritt-ai/open-kritt",
        commitSha: fullSha,
      }),
    ).toMatchObject({ commitSha: fullSha });
    expect(() =>
      decodeSource({ kind: "remote", repoFull: "Kritt-ai/open-kritt", commitSha: "dabd3d5" }),
    ).toThrow();
    expect(() =>
      decodeSource({
        kind: "remote",
        repoFull: "https://user:pass@github.com/Kritt-ai/open-kritt?token=1",
        commitSha: fullSha,
      }),
    ).toThrow();
    expect(() =>
      decodeSource({ kind: "local", repoFull: "/Users/alice/project", commitSha: fullSha }),
    ).toThrow();
  });

  it("bounds scan launch configuration and carries a stable opaque request marker", () => {
    const launch = decodeLaunch({
      projectId: "project-126",
      requestId: "nc126-test-request-001",
      source: {
        kind: "remote",
        repoFull: "Kritt-ai/open-kritt",
        commitSha: fullSha,
      },
      configuration: {
        workflowId: "workflow-synthetic-1",
        postScriptIds: ["post-script-synthetic-1"],
        agentSkillIds: ["agent-skill-synthetic-1"],
        severityRankerId: "ranker-synthetic-1",
        providerId: "provider-synthetic-9007199254740993",
        modelId: "model-synthetic-1",
        thinkingEffort: "high",
        jobLimit: 2,
      },
    });

    expect(launch.requestId).toBe("nc126-test-request-001");
    expect(typeof launch.configuration.providerId).toBe("string");
    expect(() => decodeLaunch({ ...launch, requestId: "contains spaces" })).toThrow();
    expect(() =>
      decodeLaunch({
        ...launch,
        configuration: { ...launch.configuration, postScriptIds: Array(65).fill("id") },
      }),
    ).toThrow();
  });

  it("supports safe findings pagination and keeps duplicate metadata explicit", () => {
    expect(decodeFindingsInput({ scanId: "scan-1", limit: 100, includeDuplicates: false })).toEqual(
      {
        scanId: "scan-1",
        limit: 100,
        cursor: null,
        includeDuplicates: false,
      },
    );
    expect(() => decodeFindingsInput({ scanId: "scan-1", limit: 0 })).toThrow();
    expect(() => decodeFindingsInput({ scanId: "scan-1", limit: 201 })).toThrow();

    const finding = decodeFinding({
      id: "90071992547409931234567890",
      scanId: "scan-1",
      severity: "high",
      rank: 9,
      type: "command-injection",
      summary: "bounded summary",
      explanation: "bounded explanation",
      location: { path: "src/example.ts", line: 42, column: 7 },
      triggerFlow: ["request -> shell"],
      maliciousInput: "$(id)",
      exploitability: "likely",
      maliciousActor: "unauthenticated-user",
      canonical: false,
      duplicateOf: "finding-canonical",
      rootBug: "root-bug-1",
      triage: "untriaged",
      source: { commitSha: fullSha, snapshotId: null },
    });
    expect(finding.id).toBe("90071992547409931234567890");
    expect(finding.canonical).toBe(false);
    expect(finding.duplicateOf).toBe("finding-canonical");
  });

  it("makes diagnostics stale/read-only data safe and bounded", () => {
    const diagnostics = decodeDiagnostics({
      health: "stale",
      lastSuccessfulContact: "2026-08-04T10:00:00.000Z",
      nextRetryAt: "2026-08-04T10:00:03.000Z",
      compatibilityVersion: "open-kritt-v1.2.0",
      serverVersion: null,
      recentEvents: [],
    });
    expect(diagnostics.serverVersion).toBeNull();
    expect(() =>
      decodeDiagnostics({
        ...diagnostics,
        recentEvents: Array.from({ length: 51 }, () => ({})),
      }),
    ).toThrow();
  });

  it("carries bounded evidence into ordinary remediation and requires a new revision for rescan", () => {
    const remediation = decodeRemediation({
      projectId: "project-126",
      findingId: "finding-1",
      targetCommitSha: fullSha,
      modelSelection: { instanceId: "codex", model: "gpt-5" },
      runtimeMode: "approval-required",
      evidence: {
        type: "command-injection",
        severity: "high",
        summary: "Untrusted summary",
        explanation: "Untrusted explanation",
        path: "src/example.ts",
        line: 42,
        triggerFlow: ["request -> shell"],
        maliciousInput: "$(id)",
      },
      worktreePreference: "from-exact-commit",
    });
    expect(remediation.targetCommitSha).toBe(fullSha);
    expect(() =>
      decodeRemediation({
        ...remediation,
        evidence: { ...remediation.evidence, summary: "x".repeat(16_001) },
      }),
    ).toThrow();

    const rescan = decodeRescan({
      projectId: "project-126",
      priorScanId: "scan-1",
      priorRunId: "run-1",
      requestId: "nc126-rescan-001",
      source: { kind: "remote", repoFull: "Kritt-ai/open-kritt", commitSha: fullSha },
      configurationConfirmed: true,
      launchPolicy: "immediate",
    });
    expect(rescan.priorScanId).toBe("scan-1");
    expect(rescan.launchPolicy).toBe("immediate");
    expect(() =>
      decodeRescan({ ...rescan, source: { ...rescan.source, commitSha: "dabd3d5" } }),
    ).toThrow();

    expect(
      decodeRescanResult({
        childRunId: "run-rescan-1",
        externalScanId: null,
        launchResolution: "policy-required",
        policyChoices: ["immediate", "queue"],
        fieldErrors: [{ field: "workflow_id", message: "Choose a workflow." }],
        configuration: {
          workflowId: "workflow-synthetic-1",
          postScriptIds: ["post-script-synthetic-1"],
          agentSkillIds: [],
          severityRankerId: "ranker-synthetic-1",
          providerId: "provider-synthetic-1",
          modelId: "model-synthetic-1",
          thinkingEffort: "high",
          jobLimit: 1,
        },
        reusedPriorConfiguration: true,
      }),
    ).toMatchObject({
      launchResolution: "policy-required",
      policyChoices: ["immediate", "queue"],
      fieldErrors: [{ field: "workflow_id" }],
    });
  });

  it("models finding detail as a safe result rather than exposing raw upstream blobs", () => {
    const detail = decodeFindingDetail({
      finding: {
        id: "finding-1",
        scanId: "scan-1",
        severity: "medium",
        rank: 5,
        type: "xss",
        summary: "summary",
        explanation: "explanation",
        location: { path: "src/a.ts", line: 1, column: null },
        triggerFlow: [],
        maliciousInput: null,
        exploitability: "unknown",
        maliciousActor: "user",
        canonical: true,
        duplicateOf: null,
        rootBug: null,
        triage: "untriaged",
        source: { commitSha: fullSha, snapshotId: null },
      },
      upstreamUrl: "https://kritt.internal.example/scans/scan-1/vulnerabilities/finding-1",
      stale: false,
    });
    expect(detail).not.toHaveProperty("jsonAnswer");
    expect(detail.upstreamUrl).toMatch(/^https:\/\//);
  });

  it("binds a local snapshot confirmation to the reviewed manifest digest", () => {
    const decode = decodeUnknown(OpenKrittSnapshotCreateInput);
    expect(
      decode({
        projectId: "project-126",
        confirmSafeForProvider: true,
        acknowledgedManifestDigest: "a".repeat(64),
      }),
    ).toMatchObject({ acknowledgedManifestDigest: "a".repeat(64) });
    // A confirmation with no reviewed digest would let the server publish
    // whatever the workspace happens to contain at create time.
    expect(() => decode({ projectId: "project-126", confirmSafeForProvider: true })).toThrow();
    expect(() =>
      decode({
        projectId: "project-126",
        confirmSafeForProvider: true,
        acknowledgedManifestDigest: "",
      }),
    ).toThrow();
  });

  it("declares explicit RPC operations instead of a generic upstream proxy", () => {
    expect(INTEGRATION_WS_METHODS).toMatchObject({
      configureOpenKritt: "integrations.openKritt.configure",
      testOpenKritt: "integrations.openKritt.test",
      refreshOpenKrittCatalog: "integrations.openKritt.catalog.refresh",
      launchOpenKrittScan: "integrations.openKritt.scan.launch",
      listOpenKrittFindings: "integrations.openKritt.findings.list",
      getOpenKrittFinding: "integrations.openKritt.finding.get",
      launchOpenKrittRemediation: "integrations.openKritt.remediation.launch",
      rescanOpenKritt: "integrations.openKritt.rescan",
    });
    expect(IntegrationRpcSchemas).not.toHaveProperty("proxy");
  });
});
