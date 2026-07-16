import { type ComposerPathSearchTarget } from "@notcodex/client-runtime/state/threads";

import { useComposerPathSearch as useComposerPathSearchQuery } from "../state/queries";

export function useComposerPathSearch(target: ComposerPathSearchTarget) {
  return useComposerPathSearchQuery(target);
}
