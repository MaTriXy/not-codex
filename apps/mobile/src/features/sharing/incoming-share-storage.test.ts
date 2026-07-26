import { describe, expect, it } from "@effect/vitest";

import {
  classifyIncomingShareStorageFiles,
  INCOMING_SHARE_MAX_STORED_BYTES,
  INCOMING_SHARE_MAX_STORED_DRAFTS,
  pruneIncomingShareStorageOverflow,
} from "./incoming-share-storage";
import type { IncomingShareDraft } from "./incoming-share-model";

function storedFile(name: string, size: number, lastModified: number) {
  return { name, size, lastModified };
}

function draft(id: string): IncomingShareDraft {
  return {
    schemaVersion: 1,
    id,
    createdAt: "2026-07-26T00:00:00.000Z",
    text: id,
    attachments: [],
    warnings: [],
  };
}

function readableStoredFile(
  name: string,
  size: number,
  lastModified: number,
  value: IncomingShareDraft | string,
) {
  return {
    ...storedFile(name, size, lastModified),
    text: async () => (typeof value === "string" ? value : JSON.stringify(value)),
  };
}

describe("incoming share storage bounds", () => {
  it("selects only the newest configured number of valid drafts", async () => {
    const files = [
      readableStoredFile("oldest.json", 10, 1, draft("oldest")),
      readableStoredFile("newest.json", 10, 3, draft("newest")),
      readableStoredFile("middle.json", 10, 2, draft("middle")),
    ];

    const result = await classifyIncomingShareStorageFiles(files);

    expect(result.retained.map(({ file }) => file.name)).toEqual(["newest.json", "middle.json"]);
    expect(result.retained).toHaveLength(INCOMING_SHARE_MAX_STORED_DRAFTS);
    expect(result.discarded.map(({ file }) => file.name)).toEqual(["oldest.json"]);
  });

  it("rejects older drafts that exceed the aggregate serialized-byte budget", async () => {
    const files = [
      readableStoredFile("newest.json", INCOMING_SHARE_MAX_STORED_BYTES - 10, 2, draft("newest")),
      readableStoredFile("older.json", 11, 1, draft("older")),
    ];

    const result = await classifyIncomingShareStorageFiles(files);

    expect(result.retained.map(({ file }) => file.name)).toEqual(["newest.json"]);
    expect(result.discarded.map(({ file }) => file.name)).toEqual(["older.json"]);
  });

  it("fails write-time admission when an overflow file cannot be deleted", () => {
    const failure = new Error("filesystem refused deletion");

    expect(() =>
      pruneIncomingShareStorageOverflow(
        [
          {
            delete: () => {
              throw failure;
            },
          },
        ],
        { failOnError: true, onError: () => undefined },
      ),
    ).toThrow(failure);
  });

  it("does not let a malformed newest file evict a valid older draft", async () => {
    const result = await classifyIncomingShareStorageFiles([
      readableStoredFile("older.json", 10, 1, draft("older")),
      readableStoredFile("newest.json", 10, 3, "not json"),
      readableStoredFile("middle.json", 10, 2, draft("middle")),
    ]);

    expect(result.retained.map(({ file }) => file.name)).toEqual(["middle.json", "older.json"]);
    expect(result.discarded.map(({ file }) => file.name)).toEqual(["newest.json"]);
    expect(result.discarded[0]?.cause).not.toBeNull();
  });

  it("discards a newly written draft that exceeds the byte budget", async () => {
    const result = await classifyIncomingShareStorageFiles([
      readableStoredFile(
        "oversized.json",
        INCOMING_SHARE_MAX_STORED_BYTES + 1,
        1,
        draft("oversized"),
      ),
    ]);

    expect(result.retained).toEqual([]);
    expect(result.discarded.map(({ file }) => file.name)).toEqual(["oversized.json"]);
  });

  it("protects an older reserved draft from newer retention pressure", async () => {
    const reservedDraft = {
      ...draft("reserved"),
      destination: { environmentId: "environment-1", projectId: "project-1" },
    };
    const result = await classifyIncomingShareStorageFiles([
      readableStoredFile("reserved.json", 10, 1, reservedDraft),
      readableStoredFile("newest.json", INCOMING_SHARE_MAX_STORED_BYTES, 2, draft("newest")),
    ]);

    expect(result.retained.map(({ file }) => file.name)).toEqual(["reserved.json"]);
    expect(result.discarded.map(({ file }) => file.name)).toEqual(["newest.json"]);
  });
});
