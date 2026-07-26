import { describe, expect, it } from "vite-plus/test";

import { resolveSidebarStageBackdropVariant, resolveSidebarStageLabel } from "./SidebarStage";

describe("resolveSidebarStageLabel", () => {
  it("uses the authoritative primary-server channel for the whole sidebar", () => {
    expect(
      resolveSidebarStageLabel({
        primaryServerVersion: "0.0.28-nightly.20260616.12",
        fallbackStageLabel: "Alpha",
      }),
    ).toBe("Nightly");
  });

  it.each([
    ["0.0.27", "Alpha"],
    [null, "Dev"],
    ["0.0.28-nightly.20260616", "Alpha"],
  ] as const)("falls back for server version %s", (primaryServerVersion, fallbackStageLabel) => {
    expect(resolveSidebarStageLabel({ primaryServerVersion, fallbackStageLabel })).toBe(
      fallbackStageLabel,
    );
  });
});

describe("resolveSidebarStageBackdropVariant", () => {
  it.each([
    ["Nightly", "nightly"],
    [" nightly ", "nightly"],
    ["DEV", "dev"],
    [" Dev ", "dev"],
  ] as const)("maps %s to %s artwork", (stageLabel, expected) => {
    expect(resolveSidebarStageBackdropVariant(stageLabel)).toBe(expected);
  });

  it.each(["Alpha", "Latest", "", "development"])(
    "leaves %s on the standard sidebar surface",
    (stageLabel) => {
      expect(resolveSidebarStageBackdropVariant(stageLabel)).toBeNull();
    },
  );
});
