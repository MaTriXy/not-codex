export function addEnvironmentNavigationMode(
  incomingShareId: string | ReadonlyArray<string> | undefined,
): "push" | "replace" {
  return incomingShareId ? "push" : "replace";
}
