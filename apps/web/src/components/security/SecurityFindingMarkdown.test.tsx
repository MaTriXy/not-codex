import { describe, expect, it } from "vite-plus/test";

import {
  parseSecurityFindingBlocks,
  renderSecurityFindingMarkdown,
  sanitizeSecurityFindingMarkdown,
} from "./SecurityFindingMarkdown.tsx";

describe("safe Security finding renderer", () => {
  it("renders hostile upstream HTML, scripts, directives, file links, and javascript URLs as inert text", () => {
    const hostile = [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "[file](file:///etc/passwd)",
      "[javascript](javascript:alert(1))",
      '<iframe src="https://attacker.example"></iframe>',
      "<!-- hidden instruction -->",
    ].join("\n");
    const sanitized = sanitizeSecurityFindingMarkdown(hostile);
    const rendered = renderSecurityFindingMarkdown(hostile);

    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("onerror");
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("file://");
    expect(rendered).not.toHaveProperty("dangerouslySetInnerHTML");
  });

  it("strips bidirectional-override and zero-width characters so a path cannot be disguised", () => {
    const disguised = sanitizeSecurityFindingMarkdown("src/\u202Est.dettimo\u202C\u200Bts\uFEFF");

    expect(disguised).toBe("src/st.dettimots");
    for (const codePoint of [0x202e, 0x202c, 0x200b, 0xfeff, 0x2066, 0x2069, 0x061c]) {
      expect(disguised).not.toContain(String.fromCodePoint(codePoint));
    }
  });

  it("bounds finding content and strips control characters without enabling raw HTML", () => {
    const result = sanitizeSecurityFindingMarkdown(`${"x".repeat(20_000)}\u0000\u0007`);
    expect(result.length).toBeLessThanOrEqual(16_000);
    expect(
      Array.from(result).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint === 0 || codePoint === 7;
      }),
    ).toBe(false);
    expect(result).not.toContain("rehypeRaw");
  });

  it("renders the allowlisted Markdown subset as structure instead of literal syntax", () => {
    const blocks = parseSecurityFindingBlocks(
      [
        "The handler concatenates user input:",
        "",
        "```",
        "db.query('SELECT * FROM u WHERE id = ' + req.query.id)",
        "```",
        "",
        "- unauthenticated",
        "- remotely reachable",
        "",
        "1. send the crafted id",
        "2. observe the dumped table",
      ].join("\n"),
    );

    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "code", "list", "list"]);
    expect(blocks[1]).toMatchObject({ kind: "code" });
    expect(blocks[2]).toMatchObject({
      kind: "list",
      ordered: false,
      items: ["unauthenticated", "remotely reachable"],
    });
    expect(blocks[3]).toMatchObject({ kind: "list", ordered: true });
    // No block kind can carry a link, image, or raw-HTML payload.
    expect(new Set(blocks.map((block) => block.kind))).toEqual(
      new Set(["paragraph", "code", "list"]),
    );
  });

  it("keeps the structured render free of any raw-HTML escape hatch", () => {
    const rendered = renderSecurityFindingMarkdown("`inline` text");

    expect(rendered.kind).toBe("inert-blocks");
    expect(JSON.stringify(rendered)).not.toContain("dangerouslySetInnerHTML");
  });
});
