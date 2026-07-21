import { describe, expect, it } from "vite-plus/test";

import { isLegalDocumentUrl } from "./legal-document-url";

describe("isLegalDocumentUrl", () => {
  it.each([
    "https://notcodex.bpro.dev/legal",
    "https://notcodex.bpro.dev/legal/",
    "https://notcodex.bpro.dev/privacy-policy?source=app",
    "https://notcodex.bpro.dev/terms-of-service#updates",
    "https://notcodex.bpro.dev/security-policy",
  ])("allows a configured legal document: %s", (url) => {
    expect(isLegalDocumentUrl(url)).toBe(true);
  });

  it.each([
    "https://notcodex.bpro.dev/download",
    "https://example.com/legal",
    "javascript:alert(1)",
    "not-a-url",
  ])("rejects a URL outside the legal-document allowlist: %s", (url) => {
    expect(isLegalDocumentUrl(url)).toBe(false);
  });
});
