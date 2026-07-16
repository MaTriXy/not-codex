import { AutomationDefinition } from "@notcodex/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  automationCompletionFromEditor,
  automationEditorFromDefinition,
  automationPublishFromEditor,
  automationSchedulePreview,
} from "./AutomationsPage.tsx";

const decodeDefinition = Schema.decodeUnknownSync(AutomationDefinition);

const definition = decodeDefinition({
  id: "automation-1",
  projectId: "project-1",
  name: "Verified maintenance",
  description: "Keep the repository healthy.",
  enabled: true,
  prompt: "Fix the next maintenance issue and verify it.",
  modelSelection: { instanceId: "provider-1", model: "model-1" },
  runtimeMode: "auto-accept-edits",
  schedule: {
    type: "calendar",
    timeZone: "UTC",
    localTime: "09:00",
    weekdays: [1, 2, 3, 4, 5],
  },
  execution: {
    worktreeMode: "isolated",
    approvalHandling: "pause",
    maxDurationMinutes: 90,
    baseBranch: "main",
    cleanupOnSuccess: true,
  },
  completion: {
    type: "follow-until-complete",
    until: { type: "checks-pass", scriptIds: ["typecheck", "test"] },
    maxTurns: 4,
    maxDurationMinutes: 90,
    followUpPrompt: "Continue until the checks pass.",
  },
  retry: { maxAttempts: 2, initialDelaySeconds: 30, maxDelaySeconds: 300 },
  publish: {
    type: "draft-pr",
    titleTemplate: "{name} · {runId}",
  },
  notifications: {
    onStarted: false,
    onWaiting: true,
    onSucceeded: true,
    onFailed: true,
  },
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
  nextRunAt: "2026-07-16T09:00:00.000Z",
  deletedAt: null,
});

describe("Automations editor model", () => {
  it("preserves runtime, follow-up checks, and PR title policy while editing", () => {
    const editor = automationEditorFromDefinition(definition);

    expect(editor.runtimeMode).toBe("auto-accept-edits");
    expect(editor.followUntilType).toBe("checks-pass");
    expect(editor.checkScriptIds).toEqual(["typecheck", "test"]);
    expect(automationCompletionFromEditor(editor)).toEqual(definition.completion);
    expect(automationPublishFromEditor(editor)).toEqual(definition.publish);
  });

  it("previews three strictly increasing calendar instants", () => {
    const preview = automationSchedulePreview(automationEditorFromDefinition(definition));
    expect(preview).toHaveLength(3);
    expect(new Date(preview[0]!).getTime()).toBeLessThan(new Date(preview[1]!).getTime());
    expect(new Date(preview[1]!).getTime()).toBeLessThan(new Date(preview[2]!).getTime());
  });
});
