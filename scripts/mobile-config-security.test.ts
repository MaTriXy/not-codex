// @effect-diagnostics nodeBuiltinImport:off - This test inspects repository config before an Effect runtime exists.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const mobileConfig = NodeFS.readFileSync(
  NodeURL.fileURLToPath(new URL("../apps/mobile/app.config.ts", import.meta.url)),
  "utf8",
);

describe("mobile transport security configuration", () => {
  it("allows local servers without disabling iOS ATS globally", () => {
    expect(mobileConfig).toMatch(
      /NSAppTransportSecurity:\s*\{\s*[^}]*NSAllowsLocalNetworking:\s*true/u,
    );
    expect(mobileConfig).not.toContain("NSAllowsArbitraryLoads");
  });
});
