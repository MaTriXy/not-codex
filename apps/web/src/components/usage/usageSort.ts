export interface UsageModelSortValue {
  readonly totalTokens: number;
  readonly costUsd: number;
}

export function orderUsageModelsForMetric<T extends UsageModelSortValue>(
  models: ReadonlyArray<T>,
  metric: "cost" | "tokens",
): ReadonlyArray<T> {
  return metric === "tokens"
    ? models.toSorted(
        (left, right) => right.totalTokens - left.totalTokens || right.costUsd - left.costUsd,
      )
    : models;
}
