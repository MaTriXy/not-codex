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

  it("strips replayable CSI and DCS traffic while preserving setters", () => {
    const input = [
      "prompt ",
      "\u001b[?2026$p\u001b[?2026;2$y\u001b[>q\u001b[?u\u001b[?31u",
      "\u001bP$q m\u001b\\\u001bP1$r0m\u001b\\",
      "\u001bP+q544e\u001b\\\u001bP1+r544e=1b\u001b\\",
      "\u0090$q m\u009c\u00901$r0m\u009c",
      "\u0090+q544e\u009c\u00901+r544e=1b\u009c",
      '\u001b[!p\u001b["p\u001b[4 q\u001b[u',
      "done\n",
    ].join("");

    expect(sanitizeTerminalHistoryChunk("", input)).toEqual({
      visibleText: 'prompt \u001b[!p\u001b["p\u001b[4 q\u001b[udone\n',
      pendingControlSequence: "",
    });
  });

  it("handles replayable CSI and DCS sequences split across chunks", () => {
    let pendingControlSequence = "";
    let visibleText = "";
    for (const chunk of [
      "before \u001b[?2026$",
      "pafter \u001bP$q ",
      "m\u001b",
      "\\after \u009b?3",
      "1uafter \u0090+q544e",
      "\u009cafter\n",
    ]) {
      const sanitized = sanitizeTerminalHistoryChunk(pendingControlSequence, chunk);
      visibleText += sanitized.visibleText;
      pendingControlSequence = sanitized.pendingControlSequence;
    }

    expect({ visibleText, pendingControlSequence }).toEqual({
      visibleText: "before after after after after\n",
      pendingControlSequence: "",
    });
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
