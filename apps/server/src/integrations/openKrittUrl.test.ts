import { describe, expect, it } from "vite-plus/test";

import {
  buildOpenKrittRequestUrl,
  isOpenKrittLoopbackUrl,
  isOpenKrittResolvedAddressAllowed,
  normalizeOpenKrittBasePath,
  normalizeOpenKrittServerUrl,
  parseOpenKrittAllowedAddress,
  parseOpenKrittServerBase,
  stripOpenKrittBasePath,
  validateOpenKrittRedirect,
} from "./openKrittUrl.ts";

describe("Open Kritt URL and SSRF policy", () => {
  it("accepts HTTPS for non-loopback and normalizes only an origin", () => {
    expect(normalizeOpenKrittServerUrl(" https://kritt.example.test/ ")).toBe(
      "https://kritt.example.test",
    );
    expect(normalizeOpenKrittServerUrl("http://127.0.0.1:8765")).toBe("http://127.0.0.1:8765");
  });

  it("preserves a reverse-proxy base path instead of silently discarding it", () => {
    // The recommended way to authenticate an upstream that ships unauthenticated
    // is an operator-run reverse proxy, which commonly terminates at a subpath.
    expect(normalizeOpenKrittServerUrl("https://ops.example.test/kritt/")).toBe(
      "https://ops.example.test/kritt",
    );
    expect(normalizeOpenKrittServerUrl("https://ops.example.test/a/b")).toBe(
      "https://ops.example.test/a/b",
    );
    expect(parseOpenKrittServerBase("https://ops.example.test/kritt")).toEqual({
      origin: "https://ops.example.test",
      basePath: "/kritt",
    });
    expect(parseOpenKrittServerBase("https://ops.example.test")).toEqual({
      origin: "https://ops.example.test",
      basePath: "",
    });
  });

  it("collapses traversal to the literal prefix the operator actually approved", () => {
    // The URL parser resolves `.`/`..` before the prefix is read, so the stored
    // base is the collapsed path; the operator sees exactly what will be used.
    expect(normalizeOpenKrittServerUrl("https://ops.example.test/kritt/../admin")).toBe(
      "https://ops.example.test/admin",
    );
    // The segment guard still rejects traversal handed in directly.
    expect(() => normalizeOpenKrittBasePath("/kritt/../admin")).toThrow();
    expect(() => normalizeOpenKrittBasePath("/kritt/./admin")).toThrow();
  });

  it.each([
    "https://ops.example.test/kr%2Fitt",
    "https://ops.example.test/a/b/c/d/e/f/g/h/i",
    "https://ops.example.test/kritt space",
  ])("rejects an unsafe base path %s", (value) => {
    expect(() => normalizeOpenKrittServerUrl(value)).toThrow();
  });

  it("prefixes request paths with the approved base path", () => {
    expect(
      buildOpenKrittRequestUrl("https://ops.example.test/kritt", "/api/scans").toString(),
    ).toBe("https://ops.example.test/kritt/api/scans");
    expect(buildOpenKrittRequestUrl("https://ops.example.test", "/api/scans").toString()).toBe(
      "https://ops.example.test/api/scans",
    );
    expect(() => buildOpenKrittRequestUrl("https://ops.example.test/kritt", "api/scans")).toThrow();
    expect(() => buildOpenKrittRequestUrl("https://ops.example.test/kritt", "/api#frag")).toThrow();
  });

  it("confines redirects and follow-up paths to the approved base path", () => {
    const base = "https://ops.example.test/kritt";
    expect(validateOpenKrittRedirect(base, "/kritt/api/scans/")).toBe(
      "https://ops.example.test/kritt/api/scans/",
    );
    // Same-origin but outside the approved prefix is exactly what the prefix exists to stop.
    expect(() => validateOpenKrittRedirect(base, "/admin")).toThrow();
    expect(() => validateOpenKrittRedirect(base, "/krittle/api")).toThrow();
    expect(stripOpenKrittBasePath("/kritt/api/scans", "/kritt")).toBe("/api/scans");
    expect(stripOpenKrittBasePath("/kritt", "/kritt")).toBe("/");
    expect(stripOpenKrittBasePath("/api/scans", "")).toBe("/api/scans");
    expect(() => stripOpenKrittBasePath("/admin", "/kritt")).toThrow();
  });

  it("identifies only loopback hosts for the explicit private-network acknowledgement", () => {
    expect(isOpenKrittLoopbackUrl("http://localhost:8765")).toBe(true);
    expect(isOpenKrittLoopbackUrl("https://[::1]:8765")).toBe(true);
    expect(isOpenKrittLoopbackUrl("https://kritt.example.test")).toBe(false);
    expect(isOpenKrittLoopbackUrl("not-a-url")).toBe(false);
  });

  it.each([
    "ftp://kritt.example.test",
    "file:///tmp/kritt",
    "https://user:pass@kritt.example.test",
    "https://kritt.example.test/#fragment",
    "https://kritt.example.test/?secret=1",
    "http://kritt.example.test",
    "http://[fe80::1]:8765",
    "https://",
  ])("rejects unsafe server URL %s", (value) => {
    expect(() => normalizeOpenKrittServerUrl(value)).toThrow();
  });

  it("accepts plain HTTP for IPv6 loopback, which is as private as 127.0.0.1", () => {
    expect(normalizeOpenKrittServerUrl("http://[::1]:8765")).toBe("http://[::1]:8765");
  });

  it("rejects redirects that change scheme, host, port, origin, or introduce credentials", () => {
    const origin = "https://kritt.example.test";
    expect(validateOpenKrittRedirect(origin, "/api/scans")).toBe(origin + "/api/scans");
    for (const target of [
      "http://kritt.example.test/api/scans",
      "https://other.example.test/api/scans",
      "https://kritt.example.test:8444/api/scans",
      "https://user:pass@kritt.example.test/api/scans",
      "//other.example.test/api/scans",
    ]) {
      expect(() => validateOpenKrittRedirect(origin, target)).toThrow();
    }
  });

  it.each([
    ["127.0.0.1", true],
    ["::1", true],
    ["10.0.0.8", false],
    ["172.16.10.2", false],
    ["192.168.1.8", false],
    ["169.254.169.254", false],
    ["100.64.0.1", false],
    ["224.0.0.1", false],
    ["8.8.8.8", true],
  ])("applies the approved resolved-address policy to %s", (address, expected) => {
    expect(isOpenKrittResolvedAddressAllowed(address, { allowLoopback: true })).toBe(expected);
  });

  it.each([
    ["2606:4700:4700::1111", true],
    ["2001:4860:4860::8888", true],
    ["fc00::1", false],
    ["fd12:3456:789a::1", false],
    ["fe80::1", false],
    ["fe80::1%en0", false],
    ["ff02::1", false],
    ["2001:db8::1", false],
    ["::", false],
    ["::ffff:169.254.169.254", false],
    ["::ffff:10.0.0.8", false],
    ["::ffff:8.8.8.8", true],
    ["64:ff9b::a9fe:a9fe", false],
    ["64:ff9b:1::a9fe:a9fe", false],
    ["64:ff9b::808:808", false],
  ])("classifies IPv6 address %s rather than denying every IPv6 form", (address, expected) => {
    expect(isOpenKrittResolvedAddressAllowed(address, { allowLoopback: true })).toBe(expected);
  });

  it("requires explicit loopback policy rather than inferring safety from a hostname", () => {
    expect(isOpenKrittResolvedAddressAllowed("127.0.0.1", { allowLoopback: false })).toBe(false);
    expect(isOpenKrittResolvedAddressAllowed("::1", { allowLoopback: false })).toBe(false);
  });

  it.each([
    ["192.0.0.8", false],
    ["198.18.0.1", false],
    ["240.0.0.1", false],
    ["255.255.255.255", false],
  ])("refuses reserved IPv4 range member %s", (address, expected) => {
    expect(isOpenKrittResolvedAddressAllowed(address, { allowLoopback: true })).toBe(expected);
  });

  it("treats the whole 127.0.0.0/8 block as loopback", () => {
    expect(normalizeOpenKrittServerUrl("http://127.0.0.2:8080")).toBe("http://127.0.0.2:8080");
    expect(isOpenKrittLoopbackUrl("http://127.0.0.2:8080")).toBe(true);
    expect(isOpenKrittResolvedAddressAllowed("127.0.0.2", { allowLoopback: true })).toBe(true);
    expect(isOpenKrittResolvedAddressAllowed("127.0.0.2", { allowLoopback: false })).toBe(false);
  });

  it("allows a private address only when the operator listed it", () => {
    const policy = (allowedPrivateAddresses: readonly string[]) => ({
      allowLoopback: false,
      allowedPrivateAddresses,
    });
    expect(isOpenKrittResolvedAddressAllowed("192.168.10.20", policy([]))).toBe(false);
    expect(isOpenKrittResolvedAddressAllowed("192.168.10.20", policy(["192.168.10.20"]))).toBe(
      true,
    );
    expect(isOpenKrittResolvedAddressAllowed("192.168.10.20", policy(["192.168.10.0/24"]))).toBe(
      true,
    );
    expect(isOpenKrittResolvedAddressAllowed("192.168.11.20", policy(["192.168.10.0/24"]))).toBe(
      false,
    );
    expect(isOpenKrittResolvedAddressAllowed("10.4.2.1", policy(["10.0.0.0/8"]))).toBe(true);
    expect(
      isOpenKrittResolvedAddressAllowed("fd12:3456:789a::1", policy(["fd12:3456:789a::/48"])),
    ).toBe(true);
    expect(isOpenKrittResolvedAddressAllowed("fd99::1", policy(["fd12:3456:789a::/48"]))).toBe(
      false,
    );
    // Never allowlistable, whatever the operator writes.
    expect(isOpenKrittResolvedAddressAllowed("169.254.169.254", policy(["169.254.169.254"]))).toBe(
      false,
    );
    expect(isOpenKrittResolvedAddressAllowed("224.0.0.1", policy(["224.0.0.1"]))).toBe(false);
    expect(isOpenKrittResolvedAddressAllowed("240.0.0.1", policy(["240.0.0.0/4"]))).toBe(false);
  });

  it.each([
    ["192.168.10.20", true],
    ["10.0.0.0/8", true],
    ["fd00::/8", true],
    ["kritt.internal", false],
    ["192.168.10.20/40", false],
    ["", false],
  ])("validates allowlist entry %s at configure time", (entry, valid) => {
    expect(parseOpenKrittAllowedAddress(entry) !== null).toBe(valid);
  });
});
