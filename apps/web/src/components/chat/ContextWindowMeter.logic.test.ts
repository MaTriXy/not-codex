import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@notcodex/contracts";
import { describe, expect, it } from "vite-plus/test";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import {
  formatContextWindowCompactionMessage,
  hasAvailableClaudeCompactionProvider,
  hasDismissedResumeCompaction,
  shouldOfferResumeCompaction,
} from "./ContextWindowMeter.logic";

function claudeProvider(input: {
  instanceId: string;
  continuationGroupKey: string;
  enabled?: boolean;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make("claudeAgent"),
    continuation: { groupKey: input.continuationGroupKey },
    enabled: input.enabled ?? true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-24T12:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  };
}

describe("hasAvailableClaudeCompactionProvider", () => {
  const originalInstanceId = ProviderInstanceId.make("claude_original");

  it("rejects a fallback in a different locked continuation group", () => {
    const providers = deriveProviderInstanceEntries([
      claudeProvider({
        instanceId: originalInstanceId,
        continuationGroupKey: "claude:home:/original",
        enabled: false,
      }),
      claudeProvider({
        instanceId: "claude_other",
        continuationGroupKey: "claude:home:/other",
      }),
    ]);

    expect(
      hasAvailableClaudeCompactionProvider({
        providers,
        instanceId: originalInstanceId,
        lockedInstanceId: originalInstanceId,
      }),
    ).toBe(false);
  });

  it("accepts an enabled fallback in the locked continuation group", () => {
    const providers = deriveProviderInstanceEntries([
      claudeProvider({
        instanceId: originalInstanceId,
        continuationGroupKey: "claude:home:/original",
        enabled: false,
      }),
      claudeProvider({
        instanceId: "claude_fallback",
        continuationGroupKey: "claude:home:/original",
      }),
    ]);

    expect(
      hasAvailableClaudeCompactionProvider({
        providers,
        instanceId: originalInstanceId,
        lockedInstanceId: originalInstanceId,
      }),
    ).toBe(true);
  });
});

describe("formatContextWindowCompactionMessage", () => {
  it("uses provider-aware copy", () => {
    expect(formatContextWindowCompactionMessage("Claude")).toBe(
      "Claude automatically compacts its context when needed.",
    );
  });

  it("shows the configured auto-compaction threshold", () => {
    expect(formatContextWindowCompactionMessage("Claude", 300_000)).toBe(
      "Compacts automatically at 300,000 tokens.",
    );
  });
});

describe("shouldOfferResumeCompaction", () => {
  const now = "2026-08-24T12:00:00.000Z";

  it("matches Claude's old-session age and context thresholds", () => {
    expect(
      shouldOfferResumeCompaction({
        provider: "claudeAgent",
        usedTokens: 100_000,
        updatedAt: "2026-08-24T10:50:00.000Z",
        now,
      }),
    ).toBe(true);
  });

  it("does not prompt for recent, smaller, or non-Claude sessions", () => {
    expect(
      shouldOfferResumeCompaction({
        provider: "claudeAgent",
        usedTokens: 99_999,
        updatedAt: "2026-08-24T10:00:00.000Z",
        now,
      }),
    ).toBe(false);
    expect(
      shouldOfferResumeCompaction({
        provider: "claudeAgent",
        usedTokens: 200_000,
        updatedAt: "2026-08-24T10:51:00.000Z",
        now,
      }),
    ).toBe(false);
    expect(
      shouldOfferResumeCompaction({
        provider: "codex",
        usedTokens: 300_000,
        updatedAt: "2026-08-24T09:00:00.000Z",
        now,
      }),
    ).toBe(false);
  });
});

describe("hasDismissedResumeCompaction", () => {
  it("recognizes the native resume dialog's permanent dismissal", () => {
    expect(
      hasDismissedResumeCompaction([
        {
          kind: "user-input.resolved",
          payload: {
            answers: {
              "This session is 2h 0m old and uses 250,000 tokens. Compact it before continuing?":
                "Don't ask again",
            },
          },
        },
      ]),
    ).toBe(true);
  });

  it("ignores unrelated or malformed resolved questions", () => {
    expect(
      hasDismissedResumeCompaction([
        {
          kind: "user-input.resolved",
          payload: { answers: { "Show this setup reminder?": "Don't ask again" } },
        },
        { kind: "user-input.resolved", payload: null },
      ]),
    ).toBe(false);
  });
});
