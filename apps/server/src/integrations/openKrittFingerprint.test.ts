import { describe, expect, it } from "vite-plus/test";

import { compareFindingSets, fingerprintFinding } from "./openKrittFingerprint.ts";

const finding = (overrides: Record<string, unknown> = {}) => ({
  id: "finding-1",
  scanId: "scan-1",
  type: "command-injection",
  path: "src/example.ts",
  line: 42,
  column: 7,
  rootBug: "root-bug-1",
  duplicateOf: null,
  canonical: true,
  ...overrides,
});

describe("Open Kritt stable finding fingerprints", () => {
  it("normalizes stable path/type metadata and ignores volatile model labels and ids", () => {
    expect(fingerprintFinding(finding({ id: "finding-a" }))).toBe(
      fingerprintFinding(finding({ id: "finding-b", scanId: "scan-2" })),
    );
    expect(
      fingerprintFinding(finding({ path: "./src/../src/example.ts", type: "Command Injection" })),
    ).toBe(fingerprintFinding(finding()));
    expect(fingerprintFinding(finding({ line: 42, column: 7 }))).toBe(
      fingerprintFinding(finding({ line: 96, column: 2 })),
    );
    expect(fingerprintFinding(finding({ rootBug: "unsafe shell builder" }))).toBe(
      fingerprintFinding(finding({ rootBug: "command construction flaw", duplicateOf: "other" })),
    );
  });

  it("matches a surviving finding after preceding edits shift its coordinates", () => {
    expect(
      compareFindingSets([finding({ line: 42, column: 7 })], [finding({ line: 96, column: 2 })], {
        sameSourceRevision: false,
        sameConfiguration: true,
      }),
    ).toMatchObject({
      conclusion: "still-present",
      disappeared: [],
      stillPresent: [expect.objectContaining({ fingerprint: expect.any(String) })],
    });
  });

  it("distinguishes still-present, not-reproduced, and uncertain comparisons", () => {
    const prior = [finding({ id: "finding-prior" })];
    const stillPresent = [finding({ id: "finding-new" })];
    expect(compareFindingSets(prior, stillPresent)).toMatchObject({
      stillPresent: [expect.objectContaining({ fingerprint: expect.any(String) })],
      disappeared: [],
      conclusion: "still-present",
    });
    expect(compareFindingSets(prior, [])).toMatchObject({
      disappeared: [expect.objectContaining({ fingerprint: expect.any(String) })],
      conclusion: "not-reproduced",
    });
  });

  it("never reports proven fixed for a disappeared finding on a changed revision with no new findings", () => {
    expect(
      compareFindingSets([finding()], [], {
        sameSourceRevision: false,
        sameConfiguration: true,
      }),
    ).toMatchObject({
      conclusion: "not-reproduced",
      reason: expect.stringMatching(/not proof of a fix/i),
    });
  });

  it("never reports proven fixed when the source revision did not change", () => {
    expect(
      compareFindingSets([finding()], [finding({ path: "src/other.ts" })], {
        sameSourceRevision: true,
        sameConfiguration: true,
      }),
    ).toMatchObject({
      conclusion: "not-reproduced",
      reason: expect.stringMatching(/revision did not change/i),
    });
  });

  it("reports uncertain when the scan configuration or scope changed", () => {
    expect(
      compareFindingSets([finding()], [], {
        sameSourceRevision: true,
        sameConfiguration: false,
      }),
    ).toMatchObject({
      conclusion: "uncertain",
      reason: expect.stringMatching(/configuration|scope/i),
    });
  });

  it("reports proven fixed only for a new revision, identical configuration, and an effective scan", () => {
    expect(
      compareFindingSets([finding()], [finding({ path: "src/other.ts", line: 3 })], {
        sameSourceRevision: false,
        sameConfiguration: true,
      }),
    ).toMatchObject({ conclusion: "proven-fixed" });
  });

  it("reports uncertain when the prior scan had no comparable findings", () => {
    expect(compareFindingSets([], [finding()], { sameSourceRevision: true })).toMatchObject({
      conclusion: "uncertain",
      reason: expect.stringMatching(/no comparable findings/i),
    });
  });
});
