import { describe, expect, it } from "vite-plus/test";

import compatibilityFixture from "./fixtures/open-kritt-v1.2.0.json" with { type: "json" };
import {
  decodeOpenKrittCatalog,
  decodeOpenKrittErrorResponse,
  decodeOpenKrittFindingDetail,
  decodeOpenKrittFindings,
  decodeOpenKrittHealth,
  decodeOpenKrittScan,
  decodeOpenKrittScanList,
} from "./openKrittSchemas.ts";

const responses = compatibilityFixture.responses;
const findingFixture = responses.findings[0]!;
const catalogInput = {
  workflows: responses.workflows,
  postScripts: responses.postScripts,
  agentSkills: responses.agentSkills,
  severityRankers: responses.severityRankers,
  modelProviders: responses.modelProviders,
  modelCatalog: responses.modelCatalog,
};

describe("Open Kritt protocol decoders", () => {
  it("decodes every live-captured health, catalog, scan, findings, and error fixture", () => {
    expect(decodeOpenKrittHealth(responses.health)).toMatchObject({
      service: "open-kritt-backend",
    });
    const catalog = decodeOpenKrittCatalog(catalogInput);
    expect(catalog.workflows[0]?.id).toBe(responses.workflows[0]!.id);
    // Severity rankers are selected by content at launch, so the body must
    // survive discovery rather than being reduced to an id.
    expect(catalog.severityRankers[0]?.content).toBeTypeOf("string");
    expect(catalog.modelProviders.map((provider) => provider.id)).toEqual(
      responses.modelProviders.providers,
    );
    expect(decodeOpenKrittScan(responses.scan)).toMatchObject({
      id: responses.scan.id,
      status: responses.scan.status,
      source: { repoKind: "remote", repoFull: responses.scan.repoFull },
    });
    const list = decodeOpenKrittScanList(responses.scans);
    expect(list.items[0]?.id).toBe(responses.scans.items[0]!.id);
    expect(list.totalPages).toBe(responses.scans.totalPages);
    expect(decodeOpenKrittFindings(responses.findings)).toMatchObject({
      items: [{ id: findingFixture.id, scanId: findingFixture.scanId }],
    });
    expect(decodeOpenKrittFindingDetail(responses.finding)).toMatchObject({
      id: responses.finding.id,
      severity: "high",
      cwe: "CWE-78",
      cvss: 8.1,
      exploitability: "likely",
      type: "command-injection",
      canonical: true,
    });
    expect(
      decodeOpenKrittErrorResponse(compatibilityFixture.errors.validation.body).fieldErrors[0],
    ).toMatchObject({ field: "workflowId", message: "A workflow is required." });
    expect(
      decodeOpenKrittErrorResponse(compatibilityFixture.errors.launchPolicyRequired.body).code,
    ).toBe("scan_launch_policy_required");
  });

  it("accepts the unpaginated scan list Open Kritt returns without page parameters", () => {
    expect(decodeOpenKrittScanList([responses.scan])).toMatchObject({
      items: [{ id: responses.scan.id }],
      totalPages: null,
    });
  });

  it("never carries raw upstream blobs across the boundary", () => {
    const decoded = decodeOpenKrittFindingDetail({
      ...responses.finding,
      id: "90071992547409931234567890",
      jsonAnswer: { prompt: "must never persist" },
      arbitraryEnrichment: { secret: "do not cross boundary" },
    });

    expect(decoded.id).toBe("90071992547409931234567890");
    expect(typeof decoded.id).toBe("string");
    expect(decoded).not.toHaveProperty("jsonAnswer");
    expect(decoded).not.toHaveProperty("postScriptAnswer");
    expect(decoded).not.toHaveProperty("arbitraryEnrichment");
  });

  it("normalizes model-authored severity, exploitability, and triage instead of trusting them", () => {
    const unranked = decodeOpenKrittFindingDetail({
      ...responses.finding,
      rank: null,
      interesting: 0,
      exploitable: false,
      postScriptAnswer: { severity: "SEV-BOGUS" },
      severity: null,
    });
    expect(unranked).toMatchObject({
      rank: null,
      triage: "uninteresting",
      exploitability: "unlikely",
      severity: "unknown",
    });

    expect(
      decodeOpenKrittFindingDetail({ ...responses.finding, exploitable: null, interesting: null }),
    ).toMatchObject({ exploitability: "unknown", triage: "untriaged" });
  });

  it("tolerates the nullable answer fields a model workflow may omit", () => {
    const sparse = decodeOpenKrittFindingDetail({
      id: "77",
      scanId: responses.finding.scanId,
      rank: null,
      trigger_flow: [],
      dedupe: { isCanonical: null, canonicalId: null },
    });
    expect(sparse).toMatchObject({
      type: "unclassified",
      summary: "",
      explanation: "",
      location: { path: "", line: null },
      // `isCanonical: null` means "dedupe has not run", which is not a duplicate.
      canonical: true,
    });
  });

  it("rejects a foreign service identity", () => {
    expect(() => decodeOpenKrittHealth({ status: "ok" })).toThrow();
    expect(() => decodeOpenKrittHealth({ status: "ok", service: "something-else" })).toThrow();
  });

  it("rejects impossible scan statuses and malformed progress", () => {
    expect(() => decodeOpenKrittScan({ ...responses.scan, status: "invented" })).toThrow();
    expect(() => decodeOpenKrittScan({ ...responses.scan, progress: 42 })).toThrow();
    expect(decodeOpenKrittScan({ ...responses.scan, progress: "42%" }).progress).toBe(42);
  });

  it("rejects a remote scan without a full commit SHA", () => {
    expect(() => decodeOpenKrittScan({ ...responses.scan, commitSha: null })).toThrow();
    expect(() => decodeOpenKrittScan({ ...responses.scan, commitSha: "dabd3d5" })).toThrow();
  });

  it("rejects invalid finding ranks and locations", () => {
    expect(() => decodeOpenKrittFindingDetail({ ...responses.finding, rank: -1 })).toThrow();
    expect(() => decodeOpenKrittFindingDetail({ ...responses.finding, file_path: 42 })).toThrow();
  });

  it("rejects oversized fields and collections before they reach persistence", () => {
    expect(() =>
      decodeOpenKrittFindingDetail({ ...responses.finding, explanation: "x".repeat(16_001) }),
    ).toThrow(/protocol|size|length|oversized/i);
    expect(() =>
      decodeOpenKrittFindings(Array.from({ length: 201 }, () => findingFixture)),
    ).toThrow(/protocol|size|length|oversized/i);
  });

  it("treats external identifiers beyond the JS safe integer range as strings", () => {
    const decoded = decodeOpenKrittScan({ ...responses.scan, id: "9007199254740993" });
    expect(decoded.id).toBe("9007199254740993");
  });

  it("rejects malformed bodies through a sanitized protocol error", () => {
    expect(() => decodeOpenKrittCatalog({ ...catalogInput, workflows: "not-an-array" })).toThrow(
      /protocol|response|invalid/i,
    );
    expect(() => decodeOpenKrittScanList("not-json")).toThrow(/protocol|response|invalid/i);
    expect(() => decodeOpenKrittErrorResponse("not-json")).toThrow(/protocol|response|invalid/i);
  });
});
