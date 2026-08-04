// @vitest-environment happy-dom

/**
 * Interaction coverage for the project Security flow.
 *
 * The other suites in this directory exercise extracted helpers and static
 * rendered markup, which cannot catch a control that is never mounted or a
 * handler wired to the wrong callback — both of which have already shipped on
 * this branch and were only caught by review. These tests therefore mount the
 * real page against a deterministic fake connector and drive real DOM events:
 * launch -> 409 launch-policy question -> elected retry -> accepted -> findings
 * -> remediation -> rescan -> comparison.
 *
 * The single most important assertion is that answering a launch-policy question
 * resubmits the SAME request id, because that is what keeps an elected retry
 * from creating a second paid scan.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type {
  OpenKrittFinding,
  OpenKrittLaunchScanInput,
  OpenKrittScanLaunchResult,
} from "@notcodex/contracts";

const launchCalls: Array<OpenKrittLaunchScanInput> = [];
const remediationCalls: Array<unknown> = [];
const rescanCalls: Array<unknown> = [];
let launchOutcomes: Array<OpenKrittScanLaunchResult> = [];

const RUN = {
  id: "open-kritt-request-1",
  source: "open-kritt",
  state: "succeeded",
  projectId: "project-1",
  outputSummary: "external-scan:scan-1",
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:01:00.000Z",
  timeline: [],
};

const FINDING: OpenKrittFinding = {
  id: "finding-1",
  scanId: "scan-1",
  severity: "high",
  rank: 1,
  type: "sql-injection",
  summary: "Unparameterized query",
  explanation: "The query concatenates untrusted input.",
  location: { path: "src/db.ts", line: 42, column: null },
  triggerFlow: ["handler", "query"],
  maliciousInput: "' OR 1=1 --",
  exploitability: "likely",
  maliciousActor: "unauthenticated user",
  canonical: true,
  duplicateOf: null,
  triage: "untriaged",
  source: { kind: "remote", repoFull: "acme/app", commitSha: "a".repeat(40) },
  cwe: "CWE-89",
  cvss: 8.6,
  upstreamUrl: null,
} as unknown as OpenKrittFinding;

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { readonly children?: unknown }) => children,
}));

vi.mock("../../state/integrations", () => ({
  integrationEnvironment: {
    list: () => ({ kind: "list" }),
    listOpenKrittRuns: () => ({ kind: "runs" }),
    listOpenKrittFindings: () => ({ kind: "findings" }),
    getOpenKrittFinding: () => ({ kind: "finding" }),
    compareOpenKrittScans: () => ({ kind: "comparison" }),
    launchOpenKrittScan: { kind: "launch" },
    previewOpenKrittSnapshot: { kind: "preview" },
    createOpenKrittSnapshot: { kind: "create-snapshot" },
    launchOpenKrittRemediation: { kind: "remediation" },
    rescanOpenKritt: { kind: "rescan" },
  },
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: { readonly kind: string } | null) => {
    const data = (() => {
      switch (atom?.kind) {
        case "list":
          return { integrations: [{ id: "open-kritt", state: "ready" }] };
        case "runs":
          return { runs: [RUN], nextCursor: null };
        case "findings":
          return { items: [FINDING], nextCursor: null };
        case "comparison":
          return {
            priorScanId: "scan-0",
            currentScanId: "scan-1",
            conclusion: "not-reproduced",
            reason: null,
            sameSourceRevision: false,
            sameConfiguration: true,
            stillPresent: [],
            disappeared: [],
          };
        default:
          return null;
      }
    })();
    return { data, error: null, isPending: false, refresh: () => {} };
  },
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: { readonly kind: string }) => async (value: unknown) => {
    switch (command.kind) {
      case "launch": {
        launchCalls.push((value as { readonly input: OpenKrittLaunchScanInput }).input);
        const next = launchOutcomes.shift();
        return { _tag: "Success", value: next };
      }
      case "remediation":
        remediationCalls.push(value);
        return { _tag: "Success", value: { threadId: "thread-1" } };
      case "rescan":
        rescanCalls.push(value);
        return {
          _tag: "Success",
          value: {
            reusedPriorConfiguration: true,
            configuration: {
              workflowId: "wf-1",
              modelId: "model-1",
              thinkingEffort: "high",
              jobLimit: 1,
            },
          },
        };
      default:
        return { _tag: "Success", value: null };
    }
  },
}));

vi.mock("../../state/entities", () => ({
  useProject: () => ({
    id: "project-1",
    repositoryIdentity: { displayName: "acme/app", owner: "acme", name: "app" },
    defaultModelSelection: { providerId: "anthropic", modelId: "claude-opus-5" },
  }),
}));

vi.mock("../../state/environments", () => ({
  useEnvironment: () => ({ connection: { phase: "connected" } }),
}));

vi.mock("../../hooks/useSettings", () => ({
  usePrimarySettings: (select: (settings: unknown) => unknown) =>
    select({
      integrations: {
        openKritt: {
          defaultWorkflowId: "wf-1",
          defaultPostScriptIds: [],
          defaultAgentSkillIds: [],
          defaultSeverityRankerId: null,
          defaultProviderId: "provider-1",
          defaultModelId: "model-1",
        },
      },
    }),
}));

const { ProjectSecurityPage } = await import("./ProjectSecurityPage");

let container: HTMLDivElement;
let root: Root;

function accepted(): OpenKrittScanLaunchResult {
  return {
    run: "open-kritt-request-1",
    externalScanId: "scan-1",
    launchResolution: "accepted",
    policyChoices: [],
    fieldErrors: [],
  };
}

function query<T extends Element>(selector: string): T {
  const found = container.querySelector<T>(selector);
  if (found === null) throw new Error(`No element matched ${selector}`);
  return found;
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(text),
  );
  if (found === undefined) throw new Error(`No button contains ${JSON.stringify(text)}`);
  return found;
}

function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Sets a controlled React input the way a real keystroke would. */
function type(selector: string, value: string): void {
  const input = query<HTMLInputElement>(selector);
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

function fillScanForm(): void {
  click(buttonByText("Prepare scan"));
  type("#open-kritt-commit-sha", "b".repeat(40));
  type("#open-kritt-workflow", "wf-1");
  type("#open-kritt-provider", "provider-1");
  type("#open-kritt-model", "model-1");
}

beforeEach(() => {
  launchCalls.length = 0;
  remediationCalls.length = 0;
  rescanCalls.length = 0;
  launchOutcomes = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <ProjectSecurityPage environmentId={"env-1" as never} projectId={"project-1" as never} />,
    );
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

it("launches a scan for a full commit SHA and reports it queued", async () => {
  launchOutcomes = [accepted()];
  fillScanForm();
  click(buttonByText("Launch scan"));
  await settle();

  expect(launchCalls).toHaveLength(1);
  expect(launchCalls[0]).toMatchObject({
    projectId: "project-1",
    source: { kind: "remote", repoFull: "acme/app", commitSha: "b".repeat(40) },
    configuration: { workflowId: "wf-1", providerId: "provider-1", modelId: "model-1" },
  });
  expect(launchCalls[0]?.launchPolicy).toBeUndefined();
  expect(container.textContent).toContain("Scan queued.");
});

it("offers the upstream launch-policy choice and reuses the request id when the user answers", async () => {
  launchOutcomes = [
    {
      run: "open-kritt-request-1",
      externalScanId: null,
      launchResolution: "policy-required",
      policyChoices: ["wait", "launch-concurrently"],
      fieldErrors: [],
    },
    accepted(),
  ];
  fillScanForm();
  click(buttonByText("Launch scan"));
  await settle();

  // The question reaches the user as a real choice, not an opaque error.
  expect(container.textContent).toContain("Choose how to proceed");
  const choice = buttonByText("launch-concurrently");

  click(choice);
  await settle();

  expect(launchCalls).toHaveLength(2);
  // The whole point: the elected retry is the same launch, so Open Kritt
  // reconciles it instead of starting a second paid scan.
  expect(launchCalls[1]?.requestId).toBe(launchCalls[0]?.requestId);
  expect(launchCalls[1]?.launchPolicy).toBe("launch-concurrently");
  expect(container.textContent).toContain("Scan queued.");
});

it("attaches upstream field errors to the controls that caused them", async () => {
  launchOutcomes = [
    {
      run: "open-kritt-request-1",
      externalScanId: null,
      launchResolution: "rejected",
      policyChoices: [],
      fieldErrors: [
        { field: "commit_sha", message: "commit_sha is not reachable" },
        { field: "workflow_id", message: "workflow_id is not installed" },
      ],
    },
  ];
  fillScanForm();
  click(buttonByText("Launch scan"));
  await settle();

  expect(query("#open-kritt-commit-sha-error").textContent).toBe("commit_sha is not reachable");
  expect(query("#open-kritt-workflow-error").textContent).toBe("workflow_id is not installed");
  expect(query<HTMLInputElement>("#open-kritt-commit-sha").getAttribute("aria-invalid")).toBe(
    "true",
  );
  // A rejected launch is not a started scan.
  expect(container.textContent).not.toContain("Scan queued.");
});

it("routes a finding to a governed remediation thread from the exact scanned commit", async () => {
  expect(container.textContent).toContain("Unparameterized query");
  click(buttonByText("Fix with Not Codex"));
  await settle();

  expect(remediationCalls).toHaveLength(1);
  expect(remediationCalls[0]).toMatchObject({
    input: {
      projectId: "project-1",
      findingId: "finding-1",
      targetCommitSha: "a".repeat(40),
      worktreePreference: "from-exact-commit",
    },
  });
  expect(container.textContent).toContain("Open remediation thread");
});

it("requires a new immutable revision before a rescan and then links the comparison", async () => {
  click(buttonByText("Rescan new revision"));
  await settle();
  expect(rescanCalls).toHaveLength(0);
  expect(container.textContent).toContain("verify a new immutable source revision");

  type("#security-rescan-sha", "c".repeat(40));
  click(buttonByText("Rescan new revision"));
  await settle();

  expect(rescanCalls).toHaveLength(1);
  expect(rescanCalls[0]).toMatchObject({
    input: { priorScanId: "scan-1", source: { kind: "remote", commitSha: "c".repeat(40) } },
  });
});
