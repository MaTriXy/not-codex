import { describe, expect, it } from "@effect/vitest";

import {
  INCOMING_SHARE_MAX_STORED_BYTES,
  INCOMING_SHARE_MAX_STORED_DRAFTS,
  partitionIncomingShareStorageFiles,
  pruneIncomingShareStorageOverflow,
} from "./incoming-share-storage";

function storedFile(name: string, size: number, lastModified: number) {
  return { name, size, lastModified };
}

describe("incoming share storage bounds", () => {
  it("selects only the newest configured number of drafts before hydration", () => {
    const files = [
      storedFile("oldest.json", 10, 1),
      storedFile("newest.json", 10, 3),
      storedFile("middle.json", 10, 2),
    ];

    const result = partitionIncomingShareStorageFiles(files);

    expect(result.retained.map((file) => file.name)).toEqual(["newest.json", "middle.json"]);
    expect(result.retained).toHaveLength(INCOMING_SHARE_MAX_STORED_DRAFTS);
    expect(result.overflow.map((file) => file.name)).toEqual(["oldest.json"]);
  });

  it("rejects older drafts that exceed the aggregate serialized-byte budget", () => {
    const files = [
      storedFile("newest.json", INCOMING_SHARE_MAX_STORED_BYTES - 10, 2),
      storedFile("older.json", 11, 1),
    ];

    const result = partitionIncomingShareStorageFiles(files);

    expect(result.retained.map((file) => file.name)).toEqual(["newest.json"]);
    expect(result.overflow.map((file) => file.name)).toEqual(["older.json"]);
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
});
