// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";

import type { OpenKrittLaunchScanInput, OpenKrittScanLaunchResult } from "@notcodex/contracts";
import { NewOpenKrittScanDialog } from "./NewOpenKrittScanDialog";

let container: HTMLDivElement;
let root: Root;

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(text),
  );
  if (found === undefined) throw new Error(`Missing button ${text}`);
  return found;
}

function click(element: Element): void {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function typeCommit(value: string): void {
  const input = container.querySelector<HTMLInputElement>("#open-kritt-commit-sha")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

it("restores an unresolved request id and exact payload after remount", async () => {
  const calls: Array<Omit<OpenKrittLaunchScanInput, "projectId">> = [];
  let outcomes: Array<OpenKrittScanLaunchResult> = [
    {
      run: "pending",
      externalScanId: null,
      launchResolution: "unknown",
      policyChoices: [],
      fieldErrors: [],
    },
  ];
  const onLaunch = async (input: Omit<OpenKrittLaunchScanInput, "projectId">) => {
    calls.push(input);
    return outcomes.shift()!;
  };
  const props = {
    projectId: "project-1" as never,
    repository: "acme/app",
    defaultSource: null,
    defaultConfiguration: {
      workflowId: "workflow-1",
      postScriptIds: ["post-1"],
      agentSkillIds: [],
      severityRankerId: "ranker-1",
      providerId: "provider-1",
      modelId: "model-1",
      thinkingEffort: "high" as const,
      jobLimit: 1,
    },
    onLaunch,
  };

  act(() => root.render(<NewOpenKrittScanDialog {...props} unresolvedRunId={null} />));
  click(button("Prepare scan"));
  typeCommit("a".repeat(40));
  click(button("Launch scan"));
  await settle();

  const first = calls[0]!;
  act(() => root.unmount());
  root = createRoot(container);
  outcomes = [
    {
      run: `open-kritt-${first.requestId}`,
      externalScanId: "scan-1",
      launchResolution: "reconciled",
      policyChoices: [],
      fieldErrors: [],
    },
  ];
  act(() =>
    root.render(
      <NewOpenKrittScanDialog {...props} unresolvedRunId={`open-kritt-${first.requestId}`} />,
    ),
  );
  await settle();
  click(button("Check launch status"));
  await settle();

  expect(calls).toHaveLength(2);
  expect(calls[1]?.requestId).toBe(first.requestId);
  expect(calls[1]?.source).toEqual(first.source);
  expect(calls[1]?.configuration).toEqual(first.configuration);
});
