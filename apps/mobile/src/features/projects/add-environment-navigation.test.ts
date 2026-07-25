import { describe, expect, it } from "@effect/vitest";

import { addEnvironmentNavigationMode } from "./add-environment-navigation";

describe("add environment navigation", () => {
  it("pushes setup above an incoming-share sheet", () => {
    expect(addEnvironmentNavigationMode("share-1")).toBe("push");
  });

  it("replaces the empty add-project route outside a share flow", () => {
    expect(addEnvironmentNavigationMode(undefined)).toBe("replace");
  });
});
