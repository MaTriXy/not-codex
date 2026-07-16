import type { PreviewAutomationOpenInput, PreviewSessionSnapshot } from "@notcodex/contracts";

export function previewAutomationOpenNeedsOverlay(
  input: PreviewAutomationOpenInput,
  snapshot: PreviewSessionSnapshot,
): boolean {
  return input.url !== undefined || snapshot.navStatus._tag !== "Idle";
}
