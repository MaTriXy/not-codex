import { describe, expect, it } from "vite-plus/test";

import { resolveSidebarProjectSecurityNavigation } from "./Sidebar.logic.ts";

describe("project Security navigation", () => {
  it("creates a project-scoped Security route without changing thread navigation", () => {
    expect(
      resolveSidebarProjectSecurityNavigation({
        environmentId: "environment-1",
        projectId: "project-126",
      }),
    ).toEqual({
      to: "/security/$environmentId/$projectId",
      params: { environmentId: "environment-1", projectId: "project-126" },
    });
  });

  it("does not navigate to an upstream Open Kritt URL", () => {
    const navigation = resolveSidebarProjectSecurityNavigation({
      environmentId: "environment-1",
      projectId: "project-126",
    });
    expect(JSON.stringify(navigation)).not.toContain("kritt");
    expect(JSON.stringify(navigation)).not.toContain("http");
  });
});
