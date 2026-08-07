import { describe, expect, it } from "vite-plus/test";

import {
  buildOpenKrittFindingUrl,
  normalizeOpenKrittDecodedFinding,
  normalizeOpenKrittFinding,
  sanitizeOpenKrittEvidenceText,
} from "./openKrittFindings.ts";
import { decodeOpenKrittFindingDetail } from "./openKrittSchemas.ts";
import {
  findingResponse,
  FULL_COMMIT_SHA,
  hostileFindingText,
  OPEN_KRITT_TEST_URL,
} from "./test/openKrittTestFixtures.ts";

describe("Open Kritt normalized findings", () => {
  it("normalizes canonical findings with bounded location, severity, exploitability, and source identity", () => {
    const finding = normalizeOpenKrittFinding(
      { ...findingResponse, explanation: hostileFindingText() },
      { commitSha: FULL_COMMIT_SHA, snapshotId: null },
    );

    expect(finding).toMatchObject({
      id: findingResponse.id,
      scanId: findingResponse.scanId,
      canonical: true,
      severity: "high",
      type: "command-injection",
      path: "src/example.ts",
      line: 42,
      // Upstream does not repeat the revision per finding; it comes from the
      // scan, so a finding can never be attributed to the wrong tree.
      sourceCommitSha: FULL_COMMIT_SHA,
    });
    expect(finding.explanation).not.toContain("\u0000");
    expect(finding.explanation.length).toBeLessThanOrEqual(16_000);
  });

  it("preserves duplicate/root-bug metadata without pretending duplicates are canonical findings", () => {
    const duplicate = normalizeOpenKrittFinding({
      ...findingResponse,
      dedupe: { isCanonical: false, canonicalId: "4242", duplicateIds: [] },
      bountyRank: { rootBug: "shared command builder" },
    });

    expect(duplicate.canonical).toBe(false);
    expect(duplicate.duplicateOf).toBe("4242");
    expect(duplicate.rootBug).toBe("shared command builder");
  });

  it("normalizes already-decoded page findings without treating camelCase data as wire input", () => {
    const decoded = decodeOpenKrittFindingDetail(findingResponse);
    const normalized = normalizeOpenKrittDecodedFinding(decoded);

    expect(normalized).toMatchObject({
      id: findingResponse.id,
      scanId: findingResponse.scanId,
      severity: "high",
      exploitability: "likely",
      triage: "untriaged",
    });
  });

  it("sanitizes control characters and bounds hostile upstream fields", () => {
    const sanitized = sanitizeOpenKrittEvidenceText(`${hostileFindingText()}${"x".repeat(20_000)}`);
    expect(
      Array.from(sanitized).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return (
          (codePoint >= 0 && codePoint <= 8) ||
          codePoint === 11 ||
          codePoint === 12 ||
          (codePoint >= 14 && codePoint <= 31) ||
          codePoint === 127
        );
      }),
    ).toBe(false);
    expect(sanitized.length).toBeLessThanOrEqual(16_000);
  });

  it("strips bidirectional-override and zero-width characters that disguise a path", () => {
    // U+202E makes "src/safe.ts" render as a different file than it references.
    const disguised = sanitizeOpenKrittEvidenceText("src/‮st.dettimo‬​ts﻿⁦x⁩");

    expect(disguised).toBe("src/st.dettimotsx");
    for (const codePoint of [0x202e, 0x202c, 0x200b, 0xfeff, 0x2066, 0x2069, 0x061c]) {
      expect(disguised).not.toContain(String.fromCodePoint(codePoint));
    }
  });

  it("builds upstream links only from the configured origin and validated opaque ids", () => {
    expect(buildOpenKrittFindingUrl(OPEN_KRITT_TEST_URL, "scan-1", "finding-1")).toBe(
      `${OPEN_KRITT_TEST_URL}/scans/scan-1/vulnerabilities/finding-1`,
    );
    expect(buildOpenKrittFindingUrl(OPEN_KRITT_TEST_URL, "scan-1", "finding-1")).not.toContain(
      "attacker.example",
    );
    expect(() =>
      buildOpenKrittFindingUrl(OPEN_KRITT_TEST_URL, "scan/../../", "finding-1"),
    ).toThrow();
    expect(() =>
      buildOpenKrittFindingUrl(OPEN_KRITT_TEST_URL, "scan-1", "javascript:alert(1)"),
    ).toThrow();
  });

  it("rejects missing required evidence and oversized collections instead of storing partial findings", () => {
    expect(() => normalizeOpenKrittFinding({ ...findingResponse, id: null })).toThrow();
    expect(() => normalizeOpenKrittFinding({ ...findingResponse, scanId: null })).toThrow();
    // An unrecognized ranker label is normalized, never invented or promoted.
    expect(
      normalizeOpenKrittFinding({
        ...findingResponse,
        severity: null,
        postScriptAnswer: { severity: "not-a-severity" },
      }).severity,
    ).toBe("unknown");
    expect(() =>
      normalizeOpenKrittFinding({
        ...findingResponse,
        trigger_flow: Array.from({ length: 201 }, () => "flow"),
      }),
    ).toThrow();
  });
});
