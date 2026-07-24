import { describe, expect, it } from "vite-plus/test";

import { resolveConnectOnboardingSignInRequest } from "./useConnectOnboardingSignInRequest";

describe("resolveConnectOnboardingSignInRequest", () => {
  it("does not treat a restored account as a new in-session sign-in", () => {
    expect(resolveConnectOnboardingSignInRequest(undefined, "account-1", null)).toBeNull();
  });

  it("captures a sign-in or account switch while the dialog chunk is loading", () => {
    expect(resolveConnectOnboardingSignInRequest(null, "account-1", null)).toBe("account-1");
    expect(resolveConnectOnboardingSignInRequest("account-1", "account-2", null)).toBe("account-2");
  });

  it("retains an unconsumed request until the account changes", () => {
    expect(resolveConnectOnboardingSignInRequest("account-1", "account-1", "account-1")).toBe(
      "account-1",
    );
  });

  it("clears a pending request on sign-out", () => {
    expect(resolveConnectOnboardingSignInRequest("account-1", null, "account-1")).toBeNull();
  });
});
