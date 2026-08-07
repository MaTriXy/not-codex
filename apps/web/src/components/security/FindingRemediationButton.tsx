import { useState } from "react";
import type {
  EnvironmentId,
  ModelSelection,
  OpenKrittFinding,
  ProjectId,
  RuntimeMode,
} from "@notcodex/contracts";
import { Link } from "@tanstack/react-router";
import { LoaderCircleIcon, WrenchIcon } from "lucide-react";

import { integrationEnvironment } from "../../state/integrations";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";

export function FindingRemediationButton({
  environmentId,
  projectId,
  scanId,
  finding,
  modelSelection,
  runtimeMode = "approval-required",
  disabled = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly scanId: string;
  readonly finding: OpenKrittFinding;
  readonly modelSelection: ModelSelection | null;
  readonly runtimeMode?: RuntimeMode;
  readonly disabled?: boolean;
}) {
  const launch = useAtomCommand(integrationEnvironment.launchOpenKrittRemediation, {
    reportFailure: false,
  });
  const [threadId, setThreadId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const start = async () => {
    if (modelSelection === null) {
      setNotice("Choose a Not Codex provider/model for remediation first.");
      return;
    }
    const targetCommitSha = finding.source.commitSha;
    if (targetCommitSha === null) {
      setNotice("This finding has no immutable commit, so remediation is unavailable.");
      return;
    }
    setPending(true);
    setNotice(null);
    const result = await launch({
      environmentId,
      input: {
        projectId,
        findingId: finding.id,
        targetCommitSha,
        modelSelection,
        runtimeMode,
        worktreePreference: "from-exact-commit",
        evidence: {
          type: finding.type,
          severity: finding.severity,
          summary: finding.summary,
          explanation: finding.explanation,
          path: finding.location.path,
          line: finding.location.line,
          triggerFlow: finding.triggerFlow,
          maliciousInput: finding.maliciousInput,
          exploitability: finding.exploitability,
          maliciousActor: finding.maliciousActor,
          cwe: finding.cwe ?? null,
          cvss: finding.cvss ?? null,
        },
      },
    });
    setPending(false);
    if (result._tag === "Success") {
      setThreadId(result.value.threadId);
    } else {
      setNotice("The governed remediation thread could not be started.");
    }
  };

  if (threadId !== null) {
    return (
      <Button
        size="xs"
        variant="outline"
        aria-label={`Open remediation thread for finding ${finding.id} from scan ${scanId}`}
        render={<Link to="/$environmentId/$threadId" params={{ environmentId, threadId }} />}
      >
        Open remediation thread
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="xs"
        variant="outline"
        onClick={() => void start()}
        disabled={disabled || pending}
      >
        {pending ? (
          <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
        ) : (
          <WrenchIcon />
        )}
        Fix with Not Codex
      </Button>
      {notice ? (
        <span role="alert" className="text-xs text-destructive-foreground">
          {notice}
        </span>
      ) : null}
    </span>
  );
}
