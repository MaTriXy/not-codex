// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { OpenKrittRescanInput, OpenKrittRescanResult } from "@notcodex/contracts";

const calls: Array<OpenKrittRescanInput> = [];
let outcomes: Array<OpenKrittRescanResult> = [];
let commandOverride:
  | ((value: { readonly input: OpenKrittRescanInput }) => Promise<unknown>)
  | null = null;

vi.mock("../../state/integrations", () => ({
  integrationEnvironment: { rescanOpenKritt: { kind: "rescan" } },
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => async (value: { readonly input: OpenKrittRescanInput }) => {
    calls.push(value.input);
    if (commandOverride !== null) return commandOverride(value);
    return { _tag: "Success", value: outcomes.shift() };
  },
}));

const { RescanButton } = await import("./RescanButton");

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

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  calls.length = 0;
  outcomes = [];
  commandOverride = null;
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

it("persists the child request and source before the rescan RPC settles", async () => {
  let resolveCommand!: (value: unknown) => void;
  commandOverride = () =>
    new Promise((resolve) => {
      resolveCommand = resolve;
    });
  const props = {
    environmentId: "environment-1" as never,
    projectId: "project-pre-rpc" as never,
    priorScanId: "scan-pre-rpc",
    priorRunId: "run-pre-rpc",
    source: {
      kind: "remote" as const,
      repoFull: "acme/app",
      commitSha: "d".repeat(40),
    },
  };

  act(() => root.render(<RescanButton {...props} unresolvedRunId={null} />));
  click(button("Rescan new revision"));

  const key = "notcodex:open-kritt:pending-rescan:project-pre-rpc:run-pre-rpc";
  const persisted = JSON.parse(localStorage.getItem(key) ?? "null") as {
    readonly requestId: string;
    readonly source: { readonly commitSha: string };
  } | null;
  expect(persisted?.requestId).toMatch(/^[a-f0-9]+$/);
  expect(persisted?.source.commitSha).toBe("d".repeat(40));

  await act(async () => {
    resolveCommand({ _tag: "Failure" });
    await Promise.resolve();
  });
  // A transport failure is not authoritative: keep the marker so a later
  // reload can reconcile the same child request safely.
  expect(localStorage.getItem(key)).not.toBeNull();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

it("rehydrates an unresolved rescan request and exact source after remount", async () => {
  const configuration = {
    workflowId: "workflow-1",
    postScriptIds: ["post-1"],
    agentSkillIds: [],
    severityRankerId: "ranker-1",
    providerId: "provider-1",
    modelId: "model-1",
    thinkingEffort: "high" as const,
    jobLimit: 1,
  };
  outcomes = [
    {
      childRunId: "pending",
      externalScanId: null,
      launchResolution: "unknown",
      policyChoices: [],
      fieldErrors: [],
      configuration,
      reusedPriorConfiguration: true,
    },
  ];
  const props = {
    environmentId: "environment-1" as never,
    projectId: "project-1" as never,
    priorScanId: "scan-1",
    priorRunId: "run-1",
    source: {
      kind: "remote" as const,
      repoFull: "acme/app",
      commitSha: "a".repeat(40),
    },
  };

  act(() => root.render(<RescanButton {...props} unresolvedRunId={null} />));
  click(button("Rescan new revision"));
  await settle();
  const first = calls[0]!;

  act(() => root.unmount());
  root = createRoot(container);
  outcomes = [
    {
      childRunId: `open-kritt-${first.requestId}`,
      externalScanId: "scan-2",
      launchResolution: "reconciled",
      policyChoices: [],
      fieldErrors: [],
      configuration,
      reusedPriorConfiguration: true,
    },
  ];
  act(() =>
    root.render(
      <RescanButton
        {...props}
        source={{ ...props.source, commitSha: "b".repeat(40) }}
        unresolvedRunId={`open-kritt-${first.requestId}`}
      />,
    ),
  );
  await settle();
  click(button("Check rescan status"));
  await settle();

  expect(calls).toHaveLength(2);
  expect(calls[1]?.requestId).toBe(first.requestId);
  expect(calls[1]?.source).toEqual(first.source);
});
