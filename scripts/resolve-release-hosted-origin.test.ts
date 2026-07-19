import { assert, it } from "@effect/vitest";

import { resolveReleaseHostedOrigin } from "./resolve-release-hosted-origin.ts";

it("normalizes valid release hosted app origins", () => {
  assert.equal(
    resolveReleaseHostedOrigin(" https://nightly.app.notcodex.bpro.dev/ "),
    "https://nightly.app.notcodex.bpro.dev",
  );
  assert.equal(resolveReleaseHostedOrigin("https://example.com:443"), "https://example.com");
});

it("rejects release hosted app values that are not HTTPS origins", () => {
  for (const value of [
    "http://app.example.com",
    "https://app.example.com/path",
    "https://app.example.com?channel=stable",
    "https://app.example.com#stable",
    "https://user:password@app.example.com",
    "app.example.com",
  ]) {
    assert.throws(() => resolveReleaseHostedOrigin(value), /Invalid release hosted app origin/);
  }
});
