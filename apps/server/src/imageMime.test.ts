import { describe, expect, it } from "vite-plus/test";

import { inferImageExtension, parseBase64DataUrl } from "./imageMime.ts";

describe("imageMime", () => {
  it("parses base64 data URL with mime type", () => {
    expect(parseBase64DataUrl("data:image/png;base64,SGVsbG8=")).toEqual({
      mimeType: "image/png",
      base64: "SGVsbG8=",
    });
  });

  it("parses base64 data URL with mime parameters", () => {
    expect(parseBase64DataUrl("data:image/png;charset=utf-8;base64,SGVsbG8=")).toEqual({
      mimeType: "image/png",
      base64: "SGVsbG8=",
    });
  });

  it("rejects non-base64 data URL", () => {
    expect(parseBase64DataUrl("data:image/png;charset=utf-8,hello")).toBeNull();
  });

  it("rejects missing mime type", () => {
    expect(parseBase64DataUrl("data:;base64,SGVsbG8=")).toBeNull();
  });

  it("parses base64 data URL with spaces in payload", () => {
    expect(parseBase64DataUrl("data:image/png;base64,SGVs bG8=\n")).toEqual({
      mimeType: "image/png",
      base64: "SGVsbG8=",
    });
  });

  it("rejects payload with characters outside the base64 alphabet", () => {
    expect(parseBase64DataUrl("data:image/png;base64,SGVs!bG8=")).toBeNull();
    expect(parseBase64DataUrl("data:image/png;base64,SGVs,bG8=")).toBeNull();
  });

  it("rejects structurally malformed base64", () => {
    expect(parseBase64DataUrl("data:image/png;base64,AB=CD===")).toBeNull();
    expect(parseBase64DataUrl("data:image/png;base64,SGV=bG8=")).toBeNull();
    expect(parseBase64DataUrl("data:image/png;base64,SGVsbG8=====AAA")).toBeNull();
    expect(parseBase64DataUrl("data:image/png;base64,SGVsbG8")).toBeNull();
  });

  it("accepts valid base64 with zero, one, or two trailing padding characters", () => {
    expect(parseBase64DataUrl("data:image/png;base64,SGVsbG8h")?.base64).toBe("SGVsbG8h");
    expect(parseBase64DataUrl("data:image/png;base64,SGVsbG8=")?.base64).toBe("SGVsbG8=");
    expect(parseBase64DataUrl("data:image/png;base64,SGVsbA==")?.base64).toBe("SGVsbA==");
  });

  it("rejects empty and whitespace-only payloads", () => {
    expect(parseBase64DataUrl("data:image/png;base64,")).toBeNull();
    expect(parseBase64DataUrl("data:image/png;base64, \r\n ")).toBeNull();
  });

  it("parses a case-insensitive scheme and mime type", () => {
    expect(parseBase64DataUrl("DATA:IMAGE/PNG;BASE64,SGVsbG8=")).toEqual({
      mimeType: "image/png",
      base64: "SGVsbG8=",
    });
  });

  it("parses a multi-megabyte payload from a deep call stack", () => {
    const dataUrl = `data:image/png;base64,${"A".repeat(14_000_000)}`;
    const atDepth = (depth: number): ReturnType<typeof parseBase64DataUrl> =>
      depth === 0 ? parseBase64DataUrl(dataUrl) : atDepth(depth - 1);
    const findMaxDepth = (depth: number): number => {
      try {
        return findMaxDepth(depth + 1);
      } catch {
        return depth;
      }
    };

    const result = atDepth(Math.floor(findMaxDepth(0) * 0.85));
    expect(result?.mimeType).toBe("image/png");
    expect(result?.base64).toHaveLength(14_000_000);
  });

  it("compacts a multi-megabyte payload with interleaved whitespace", () => {
    const dataUrl = `data:image/png;base64,${"A ".repeat(7_000_000)}`;

    const result = parseBase64DataUrl(dataUrl);

    expect(result?.mimeType).toBe("image/png");
    expect(result?.base64).toHaveLength(7_000_000);
    expect(result?.base64.startsWith("AAAA")).toBe(true);
    expect(result?.base64.endsWith("AAAA")).toBe(true);
  });

  it("does not read inherited keys from mime extension map", () => {
    expect(inferImageExtension({ mimeType: "constructor" })).toBe(".bin");
  });
});
