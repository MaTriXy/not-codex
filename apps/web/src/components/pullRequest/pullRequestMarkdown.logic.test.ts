import { describe, expect, it } from "vite-plus/test";

import { splitPullRequestBody } from "./pullRequestMarkdown.logic";

describe("splitPullRequestBody", () => {
  it("turns a host attachment into an external video card", () => {
    expect(
      splitPullRequestBody(
        "Demo\n\nhttps://github.com/user-attachments/assets/2ff7d879-1726-4cfe-9b16-84d854bf9b61",
      ),
    ).toEqual([
      { id: "markdown:0", kind: "markdown", text: "Demo" },
      {
        id: "attachment:1",
        kind: "attachment",
        media: "video",
        url: "https://github.com/user-attachments/assets/2ff7d879-1726-4cfe-9b16-84d854bf9b61",
      },
    ]);
  });

  it("does not lift attachment-looking text out of a code fence", () => {
    const body = "```text\nhttps://github.com/user-attachments/assets/example\n```";
    expect(splitPullRequestBody(body)).toEqual([
      { id: "markdown:0", kind: "markdown", text: body },
    ]);
  });

  it("rejects non-web video sources", () => {
    const body = '<video src="javascript:alert(1)"></video>';
    expect(splitPullRequestBody(body)).toEqual([
      { id: "markdown:0", kind: "markdown", text: body },
    ]);
  });
});
