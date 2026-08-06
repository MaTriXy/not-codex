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
  OpenKrittRescanResult,
  OpenKrittScanLaunchResult,
} from "@notcodex/contracts";

const launchCalls: Array<OpenKrittLaunchScanInput> = [];
const remediationCalls: Array<unknown> = [];
const rescanCalls: Array<unknown> = [];
let launchOutcomes: Array<OpenKrittScanLaunchResult> = [];
let rescanOutcomes: Array<OpenKrittRescanResult> = [];

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
const OLDER_RUN = {
  ...RUN,
  id: "open-kritt-request-older",
  outputSummary: "external-scan:scan-older",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:01:00.000Z",
};
const OLDEST_RUN = {
  ...RUN,
  id: "open-kritt-request-oldest",
  outputSummary: "external-scan:scan-oldest",
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:01:00.000Z",
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
const SECOND_FINDING = {
  ...FINDING,
  id: "finding-2",
  summary: "Second paged finding",
  rank: 2,
} as OpenKrittFinding;

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { readonly children?: unknown }) => children,
}));

vi.mock("../../state/integrations", () => ({
  integrationEnvironment: {
    list: () => ({ kind: "list" }),
    listOpenKrittRuns: (request: { readonly input: { readonly cursor?: unknown } }) => ({
      kind: "runs",
      cursor: request.input.cursor ?? null,
    }),
    listOpenKrittFindings: (request: {
      readonly input: { readonly scanId: string; readonly cursor: string | null };
    }) => ({
      kind: "findings",
      scanId: request.input.scanId,
      cursor: request.input.cursor,
    }),
    getOpenKrittFinding: () => ({ kind: "finding" }),
    compareOpenKrittScans: () => ({ kind: "comparison" }),
    launchOpenKrittScan: { kind: "launch" },
    refreshOpenKrittCatalog: { kind: "catalog" },
    previewOpenKrittSnapshot: { kind: "preview" },
    createOpenKrittSnapshot: { kind: "create-snapshot" },
    launchOpenKrittRemediation: { kind: "remediation" },
    rescanOpenKritt: { kind: "rescan" },
  },
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (
    atom: { readonly kind: string; readonly cursor?: unknown; readonly scanId?: string } | null,
  ) => {
    const data = (() => {
      switch (atom?.kind) {
        case "list":
          return { integrations: [{ id: "open-kritt", state: "ready" }] };
        case "runs":
          return atom.cursor === null
            ? {
                runs: [RUN, OLDER_RUN],
                nextCursor: { createdAt: OLDER_RUN.createdAt, id: OLDER_RUN.id },
                unresolvedRuns: [],
              }
            : { runs: [OLDEST_RUN], nextCursor: null, unresolvedRuns: [] };
        case "findings":
          return atom.cursor === null
            ? { items: [FINDING], nextCursor: "offset:1", stale: false }
            : { items: [SECOND_FINDING], nextCursor: null, stale: false };
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
      case "catalog":
        return {
          _tag: "Success",
          value: {
            workflows: [{ id: "wf-1", name: "Default workflow" }],
            postScripts: [{ id: "ps-1", name: "Default post-script" }],
            agentSkills: [],
            severityRankers: [{ id: "ranker-1", name: "Default ranker" }],
            modelProviders: [],
          },
        };
      case "remediation":
        remediationCalls.push(value);
        return { _tag: "Success", value: { threadId: "thread-1" } };
      case "rescan":
        rescanCalls.push(value);
        return { _tag: "Success", value: rescanOutcomes.shift() };
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

function acceptedRescan(overrides: Partial<OpenKrittRescanResult> = {}): OpenKrittRescanResult {
  return {
    childRunId: "open-kritt-rescan-request",
    externalScanId: "scan-rescan",
    launchResolution: "accepted",
    policyChoices: [],
    fieldErrors: [],
    reusedPriorConfiguration: true,
    configuration: {
      workflowId: "wf-1",
      postScriptIds: ["ps-1"],
      agentSkillIds: [],
      severityRankerId: "ranker-1",
      providerId: "provider-1",
      modelId: "model-1",
      thinkingEffort: "high",
      jobLimit: 1,
    },
    ...overrides,
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
  type("#open-kritt-post-scripts", "ps-1");
  type("#open-kritt-severity-ranker", "ranker-1");
}

beforeEach(() => {
  launchCalls.length = 0;
  remediationCalls.length = 0;
  rescanCalls.length = 0;
  launchOutcomes = [];
  rescanOutcomes = [acceptedRescan()];
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
    configuration: {
      workflowId: "wf-1",
      providerId: "provider-1",
      modelId: "model-1",
      postScriptIds: ["ps-1"],
      severityRankerId: "ranker-1",
    },
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
  type("#open-kritt-commit-sha", "e".repeat(40));

  click(choice);
  await settle();

  expect(launchCalls).toHaveLength(2);
  // The whole point: the elected retry is the same launch, so Open Kritt
  // reconciles it instead of starting a second paid scan.
  expect(launchCalls[1]?.requestId).toBe(launchCalls[0]?.requestId);
  expect(launchCalls[1]?.source).toEqual(launchCalls[0]?.source);
  expect(launchCalls[1]?.configuration).toEqual(launchCalls[0]?.configuration);
  expect(launchCalls[1]?.launchPolicy).toBe("launch-concurrently");
  expect(container.textContent).toContain("Scan queued.");
});

it("keeps an uncertain launch request id until reconciliation resolves it", async () => {
  launchOutcomes = [
    {
      run: "open-kritt-request-uncertain",
      externalScanId: null,
      launchResolution: "unknown",
      policyChoices: [],
      fieldErrors: [],
    },
    { ...accepted(), launchResolution: "reconciled" },
  ];
  fillScanForm();
  click(buttonByText("Launch scan"));
  await settle();

  expect(buttonByText("Launch scan").disabled).toBe(true);
  expect(container.textContent).toContain("Check launch status");
  click(buttonByText("Check launch status"));
  await settle();

  expect(launchCalls).toHaveLength(2);
  expect(launchCalls[1]?.requestId).toBe(launchCalls[0]?.requestId);
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

it("surfaces rescan launch-policy outcomes and answers with the same request id", async () => {
  rescanOutcomes = [
    acceptedRescan({
      externalScanId: null,
      launchResolution: "policy-required",
      policyChoices: ["immediate", "queue"],
    }),
    acceptedRescan(),
  ];
  type("#security-rescan-sha", "d".repeat(40));
  click(buttonByText("Rescan new revision"));
  await settle();

  expect(container.textContent).toContain("explicit launch-policy choice");
  click(buttonByText("immediate"));
  await settle();

  expect(rescanCalls).toHaveLength(2);
  const first = rescanCalls[0] as { readonly input: { readonly requestId: string } };
  const second = rescanCalls[1] as {
    readonly input: { readonly requestId: string; readonly launchPolicy: string };
  };
  expect(second.input.requestId).toBe(first.input.requestId);
  expect(second.input.launchPolicy).toBe("immediate");
});

it("lets the user select findings from an older retained scan", async () => {
  expect(container.textContent).toContain("scan scan-1");
  const viewButtons = [...container.querySelectorAll("button")].filter((button) =>
    button.textContent?.includes("View findings"),
  );
  expect(viewButtons).toHaveLength(1);
  click(viewButtons[0]!);
  await settle();
  expect(container.textContent).toContain("scan scan-older");
});

it("pages through retained runs and every normalized finding", async () => {
  expect(container.textContent).not.toContain("scan-oldest");
  click(buttonByText("Load older scans"));
  await settle();
  expect(container.textContent).toContain("open-kritt-request-oldest");

  expect(container.textContent).not.toContain("Second paged finding");
  click(buttonByText("Load more findings"));
  await settle();
  expect(container.textContent).toContain("Second paged finding");
});

it("returns run history to the first page before refreshing", async () => {
  click(buttonByText("Load older scans"));
  await settle();
  expect(container.textContent).toContain("open-kritt-request-oldest");

  click(buttonByText("Refresh"));
  await settle();
  expect(container.textContent).not.toContain("open-kritt-request-oldest");
  expect(container.textContent).toContain("open-kritt-request-1");
});

it("refuses to launch until the required post-script and severity-ranker selections are made", async () => {
  launchOutcomes = [accepted()];
  // The normal path: the settings page carries only workflow/provider/model
  // defaults, so nothing pre-fills these two required catalog selections.
  click(buttonByText("Prepare scan"));
  type("#open-kritt-commit-sha", "b".repeat(40));
  type("#open-kritt-workflow", "wf-1");
  type("#open-kritt-provider", "provider-1");
  type("#open-kritt-model", "model-1");
  await settle();

  // Launching here would build `postScriptIds: []` / `severityRankerId: null`,
  // which upstream cannot turn into a POST /api/scans body at all.
  expect(buttonByText("Launch scan").disabled).toBe(true);
  click(buttonByText("Launch scan"));
  await settle();
  expect(launchCalls).toHaveLength(0);

  // The catalog loaded when the form opened, so both selections are answerable.
  expect(query("#open-kritt-post-script-options").querySelectorAll("option")).toHaveLength(1);
  expect(query("#open-kritt-severity-ranker-options").querySelectorAll("option")).toHaveLength(1);

  type("#open-kritt-post-scripts", "ps-1");
  type("#open-kritt-severity-ranker", "ranker-1");
  await settle();

  expect(buttonByText("Launch scan").disabled).toBe(false);
  click(buttonByText("Launch scan"));
  await settle();

  expect(launchCalls).toHaveLength(1);
  expect(launchCalls[0]?.configuration).toMatchObject({
    postScriptIds: ["ps-1"],
    severityRankerId: "ranker-1",
  });
});
