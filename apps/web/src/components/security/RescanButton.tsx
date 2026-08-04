import { useState } from "react";
import type { EnvironmentId, OpenKrittSourceIdentity, ProjectId } from "@notcodex/contracts";
import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";

import { integrationEnvironment } from "../../state/integrations";
import { useAtomCommand } from "../../state/use-atom-command";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";

export function RescanButton({
  environmentId,
  projectId,
  priorScanId,
  priorRunId,
  source,
  disabled = false,
  onComplete,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly priorScanId: string;
  readonly priorRunId: string;
  readonly source: OpenKrittSourceIdentity | null;
  readonly disabled?: boolean;
  readonly onComplete?: () => void;
}) {
  const rescan = useAtomCommand(integrationEnvironment.rescanOpenKritt, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const start = async () => {
    if (source === null) {
      setNotice("Select and verify a new immutable source revision before rescanning.");
      return;
    }
    setPending(true);
    setNotice(null);
    const result = await rescan({
      environmentId,
      input: {
        projectId,
        priorScanId,
        priorRunId,
        requestId: randomUUID().replaceAll("-", ""),
        source,
        configurationConfirmed: true,
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      setNotice("The linked rescan could not be queued.");
      return;
    }
    // Disclose exactly which configuration ran: the server reuses the prior
    // scan's persisted configuration so the two scans stay comparable.
    const used = result.value.configuration;
    setNotice(
      `${result.value.reusedPriorConfiguration ? "Reused the prior configuration" : "Applied the confirmed configuration"}: workflow ${used.workflowId}, model ${used.modelId}, effort ${used.thinkingEffort}, job limit ${used.jobLimit}.`,
    );
    onComplete?.();
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => void start()}
        disabled={disabled || pending}
      >
        {pending ? (
          <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
        ) : (
          <RefreshCwIcon />
        )}
        {pending ? "Queueing…" : "Rescan new revision"}
      </Button>
      {notice ? (
        <span role="status" className="text-xs text-muted-foreground">
          {notice}
        </span>
      ) : null}
    </span>
  );
}
