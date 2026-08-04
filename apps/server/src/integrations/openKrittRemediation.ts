import type { ModelSelection, RuntimeMode } from "@notcodex/contracts";
import {
  buildRemediationEvidencePacket,
  type OpenKrittRemediationEvidencePacket,
} from "./openKrittEvidence.ts";

const FULL_SHA = /^[0-9a-f]{40}$/;

type RemediationEvidenceInput = {
  readonly type: string;
  readonly severity: "critical" | "high" | "medium" | "low" | "info" | "unknown";
  readonly summary: string;
  readonly explanation: string;
  readonly path: string;
  readonly line: number | null;
  readonly triggerFlow?: ReadonlyArray<string>;
  readonly maliciousInput?: string | null;
  readonly exploitability?: "likely" | "possible" | "unlikely" | "unknown";
  readonly maliciousActor?: string | null;
  readonly cwe?: string | null;
  readonly cvss?: number | null;
};

type OpenKrittModelSelection = Omit<ModelSelection, "instanceId"> & {
  readonly instanceId: string;
};

export function buildOpenKrittRemediationLaunch(input: {
  readonly projectId: string;
  readonly scanId: string;
  readonly findingId: string;
  readonly sourceCommitSha: string;
  readonly currentRepoFull?: string;
  readonly scannedRepoFull?: string;
  readonly worktreePreference: "from-exact-commit" | "existing-clean-worktree";
  readonly modelSelection: OpenKrittModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly evidence: RemediationEvidenceInput;
}): {
  readonly projectId: string;
  readonly sourceCommitSha: string;
  readonly worktree: { readonly startPoint: string; readonly preference: string };
  readonly execution: {
    readonly kind: "ordinary-not-codex-thread";
    readonly modelSelection: OpenKrittModelSelection;
    readonly runtimeMode: RuntimeMode;
    readonly evidence: OpenKrittRemediationEvidencePacket;
  };
} {
  if (!FULL_SHA.test(input.sourceCommitSha))
    throw new Error("Remediation requires the exact scanned commit SHA.");
  if (
    input.currentRepoFull !== undefined &&
    input.scannedRepoFull !== undefined &&
    input.currentRepoFull !== input.scannedRepoFull
  )
    throw new Error("Current project repository does not match the scanned repository.");
  const evidence = buildRemediationEvidencePacket({
    ...input.evidence,
    triggerFlow: input.evidence.triggerFlow ?? [],
    maliciousInput: input.evidence.maliciousInput ?? null,
    exploitability: input.evidence.exploitability ?? "unknown",
    maliciousActor: input.evidence.maliciousActor ?? null,
    cwe: input.evidence.cwe ?? null,
    cvss: input.evidence.cvss ?? null,
    findingId: input.findingId,
    scanId: input.scanId,
    projectId: input.projectId,
    targetCommitSha: input.sourceCommitSha,
  });
  return {
    projectId: input.projectId,
    sourceCommitSha: input.sourceCommitSha,
    worktree: { startPoint: input.sourceCommitSha, preference: input.worktreePreference },
    execution: {
      kind: "ordinary-not-codex-thread",
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode,
      evidence,
    },
  };
}

export function buildOpenKrittRescanLaunch(input: {
  readonly projectId: string;
  readonly priorRunId: string;
  readonly priorScanId: string;
  readonly remediationThreadId?: string;
  readonly priorCommitSha: string;
  readonly nextCommitSha: string;
  readonly configurationConfirmed: boolean;
}): {
  readonly projectId: string;
  readonly parentRunId: string;
  readonly priorScanId: string;
  readonly remediationThreadId: string | null;
  readonly sourceCommitSha: string;
} {
  if (!input.configurationConfirmed) throw new Error("Rescan configuration must be confirmed.");
  if (!FULL_SHA.test(input.nextCommitSha) || input.nextCommitSha === input.priorCommitSha)
    throw new Error("Rescan requires a new immutable revision.");
  return {
    projectId: input.projectId,
    parentRunId: input.priorRunId,
    priorScanId: input.priorScanId,
    remediationThreadId: input.remediationThreadId ?? null,
    sourceCommitSha: input.nextCommitSha,
  };
}
