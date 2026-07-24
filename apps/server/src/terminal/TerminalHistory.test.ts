import { describe, expect, it } from "vite-plus/test";

import { capTerminalHistory, sanitizeTerminalHistoryChunk } from "./TerminalHistory.ts";

describe("capTerminalHistory", () => {
  it("retains only the newest lines while preserving a trailing newline", () => {
    expect(capTerminalHistory("one\ntwo\nthree\n", 2)).toBe("two\nthree\n");
    expect(capTerminalHistory("one\ntwo\nthree", 2)).toBe("two\nthree");
  });

  it("returns short histories unchanged", () => {
    expect(capTerminalHistory("", 2)).toBe("");
    expect(capTerminalHistory("one\ntwo\n", 2)).toBe("one\ntwo\n");
  });
});

describe("sanitizeTerminalHistoryChunk", () => {
  it("removes replay-unsafe terminal queries and replies", () => {
    expect(
      sanitizeTerminalHistoryChunk(
        "",
        `before\u001b[6nafter\u001b[12;34R\u001b]10;?\u0007\u001b]11;rgb:0000/0000/0000\u001b\\`,
      ),
    ).toEqual({ visibleText: "beforeafter", pendingControlSequence: "" });
  });

  it("preserves rendering and title control sequences", () => {
    const input = "\u001b[31mred\u001b[0m\u001b]0;Not Codex\u0007";
    expect(sanitizeTerminalHistoryChunk("", input)).toEqual({
      visibleText: input,
      pendingControlSequence: "",
    });
  });

  it("buffers incomplete control sequences across chunks", () => {
    const first = sanitizeTerminalHistoryChunk("", "visible\u001b]10;");
    expect(first).toEqual({
      visibleText: "visible",
      pendingControlSequence: "\u001b]10;",
    });

    expect(sanitizeTerminalHistoryChunk(first.pendingControlSequence, "?\u0007after")).toEqual({
      visibleText: "after",
      pendingControlSequence: "",
    });
  });
});
