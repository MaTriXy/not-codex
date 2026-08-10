import { describe, expect, it } from "vite-plus/test";

import { resolveClerkSignInProps } from "./authRedirect";

describe("resolveClerkSignInProps", () => {
  it("returns to the current browser URL on the web", () => {
    const href = "https://app.notcodex.test/connect?state=state-1#details";
    expect(resolveClerkSignInProps(href, false)).toEqual({ forceRedirectUrl: href });
  });

  it("removes Clerk virtual paths and callback params while preserving the desktop route", () => {
    expect(
      resolveClerkSignInProps(
        "notcodex://app/CLERK-ROUTER/VIRTUAL/sign-up?__clerk_status=complete#/connect?request=1",
        true,
      ),
    ).toEqual({
      forceRedirectUrl: "notcodex://app/#/connect?request=1",
      signUpForceRedirectUrl: "notcodex://app/#/connect?request=1",
    });
  });

  it("preserves a clean development desktop route", () => {
    expect(resolveClerkSignInProps("notcodex-dev://app/#/connect", true)).toEqual({
      forceRedirectUrl: "notcodex-dev://app/#/connect",
      signUpForceRedirectUrl: "notcodex-dev://app/#/connect",
    });
  });
});
