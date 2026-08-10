import { EnvironmentId } from "@notcodex/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildProviderEnvironmentOptions,
  classifyProviderEnvironmentAccess,
  resolvePrimaryOperateAccess,
  resolveRemoteOperateAccess,
  resolveSelectedProviderEnvironmentId,
} from "./ProviderSettingsPanel.logic";

const primaryId = EnvironmentId.make("primary");
const relayId = EnvironmentId.make("relay");
const sshId = EnvironmentId.make("ssh");
const environments = [
  { environmentId: sshId, label: "Zulu SSH" },
  { environmentId: relayId, label: "Alpha Relay" },
  { environmentId: primaryId, label: "This device" },
] as const;

describe("provider environment selection", () => {
  it("sorts primary first and keeps a valid selection", () => {
    const options = buildProviderEnvironmentOptions(environments, primaryId);
    expect(options.map(({ environmentId }) => environmentId)).toEqual([primaryId, relayId, sshId]);
    expect(resolveSelectedProviderEnvironmentId(options, sshId, primaryId)).toBe(sshId);
  });

  it("falls back to primary, then the first available environment", () => {
    const options = buildProviderEnvironmentOptions(environments, primaryId);
    expect(
      resolveSelectedProviderEnvironmentId(
        options.filter(({ environmentId }) => environmentId !== primaryId),
        primaryId,
        primaryId,
      ),
    ).toBe(relayId);
    expect(resolveSelectedProviderEnvironmentId(options, null, primaryId)).toBe(primaryId);
    expect(resolveSelectedProviderEnvironmentId([], null, primaryId)).toBeNull();
  });
});

describe("provider environment access", () => {
  it("waits for connection, configuration, and permission resolution", () => {
    expect(
      classifyProviderEnvironmentAccess({
        connectionPhase: "reconnecting",
        hasServerConfig: true,
        operateAccess: "granted",
      }),
    ).toEqual({ kind: "unavailable" });
    expect(
      classifyProviderEnvironmentAccess({
        connectionPhase: "connected",
        hasServerConfig: false,
        operateAccess: "granted",
      }),
    ).toEqual({ kind: "loading", reason: "config" });
    expect(
      classifyProviderEnvironmentAccess({
        connectionPhase: "connected",
        hasServerConfig: true,
        operateAccess: "pending",
      }),
    ).toEqual({ kind: "loading", reason: "permissions" });
  });

  it("uses scope-aware access with legacy remote version skew", () => {
    expect(
      resolvePrimaryOperateAccess({
        hasDesktopBridge: false,
        session: { authenticated: true, scopes: [] },
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: true },
        isPending: false,
        hasError: false,
      }),
    ).toBe("granted");
  });

  it("renders known missing access read-only", () => {
    expect(
      classifyProviderEnvironmentAccess({
        connectionPhase: "connected",
        hasServerConfig: true,
        operateAccess: "denied",
      }),
    ).toEqual({ kind: "read-only" });
  });
});
