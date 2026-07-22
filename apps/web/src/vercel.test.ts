import { describe, expect, it } from "vite-plus/test";

import { makeHostedWebContentSecurityPolicy } from "../vercel.ts";

describe("hosted web Content-Security-Policy", () => {
  it("allows the configured Clerk origin and Cloudflare challenge resources", () => {
    const policy = makeHostedWebContentSecurityPolicy("https://clerk.notcodex.test");

    expect(policy).toContain(
      "script-src 'self' https://clerk.notcodex.test https://challenges.cloudflare.com",
    );
    expect(policy).toContain("frame-src 'self' https://challenges.cloudflare.com");
  });
});
