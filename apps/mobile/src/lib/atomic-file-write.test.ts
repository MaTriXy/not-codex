import { describe, expect, it, vi } from "@effect/vitest";

import { writeFileAtomically } from "./atomic-file-write";

describe("atomic file replacement", () => {
  it("writes a complete temporary file before replacing the destination", () => {
    const events: string[] = [];
    writeFileAtomically("encoded draft", {
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
      writeFileAtomically("encoded draft", {
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
