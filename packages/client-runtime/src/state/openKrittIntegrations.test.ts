import { describe, expect, it } from "vite-plus/test";
import { Atom } from "effect/unstable/reactivity";

import { INTEGRATION_WS_METHODS } from "@notcodex/contracts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createIntegrationEnvironmentAtoms } from "./integrations.ts";

describe("client-runtime Open Kritt integration queries", () => {
  it("exposes typed configure/test/catalog/launch/findings/remediation/rescan commands", () => {
    const runtime = {} as Atom.AtomRuntime<EnvironmentRegistry, never>;
    const atoms = createIntegrationEnvironmentAtoms(runtime);

    expect(atoms).toHaveProperty("configureOpenKritt");
    expect(atoms).toHaveProperty("testOpenKritt");
    expect(atoms).toHaveProperty("refreshOpenKrittCatalog");
    expect(atoms).toHaveProperty("launchOpenKrittScan");
    expect(atoms).toHaveProperty("listOpenKrittFindings");
    expect(atoms).toHaveProperty("getOpenKrittFinding");
    expect(atoms).toHaveProperty("launchOpenKrittRemediation");
    expect(atoms).toHaveProperty("rescanOpenKritt");
  });

  it("uses the explicit server RPC tags and never introduces a direct-fetch URL", () => {
    expect(INTEGRATION_WS_METHODS.launchOpenKrittScan).toBe("integrations.openKritt.scan.launch");
    expect(INTEGRATION_WS_METHODS.listOpenKrittFindings).toBe(
      "integrations.openKritt.findings.list",
    );
    expect(JSON.stringify(INTEGRATION_WS_METHODS)).not.toContain("http");
  });
});
