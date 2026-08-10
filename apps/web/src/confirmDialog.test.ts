import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  completeConfirmDialogClose,
  readConfirmDialogState,
  registerConfirmDialogHost,
  requestConfirmDialog,
  resetConfirmDialogForTests,
  respondToConfirmDialog,
} from "./confirmDialog";
import { resolveConfirmDialogCopy } from "./components/ConfirmDialogHost";

function requireConfirmation(confirmation: Promise<boolean> | undefined): Promise<boolean> {
  if (!confirmation) throw new Error("Expected a registered confirmation host.");
  return confirmation;
}

describe("confirm dialog coordinator", () => {
  beforeEach(resetConfirmDialogForTests);

  it("returns undefined until a themed host is mounted", () => {
    expect(requestConfirmDialog("Confirm this action?")).toBeUndefined();
    expect(readConfirmDialogState()).toEqual({ status: "idle" });
  });

  it("resolves a displayed destructive confirmation after its close transition", async () => {
    const unregister = registerConfirmDialogHost();
    const confirmation = requireConfirmation(
      requestConfirmDialog("Delete this thread?", { variant: "destructive" }),
    );

    expect(readConfirmDialogState()).toEqual({
      status: "confirming",
      message: "Delete this thread?",
      variant: "destructive",
    });
    respondToConfirmDialog(true);
    await expect(confirmation).resolves.toBe(true);
    expect(readConfirmDialogState().status).toBe("closing");
    completeConfirmDialogClose();
    expect(readConfirmDialogState()).toEqual({ status: "idle" });
    unregister();
  });

  it("serializes concurrent confirmations", async () => {
    const unregister = registerConfirmDialogHost();
    const first = requireConfirmation(requestConfirmDialog("Delete the project?"));
    const second = requireConfirmation(requestConfirmDialog("Delete its worktree too?"));

    respondToConfirmDialog(false);
    await expect(first).resolves.toBe(false);
    completeConfirmDialogClose();
    expect(readConfirmDialogState()).toMatchObject({
      status: "confirming",
      message: "Delete its worktree too?",
    });
    respondToConfirmDialog(true);
    await expect(second).resolves.toBe(true);
    completeConfirmDialogClose();
    unregister();
  });

  it("fails active and queued confirmations closed when the last host unmounts", async () => {
    const unregister = registerConfirmDialogHost();
    const active = requireConfirmation(requestConfirmDialog("Delete the thread?"));
    const queued = requireConfirmation(requestConfirmDialog("Delete the worktree too?"));

    unregister();

    await expect(Promise.all([active, queued])).resolves.toEqual([false, false]);
    expect(readConfirmDialogState()).toEqual({ status: "idle" });
  });
});

describe("confirmation copy", () => {
  it("promotes the question line and preserves the remaining detail", () => {
    expect(
      resolveConfirmDialogCopy(
        'Delete thread "Polish UI"?\nThis permanently clears conversation history.\nThis cannot be undone.',
      ),
    ).toEqual({
      title: 'Delete thread "Polish UI"?',
      description: "This permanently clears conversation history.\nThis cannot be undone.",
    });
  });

  it("provides safe copy for empty messages", () => {
    expect(resolveConfirmDialogCopy("  ")).toEqual({
      title: "Confirm action",
      description: "This action requires your confirmation.",
    });
  });
});
