import { describe, expect, it } from "vite-plus/test";

import { makeBrowserAppContentSecurityPolicy } from "./browserContentSecurityPolicy.ts";

describe("browser app Content-Security-Policy", () => {
  it("allows every Clerk browser resource when Clerk is configured", () => {
    const policy = makeBrowserAppContentSecurityPolicy("https://clerk.notcodex.test");

    expect(policy).toContain(
      "script-src 'self' https://clerk.notcodex.test https://challenges.cloudflare.com https://*.protect.clerk.com",
    );
    expect(policy).toContain(
      "frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com",
    );
    expect(policy).toContain("img-src 'self' data: blob: https://img.clerk.com");
  });

  it("does not allow Clerk resources when Clerk is not configured", () => {
    const policy = makeBrowserAppContentSecurityPolicy();

    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("frame-src 'self'");
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(policy).not.toContain("clerk.com");
    expect(policy).not.toContain("cloudflare.com");
  });
});
