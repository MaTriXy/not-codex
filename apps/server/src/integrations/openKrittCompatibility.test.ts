import { describe, expect, it } from "vite-plus/test";

import compatibilityFixture from "./fixtures/open-kritt-v1.2.0.json" with { type: "json" };
import {
  assertOpenKrittCompatibilityFixture,
  OPEN_KRITT_PROTOCOL_COMPATIBILITY,
  openKrittRequestIdReuseRefusal,
} from "./openKrittCompatibility.ts";

describe("Open Kritt v1.2.0 compatibility baseline", () => {
  it("pins the exact release, reviewed source revision, license boundary, and server-version behavior", () => {
    assertOpenKrittCompatibilityFixture(compatibilityFixture);
    expect(OPEN_KRITT_PROTOCOL_COMPATIBILITY.version).toBe("open-kritt-v1.2.0");
    expect(OPEN_KRITT_PROTOCOL_COMPATIBILITY.source.revision).toBe(
      "dabd3d5f82e759bf783955ecc245fea3a984cd38",
    );
    expect(compatibilityFixture.metadata.release).toBe("v1.2.0");
    expect(compatibilityFixture.metadata.license).toBe("AGPL-3.0");
    expect(compatibilityFixture.metadata.serverVersion).toBeNull();
  });

  it("states exactly what the live acceptance run did and did not exercise", () => {
    // The claim must stay weaker than "live-verified": the engine never ran, so
    // the running/post_processing/completed lifecycle and the real vulnerability
    // payload shape are unobserved.
    expect(OPEN_KRITT_PROTOCOL_COMPATIBILITY.verification).toBe("partially-live-verified");
    expect(compatibilityFixture.metadata.verification).toBe("partially-live-verified");
    expect(compatibilityFixture.metadata.verification).not.toBe("live-verified");
    expect(compatibilityFixture.metadata.verificationNote).toMatch(
      /captured from a running Open Kritt v1\.2\.0 deployment at the pinned revision/i,
    );
    // The honest limit of the evidence: no provider credential was configured,
    // so no model-backed scan ran and no claim may imply one did.
    expect(compatibilityFixture.metadata.verificationNote).toMatch(
      /no model-backed vulnerability scan was executed/i,
    );
    expect(compatibilityFixture.metadata.verificationNote).toMatch(
      /running, post_processing, and completed lifecycle states and the real vulnerability payload shape were not observed/i,
    );
    expect(compatibilityFixture.metadata.modelBackedScanVerified).toBe(false);
    expect(OPEN_KRITT_PROTOCOL_COMPATIBILITY.modelBackedScanVerified).toBe(false);
  });

  it("fails closed if the verification claim drifts from the fixture", () => {
    const overclaimed = structuredClone(compatibilityFixture);
    overclaimed.metadata.verification = "documentation-derived";

    expect(() => assertOpenKrittCompatibilityFixture(overclaimed)).toThrow(
      /metadata\.verification/,
    );
  });

  it("pins the health service identity the connector authenticates the endpoint against", () => {
    expect(OPEN_KRITT_PROTOCOL_COMPATIBILITY.serviceIdentity).toBe("open-kritt-backend");
    const drifted = structuredClone(compatibilityFixture);
    drifted.metadata.serviceIdentity = "open-kritt";
    expect(() => assertOpenKrittCompatibilityFixture(drifted)).toThrow(/serviceIdentity/);
  });

  it("keeps every authorization capture synthetic and redacted", () => {
    expect(compatibilityFixture.metadata.authData).toBe("synthetic-and-redacted");
    expect(
      Object.values(compatibilityFixture.endpoints).every(
        (endpoint) => endpoint.authorization === "redacted",
      ),
    ).toBe(true);
    expect(JSON.stringify(compatibilityFixture)).not.toContain("Authorization");
    expect(JSON.stringify(compatibilityFixture)).not.toContain("Bearer ");
    expect(JSON.stringify(compatibilityFixture)).not.toContain("real-");
  });

  it("covers only the documented MVP endpoint allowlist and bounded statuses", () => {
    expect(Object.keys(compatibilityFixture.endpoints)).toEqual([
      "health",
      "workflows",
      "postScripts",
      "agentSkills",
      "severityRankers",
      "modelProviders",
      "modelCatalog",
      "scansCreate",
      "scansList",
      "scanDetail",
      "findingsList",
      "findingDetail",
      "scanMutation",
    ]);
    expect(compatibilityFixture.statuses.scan).toEqual([
      "pending",
      "prewarming_cache",
      "queued",
      "running",
      "post_processing",
      "paused",
      "rate_limited",
      "completed",
      "stopped",
      "failed",
    ]);
    expect(compatibilityFixture.limits.responseBodyBytes).toBeLessThanOrEqual(1_048_576);
  });

  it("fails fixture drift unless the reviewed compatibility baseline is intentionally changed", () => {
    const drifted = structuredClone(compatibilityFixture);
    drifted.metadata.source.revision = "unreviewed-revision";

    expect(() => assertOpenKrittCompatibilityFixture(drifted)).toThrow(
      /compatibility|revision|live acceptance/i,
    );
  });

  it("records the observed request-marker round trip that makes reconciliation possible", () => {
    // The marker is the only defense against a timed-out POST becoming a second
    // paid scan, so the round trip must be recorded as observed, with evidence.
    expect(OPEN_KRITT_PROTOCOL_COMPATIBILITY.markerRoundTripVerified).toBe(true);
    expect(compatibilityFixture.metadata.markerRoundTripEvidence).toMatch(
      /GET \/api\/scans.*marker|marker.*GET \/api\/scans/i,
    );
    expect(
      compatibilityFixture.responses.scans.items[0]?.configuration.not_codex.request_id,
    ).toBeTypeOf("string");

    const drifted = structuredClone(compatibilityFixture);
    drifted.metadata.markerRoundTripVerified = false;
    expect(() => assertOpenKrittCompatibilityFixture(drifted)).toThrow(/markerRoundTripVerified/);
  });

  it("permits reusing a request id now that the marker round trip is observed", () => {
    // A launch-policy 409 creates no scan, and the marker makes an elected retry
    // reconcile to one scan rather than start a second paid one.
    expect(openKrittRequestIdReuseRefusal()).toBeNull();
  });

  it("records the unverified model-backed scan gap as machine-checkable state", () => {
    // Findings decode/normalization have not been exercised against real model
    // output; the flag must stay false until opt-in live acceptance re-captures
    // the vulnerability endpoints from a scan with a known vulnerability.
    expect(OPEN_KRITT_PROTOCOL_COMPATIBILITY.modelBackedScanVerified).toBe(false);
    expect(compatibilityFixture.metadata.modelBackedScanVerified).toBe(false);
    expect(compatibilityFixture.metadata.verificationNote).toMatch(
      /No model-backed vulnerability scan was executed/i,
    );
  });
});
