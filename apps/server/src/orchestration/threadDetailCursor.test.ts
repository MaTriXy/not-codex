import { ThreadId } from "@notcodex/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  decodeThreadDetailPageCursor,
  encodeThreadDetailPageCursor,
} from "./threadDetailCursor.ts";

describe("threadDetailCursor", () => {
  it("round-trips stable and empty keyset boundaries", () => {
    for (const cursor of [
      {
        threadId: ThreadId.make("thread-1"),
        beforeAnchorAt: "2026-08-01T00:00:00.000Z",
        beforeTurnId: "turn-9",
      },
      { threadId: ThreadId.make("thread-1"), beforeAnchorAt: "", beforeTurnId: "" },
    ]) {
      expect(decodeThreadDetailPageCursor(encodeThreadDetailPageCursor(cursor))).toEqual(cursor);
    }
  });

  it("rejects malformed input", () => {
    expect(decodeThreadDetailPageCursor("not-base64-json")).toBeNull();
    expect(decodeThreadDetailPageCursor(Buffer.from("[]").toString("base64url"))).toBeNull();
    expect(
      decodeThreadDetailPageCursor(Buffer.from(JSON.stringify({ t: "" })).toString("base64url")),
    ).toBeNull();
    expect(
      decodeThreadDetailPageCursor(
        Buffer.from(JSON.stringify({ t: "thread-1", a: 5, i: "x" })).toString("base64url"),
      ),
    ).toBeNull();
  });
});
