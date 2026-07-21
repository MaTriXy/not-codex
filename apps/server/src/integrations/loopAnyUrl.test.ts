import { describe, expect, it } from "vite-plus/test";

import { normalizeLoopAnyServerUrl } from "./loopAnyUrl.ts";

describe("normalizeLoopAnyServerUrl", () => {
  it("requires TLS for non-loopback servers", () => {
    expect(() => normalizeLoopAnyServerUrl("http://loop.example")).toThrow(
      "must use HTTPS unless it targets loopback",
    );
    expect(normalizeLoopAnyServerUrl("https://loop.example/path/?token=removed#fragment")).toBe(
      "https://loop.example/path",
    );
  });

  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://127.255.255.254:3000",
    "http://[::1]:3000",
  ])("allows explicit loopback HTTP: %s", (value) => {
    expect(normalizeLoopAnyServerUrl(value)).toBe(value);
  });

  it("rejects embedded credentials and non-web protocols", () => {
    expect(() => normalizeLoopAnyServerUrl("https://user:secret@loop.example")).toThrow(
      "must not contain embedded credentials",
    );
    expect(() => normalizeLoopAnyServerUrl("file:///tmp/loopany")).toThrow(
      "must use HTTPS, or HTTP on loopback",
    );
  });
});
