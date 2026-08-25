import { describe, expect, it } from "vite-plus/test";

import {
  normalizeWindowsMarkdownFileHref,
  resolveMarkdownFileLinkMeta,
  resolveMarkdownFileLinkTarget,
  rewriteMarkdownFileUriHref,
  shouldOpenMarkdownFileLinkInBrowserByDefault,
} from "./markdown-links";

describe("normalizeWindowsMarkdownFileHref", () => {
  it("turns bare Windows drive paths into allowed file URLs", () => {
    expect(normalizeWindowsMarkdownFileHref("D:\\work folder\\main.ts")).toBe(
      "file:///D:/work folder/main.ts",
    );
    expect(normalizeWindowsMarkdownFileHref("docs/main.ts")).toBe("docs/main.ts");
  });
});

describe("shouldOpenMarkdownFileLinkInBrowserByDefault", () => {
  it("uses the browser only for PDFs", () => {
    expect(shouldOpenMarkdownFileLinkInBrowserByDefault("docs/report.PDF#page=2")).toBe(true);
    expect(shouldOpenMarkdownFileLinkInBrowserByDefault("src/main.ts")).toBe(false);
  });
});

describe("rewriteMarkdownFileUriHref", () => {
  it("rewrites file uri hrefs into direct path hrefs", () => {
    expect(rewriteMarkdownFileUriHref("file:///Users/collaborator/project/src/main.ts#L42")).toBe(
      "/Users/collaborator/project/src/main.ts#L42",
    );
  });

  it("preserves encoded octets so file paths are decoded only once later", () => {
    expect(rewriteMarkdownFileUriHref("file:///Users/collaborator/project/file%2520name.md")).toBe(
      "/Users/collaborator/project/file%2520name.md",
    );
  });

  it("normalizes file uri hrefs for windows drive paths", () => {
    expect(
      rewriteMarkdownFileUriHref(
        "file:///D:/Programme/notcodex/apps/web/src/components/chat/OpenInPicker.tsx#L69",
      ),
    ).toBe("D:/Programme/notcodex/apps/web/src/components/chat/OpenInPicker.tsx#L69");
  });

  it("unwraps angle-bracketed file uri hrefs", () => {
    expect(
      rewriteMarkdownFileUriHref(
        " <file:///D:/Programme/notcodex/apps/web/src/markdown-links.ts> ",
      ),
    ).toBe("D:/Programme/notcodex/apps/web/src/markdown-links.ts");
  });
});

describe("resolveMarkdownFileLinkTarget", () => {
  it("resolves absolute posix file paths", () => {
    expect(resolveMarkdownFileLinkTarget("/Users/collaborator/project/AGENTS.md")).toBe(
      "/Users/collaborator/project/AGENTS.md",
    );
  });

  it("resolves relative file paths against cwd", () => {
    expect(
      resolveMarkdownFileLinkTarget("src/processRunner.ts:71", "/Users/collaborator/project"),
    ).toBe("/Users/collaborator/project/src/processRunner.ts:71");
  });

  it("does not treat filename line references as external schemes", () => {
    expect(resolveMarkdownFileLinkTarget("script.ts:10", "/Users/collaborator/project")).toBe(
      "/Users/collaborator/project/script.ts:10",
    );
  });

  it("resolves bare file names against cwd", () => {
    expect(resolveMarkdownFileLinkTarget("AGENTS.md", "/Users/collaborator/project")).toBe(
      "/Users/collaborator/project/AGENTS.md",
    );
  });

  it("resolves relative file paths and names containing spaces", () => {
    expect(resolveMarkdownFileLinkTarget("docs/release notes.md", "/repo/project")).toBe(
      "/repo/project/docs/release notes.md",
    );
    expect(resolveMarkdownFileLinkTarget("release notes.md", "/repo/project")).toBe(
      "/repo/project/release notes.md",
    );
  });

  it("maps #L line anchors to editor line suffixes", () => {
    expect(resolveMarkdownFileLinkTarget("/Users/collaborator/project/src/main.ts#L42C7")).toBe(
      "/Users/collaborator/project/src/main.ts:42:7",
    );
  });

  it("ignores external urls", () => {
    expect(resolveMarkdownFileLinkTarget("https://example.com/docs")).toBeNull();
  });

  it("does not double-decode file URLs", () => {
    expect(
      resolveMarkdownFileLinkTarget("file:///Users/collaborator/project/file%2520name.md"),
    ).toBe("/Users/collaborator/project/file%20name.md");
  });

  it("formats tooltip display paths relative to the cwd when possible", () => {
    expect(
      resolveMarkdownFileLinkMeta(
        "file:///C:/Users/mike/dev-stuff/notcodex/apps/web/src/session-logic.ts#L501",
        "C:/Users/mike/dev-stuff/notcodex",
      ),
    ).toMatchObject({
      displayPath: "notcodex/apps/web/src/session-logic.ts:501",
      workspaceRelativePath: "apps/web/src/session-logic.ts",
    });
  });

  it("formats tooltip display paths relative to the cwd for slash-prefixed windows paths", () => {
    expect(
      resolveMarkdownFileLinkMeta(
        "/C:/Users/mike/dev-stuff/notcodex/apps/web/src/components/chat/MessagesTimeline.virtualization.browser.tsx",
        "C:/Users/mike/dev-stuff/notcodex",
      ),
    ).toMatchObject({
      displayPath:
        "notcodex/apps/web/src/components/chat/MessagesTimeline.virtualization.browser.tsx",
      workspaceRelativePath:
        "apps/web/src/components/chat/MessagesTimeline.virtualization.browser.tsx",
    });
  });

  it("does not create a preview path for files outside the workspace", () => {
    expect(resolveMarkdownFileLinkMeta("/tmp/report.ts", "/repo/project")).toMatchObject({
      workspaceRelativePath: null,
    });
  });

  it("normalizes slash-prefixed windows drive paths before resolving", () => {
    expect(
      resolveMarkdownFileLinkTarget(
        "/D:/Programme/notcodex/apps/web/src/components/chat/OpenInPicker.tsx#L69",
      ),
    ).toBe("D:/Programme/notcodex/apps/web/src/components/chat/OpenInPicker.tsx:69");
  });

  it("resolves angle-bracketed windows drive paths", () => {
    expect(
      resolveMarkdownFileLinkTarget(
        "</D:/Programme/notcodex/apps/web/src/components/ChatMarkdown.tsx:1>",
      ),
    ).toBe("D:/Programme/notcodex/apps/web/src/components/ChatMarkdown.tsx:1");
  });

  it("does not treat app routes as file links", () => {
    expect(resolveMarkdownFileLinkTarget("/chat/settings")).toBeNull();
  });
});
