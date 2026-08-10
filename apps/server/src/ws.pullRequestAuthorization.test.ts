import { AuthOrchestrationReadScope, WS_METHODS } from "@notcodex/contracts";
import { describe, expect, it } from "vite-plus/test";

import { rpcRequiredScopeForMethod } from "./ws.ts";

describe("pull-request RPC authorization", () => {
  it("keeps every read-only foundation method behind orchestration read scope", () => {
    for (const method of [
      WS_METHODS.pullRequestsList,
      WS_METHODS.pullRequestsListStats,
      WS_METHODS.pullRequestsDetail,
      WS_METHODS.pullRequestsActivity,
      WS_METHODS.pullRequestsDiffFileContents,
      WS_METHODS.pullRequestsInvalidate,
    ]) {
      expect(rpcRequiredScopeForMethod(method)).toBe(AuthOrchestrationReadScope);
    }
  });
});
