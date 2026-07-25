import { describe, expect, it, vi } from "@effect/vitest";
import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@notcodex/contracts";
import type { ResolvedSharePayload, SharePayload } from "expo-sharing";

import {
  buildIncomingShareDraft,
  hasIncomingShareContent,
  INCOMING_SHARE_MAX_TOTAL_IMAGE_BYTES,
} from "./incoming-share-model";

describe("incoming native shares", () => {
  it("converts shared text, URLs, and images into a durable composer draft", async () => {
    const image: SharePayload = {
      shareType: "image",
      value: "file:///shared/Screenshot.png",
      mimeType: "image/png",
    };
    const payloads: SharePayload[] = [
      { shareType: "text", value: "Please explain this error" },
      { shareType: "url", value: "https://example.com/issue/1" },
      { shareType: "text", value: "Please explain this error" },
      image,
    ];
    const resolvedImage: ResolvedSharePayload = {
      ...image,
      contentUri: image.value,
      contentType: "image",
      contentMimeType: "image/png",
      contentSize: 3,
      originalName: "Screenshot.png",
    };
    const removeOwnedFile = vi.fn(() => Promise.resolve());

    const result = await buildIncomingShareDraft({
      id: "share-1",
      createdAt: "2026-07-15T10:00:00.000Z",
      payloads,
      resolvedPayloads: [resolvedImage],
      fileReader: {
        readBase64: async () => "YWJj",
        removeOwnedFile,
      },
    });

    expect(result).toEqual({
      schemaVersion: 1,
      id: "share-1",
      createdAt: "2026-07-15T10:00:00.000Z",
      text: "Please explain this error\n\nhttps://example.com/issue/1",
      attachments: [
        {
          id: "share-1:image:3",
          type: "image",
          name: "Screenshot.png",
          mimeType: "image/png",
          sizeBytes: 3,
          dataUrl: "data:image/png;base64,YWJj",
        },
      ],
      warnings: [],
    });
    expect(removeOwnedFile).toHaveBeenCalledWith(image.value);
    expect(hasIncomingShareContent(result)).toBe(true);
  });

  it("skips oversized images and releases the temporary native file", async () => {
    const image: SharePayload = {
      shareType: "image",
      value: "file:///shared/huge.png",
      mimeType: "image/png",
    };
    const readBase64 = vi.fn(async () => "unused");
    const removeOwnedFile = vi.fn(() => Promise.resolve());

    const result = await buildIncomingShareDraft({
      id: "share-2",
      createdAt: "2026-07-15T10:00:00.000Z",
      payloads: [image],
      resolvedPayloads: [
        {
          ...image,
          contentUri: image.value,
          contentType: "image",
          contentMimeType: "image/png",
          contentSize: PROVIDER_SEND_TURN_MAX_IMAGE_BYTES + 1,
          originalName: "huge.png",
        },
      ],
      fileReader: { readBase64, removeOwnedFile },
    });

    expect(result.attachments).toEqual([]);
    expect(result.warnings).toEqual(["'huge.png' exceeds the 10 MB attachment limit."]);
    expect(readBase64).not.toHaveBeenCalled();
    expect(removeOwnedFile).toHaveBeenCalledWith(image.value);
    expect(hasIncomingShareContent(result)).toBe(false);
  });

  it("rejects encoded image bytes that exceed under-reported provider metadata", async () => {
    const image: SharePayload = {
      shareType: "image",
      value: "file:///shared/under-reported.png",
      mimeType: "image/png",
    };
    const removeOwnedFile = vi.fn(() => Promise.resolve());
    const encodedOversize = "A".repeat(
      Math.ceil(((PROVIDER_SEND_TURN_MAX_IMAGE_BYTES + 1) * 4) / 3),
    );

    const result = await buildIncomingShareDraft({
      id: "share-under-reported",
      createdAt: "2026-07-15T10:00:00.000Z",
      payloads: [image],
      resolvedPayloads: [
        {
          ...image,
          contentUri: image.value,
          contentType: "image",
          contentMimeType: "image/png",
          contentSize: 3,
          originalName: "under-reported.png",
        },
      ],
      fileReader: {
        readBase64: async () => encodedOversize,
        removeOwnedFile,
      },
    });

    expect(result.attachments).toEqual([]);
    expect(result.warnings).toEqual(["'under-reported.png' exceeds the 10 MB attachment limit."]);
    expect(removeOwnedFile).toHaveBeenCalledWith(image.value);
  });

  it("bounds the aggregate bytes retained for a multi-image native share", async () => {
    const imageBytes = Math.floor(INCOMING_SHARE_MAX_TOTAL_IMAGE_BYTES * 0.6);
    const encodedImage = "A".repeat(Math.ceil((imageBytes * 4) / 3));
    const images: SharePayload[] = ["first", "second"].map((name) => ({
      shareType: "image" as const,
      value: `file:///shared/${name}.png`,
      mimeType: "image/png",
    }));
    const removeOwnedFile = vi.fn(async () => undefined);

    const result = await buildIncomingShareDraft({
      id: "share-aggregate-limit",
      createdAt: "2026-07-15T10:00:00.000Z",
      payloads: images,
      resolvedPayloads: [],
      fileReader: {
        readBase64: async () => encodedImage,
        removeOwnedFile,
      },
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.warnings).toEqual(["Shared images exceed the 10 MB total attachment limit."]);
    expect(removeOwnedFile).toHaveBeenCalledTimes(2);
  });

  it("rejects shared image formats that providers cannot send", async () => {
    const image: SharePayload = {
      shareType: "image",
      value: "file:///shared/photo.heic",
      mimeType: "image/heic",
    };
    const readBase64 = vi.fn(async () => "YWJj");
    const removeOwnedFile = vi.fn(async () => undefined);

    const result = await buildIncomingShareDraft({
      id: "share-heic",
      createdAt: "2026-07-15T10:00:00.000Z",
      payloads: [image],
      resolvedPayloads: [],
      fileReader: { readBase64, removeOwnedFile },
    });

    expect(result.attachments).toEqual([]);
    expect(result.warnings).toEqual(["One shared item was not a supported image."]);
    expect(readBase64).not.toHaveBeenCalled();
    expect(removeOwnedFile).toHaveBeenCalledWith(image.value);
  });

  it("does not guess a PNG MIME type when image metadata is absent", async () => {
    const image: SharePayload = {
      shareType: "image",
      value: "file:///shared/unknown-image",
    };
    const readBase64 = vi.fn(async () => "YWJj");
    const removeOwnedFile = vi.fn(async () => undefined);

    const result = await buildIncomingShareDraft({
      id: "share-missing-mime",
      createdAt: "2026-07-15T10:00:00.000Z",
      payloads: [image],
      resolvedPayloads: [],
      fileReader: { readBase64, removeOwnedFile },
    });

    expect(result.attachments).toEqual([]);
    expect(result.warnings).toEqual(["One shared item was not a supported image."]);
    expect(readBase64).not.toHaveBeenCalled();
    expect(removeOwnedFile).toHaveBeenCalledWith(image.value);
  });

  it("persists shared image bytes only once", async () => {
    const image: SharePayload = {
      shareType: "image",
      value: "file:///shared/screenshot.png",
      mimeType: "image/png",
    };
    const result = await buildIncomingShareDraft({
      id: "share-single-copy",
      createdAt: "2026-07-15T10:00:00.000Z",
      payloads: [image],
      resolvedPayloads: [],
      fileReader: {
        readBase64: async () => "YWJj",
        removeOwnedFile: async () => undefined,
      },
    });

    expect(result.attachments[0]?.previewUri).toBeUndefined();
    expect(JSON.stringify(result).split("YWJj")).toHaveLength(2);
  });

  it("releases every temporary file when a share exceeds the attachment limit", async () => {
    const payloads = Array.from({ length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS + 1 }, (_, index) => ({
      shareType: "image" as const,
      value: `file:///shared/${index}.png`,
      mimeType: "image/png",
    }));
    const removeOwnedFile = vi.fn(() => Promise.resolve());
    const readBase64 = vi.fn(async () => "YWJj");

    const result = await buildIncomingShareDraft({
      id: "share-3",
      createdAt: "2026-07-15T10:00:00.000Z",
      payloads,
      resolvedPayloads: [],
      fileReader: { readBase64, removeOwnedFile },
    });

    expect(result.attachments).toHaveLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS);
    expect(result.warnings).toEqual([
      `Only the first ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} shared images were attached.`,
    ]);
    expect(readBase64).toHaveBeenCalledTimes(PROVIDER_SEND_TURN_MAX_ATTACHMENTS);
    expect(removeOwnedFile).toHaveBeenCalledTimes(payloads.length);
  });

  it("maps duplicate image payloads to distinct resolved files", async () => {
    const duplicate: SharePayload = {
      shareType: "image",
      value: "content://shared/screenshot",
      mimeType: "image/png",
    };
    const resolvedPayloads: ResolvedSharePayload[] = [
      {
        ...duplicate,
        contentUri: "file:///cache/first.png",
        contentType: "image",
        contentMimeType: "image/png",
        contentSize: 3,
        originalName: "first.png",
      },
      {
        ...duplicate,
        contentUri: "file:///cache/second.png",
        contentType: "image",
        contentMimeType: "image/png",
        contentSize: 3,
        originalName: "second.png",
      },
    ];
    const readBase64 = vi.fn(async (uri: string) =>
      uri.includes("first") ? "Zmlyc3Q=" : "c2Vjb25k",
    );
    const removeOwnedFile = vi.fn(async () => undefined);

    const result = await buildIncomingShareDraft({
      id: "share-duplicates",
      createdAt: "2026-07-16T08:00:00.000Z",
      payloads: [duplicate, duplicate],
      resolvedPayloads,
      fileReader: { readBase64, removeOwnedFile },
    });

    expect(readBase64.mock.calls.map(([uri]) => uri)).toEqual([
      "file:///cache/first.png",
      "file:///cache/second.png",
    ]);
    expect(result.attachments.map((attachment) => attachment.name)).toEqual([
      "first.png",
      "second.png",
    ]);
    expect(removeOwnedFile).toHaveBeenCalledWith("file:///cache/first.png");
    expect(removeOwnedFile).toHaveBeenCalledWith("file:///cache/second.png");
  });

  it("keeps imported content when temporary-file cleanup fails", async () => {
    const image: SharePayload = {
      shareType: "image",
      value: "file:///shared/screenshot.png",
      mimeType: "image/png",
    };

    const result = await buildIncomingShareDraft({
      id: "share-cleanup-failure",
      createdAt: "2026-07-16T08:00:00.000Z",
      payloads: [image],
      resolvedPayloads: [],
      fileReader: {
        readBase64: async () => "YWJj",
        removeOwnedFile: async () => {
          throw new Error("file is busy");
        },
      },
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("keeps every native image source retryable when conversion fails", async () => {
    const images: SharePayload[] = [
      {
        shareType: "image",
        value: "file:///shared/first.png",
        mimeType: "image/png",
      },
      {
        shareType: "image",
        value: "file:///shared/second.png",
        mimeType: "image/png",
      },
    ];
    const removeOwnedFile = vi.fn(async () => undefined);
    const readBase64 = vi.fn(async (uri: string) => {
      if (uri.endsWith("second.png")) {
        throw new Error("file is temporarily unavailable");
      }
      return "YWJj";
    });

    await expect(
      buildIncomingShareDraft({
        id: "share-retryable-read",
        createdAt: "2026-07-16T08:00:00.000Z",
        payloads: images,
        resolvedPayloads: [],
        fileReader: { readBase64, removeOwnedFile },
      }),
    ).rejects.toThrow("Could not read 'second.png'");
    expect(removeOwnedFile).not.toHaveBeenCalled();
  });
});
