import { describe, expect, it } from "vite-plus/test";

import {
  authorizeOpenKrittOperation,
  OPEN_KRITT_READ_OPERATIONS,
  OPEN_KRITT_OPERATE_OPERATIONS,
} from "./openKrittAuthorization.ts";

describe("Open Kritt RPC authorization", () => {
  it("assigns read scope to observation operations and operate scope to mutations", () => {
    expect(OPEN_KRITT_READ_OPERATIONS).toEqual(
      expect.arrayContaining([
        "integrations.openKritt.runs.list",
        "integrations.openKritt.findings.list",
        "integrations.openKritt.finding.get",
        "integrations.openKritt.scans.compare",
      ]),
    );
    expect(OPEN_KRITT_OPERATE_OPERATIONS).toEqual(
      expect.arrayContaining([
        "integrations.openKritt.configure",
        "integrations.openKritt.scan.launch",
        "integrations.openKritt.remediation.launch",
        "integrations.openKritt.rescan",
      ]),
    );
  });

  it("requires operate scope for the probes that produce outbound Open Kritt requests", () => {
    for (const method of [
      "integrations.openKritt.test",
      "integrations.openKritt.catalog.refresh",
    ]) {
      expect(OPEN_KRITT_READ_OPERATIONS).not.toContain(method);
      expect(OPEN_KRITT_OPERATE_OPERATIONS).toContain(method);
      expect(() => authorizeOpenKrittOperation(method, ["orchestration:read"])).toThrow(
        /operate|scope/i,
      );
      expect(authorizeOpenKrittOperation(method, ["orchestration:operate"])).toBe("operate");
    }
  });

  it("authorizes scan comparison for a read-only session", () => {
    expect(
      authorizeOpenKrittOperation("integrations.openKritt.scans.compare", ["orchestration:read"]),
    ).toBe("read");
  });

  it("rejects read-only sessions for configure, launch, remediation, and rescan", () => {
    for (const method of OPEN_KRITT_OPERATE_OPERATIONS) {
      expect(() => authorizeOpenKrittOperation(method, ["orchestration:read"])).toThrow(
        /operate|scope/i,
      );
    }
  });

  it("does not expose a generic proxy operation", () => {
    expect(() =>
      authorizeOpenKrittOperation("integrations.openKritt.proxy", ["orchestration:operate"]),
    ).toThrow();
  });
});
