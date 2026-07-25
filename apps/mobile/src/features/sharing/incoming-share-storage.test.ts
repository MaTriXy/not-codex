import { describe, expect, it, vi } from "@effect/vitest";

import { writeIncomingShareDraftAtomically } from "./incoming-share-storage";

describe("incoming share storage", () => {
  it("writes a complete temporary file before replacing the destination", () => {
    const events: string[] = [];
    writeIncomingShareDraftAtomically("encoded draft", {
      createTemporary: () => events.push("create"),
      writeTemporary: (encoded) => events.push(`write:${encoded}`),
      replaceDestination: () => events.push("replace"),
      temporaryExists: () => true,
      removeTemporary: () => events.push("remove"),
    });

    expect(events).toEqual(["create", "write:encoded draft", "replace"]);
  });

  it("cleans up a failed temporary write without replacing the destination", () => {
    const removeTemporary = vi.fn(() => undefined);
    const replaceDestination = vi.fn(() => undefined);

    expect(() =>
      writeIncomingShareDraftAtomically("encoded draft", {
        createTemporary: () => undefined,
        writeTemporary: () => {
          throw new Error("disk full");
        },
        replaceDestination,
        temporaryExists: () => true,
        removeTemporary,
      }),
    ).toThrow("disk full");
    expect(replaceDestination).not.toHaveBeenCalled();
    expect(removeTemporary).toHaveBeenCalledOnce();
  });
});
