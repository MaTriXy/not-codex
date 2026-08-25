import { describe, expect, it } from "vite-plus/test";

import { orderUsageModelsForMetric } from "./usageSort";

const MODELS = [
  { model: "expensive", costUsd: 10, totalTokens: 100 },
  { model: "token-heavy", costUsd: 5, totalTokens: 1_000 },
  { model: "token-heavy-cheaper", costUsd: 1, totalTokens: 1_000 },
] as const;

describe("orderUsageModelsForMetric", () => {
  it("preserves the cost-ranked source for the cost view", () => {
    expect(orderUsageModelsForMetric(MODELS, "cost")).toBe(MODELS);
  });

  it("sorts token views by token count with cost as the tie-breaker", () => {
    expect(orderUsageModelsForMetric(MODELS, "tokens").map(({ model }) => model)).toEqual([
      "token-heavy",
      "token-heavy-cheaper",
      "expensive",
    ]);
    expect(MODELS.map(({ model }) => model)).toEqual([
      "expensive",
      "token-heavy",
      "token-heavy-cheaper",
    ]);
  });
});
