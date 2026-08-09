import { describe, expect, it } from "@effect/vitest";

import { make } from "./ThreadPlanProgress.ts";

describe("ThreadPlanProgress", () => {
  it("tracks the active or next pending step and clears completed plans", () => {
    const progress = make();
    progress.recordPlanProgress("thread-1", [
      { step: "Inspect", status: "completed" },
      { step: "Implement", status: "inProgress" },
      { step: "Verify", status: "pending" },
    ]);
    expect(progress.getThreadPlanProgress("thread-1")).toEqual({
      step: "Implement",
      completedSteps: 1,
      totalSteps: 3,
    });
    progress.recordPlanProgress("thread-1", [
      { step: "Inspect", status: "completed" },
      { step: "Implement", status: "completed" },
      { step: "Verify", status: "completed" },
    ]);
    expect(progress.getThreadPlanProgress("thread-1")).toBeNull();
  });
});
