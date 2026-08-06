import { useEffect, useRef, useState } from "react";
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
  unresolvedRunId,
  onComplete,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly priorScanId: string;
  readonly priorRunId: string;
  readonly source: OpenKrittSourceIdentity | null;
  readonly disabled?: boolean;
  /** Undefined while run history loads; null when this parent has no unresolved rescan. */
  readonly unresolvedRunId?: string | null;
  readonly onComplete?: () => void;
}) {
  const rescan = useAtomCommand(integrationEnvironment.rescanOpenKritt, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => randomUUID().replaceAll("-", ""));
  const [policyChoices, setPolicyChoices] = useState<ReadonlyArray<string>>([]);
  const [unknownPending, setUnknownPending] = useState(false);
  const [unresolvedWithoutPayload, setUnresolvedWithoutPayload] = useState(false);
  const pendingSource = useRef<OpenKrittSourceIdentity | null>(null);

  useEffect(() => {
    if (unresolvedRunId === undefined) return;
    const key = `notcodex:open-kritt:pending-rescan:${projectId}:${priorRunId}`;
    if (unresolvedRunId === null) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Hardened browsers can disable storage; server run state remains authoritative.
      }
      setUnresolvedWithoutPayload(false);
      return;
    }
    try {
      const raw = localStorage.getItem(key);
      const persisted = raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
      if (
        persisted === null ||
        typeof persisted.requestId !== "string" ||
        `open-kritt-${persisted.requestId}` !== unresolvedRunId ||
        typeof persisted.source !== "object" ||
        persisted.source === null ||
        (persisted.resolution !== "unknown" && persisted.resolution !== "policy-required") ||
        !Array.isArray(persisted.policyChoices)
      ) {
        setUnresolvedWithoutPayload(true);
        setNotice(
          "An unresolved rescan already exists. Wait for reconciliation before starting another.",
        );
        return;
      }
      pendingSource.current = persisted.source as OpenKrittSourceIdentity;
      setRequestId(persisted.requestId);
      setUnknownPending(persisted.resolution === "unknown");
      setPolicyChoices(
        persisted.resolution === "policy-required"
          ? (persisted.policyChoices as ReadonlyArray<string>)
          : [],
      );
      setUnresolvedWithoutPayload(false);
      setNotice(
        persisted.resolution === "unknown"
          ? "Rescan launch is uncertain. Check this same request before trying another one."
          : "Open Kritt needs an explicit launch-policy choice for this rescan.",
      );
    } catch {
      setUnresolvedWithoutPayload(true);
      setNotice(
        "An unresolved rescan already exists. Wait for reconciliation before starting another.",
      );
    }
  }, [priorRunId, projectId, unresolvedRunId]);

  const persistPending = (
    resolution: "unknown" | "policy-required" | null,
    selectedSource?: OpenKrittSourceIdentity,
    choices: ReadonlyArray<string> = [],
  ) => {
    try {
      const key = `notcodex:open-kritt:pending-rescan:${projectId}:${priorRunId}`;
      if (resolution === null) localStorage.removeItem(key);
      else
        localStorage.setItem(
          key,
          JSON.stringify({ requestId, source: selectedSource, resolution, policyChoices: choices }),
        );
    } catch {
      // The durable child run still blocks a fresh request if storage is unavailable.
    }
  };

  const start = async (launchPolicy?: string) => {
    const selectedSource = pendingSource.current ?? source;
    if (selectedSource === null) {
      setNotice("Select and verify a new immutable source revision before rescanning.");
      return;
    }
    pendingSource.current = selectedSource;
    setPending(true);
    setNotice(null);
    const result = await rescan({
      environmentId,
      input: {
        projectId,
        priorScanId,
        priorRunId,
        requestId,
        source: selectedSource,
        configurationConfirmed: true,
        ...(launchPolicy === undefined ? {} : { launchPolicy }),
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      setNotice("The linked rescan could not be queued.");
      return;
    }
    setPolicyChoices(
      result.value.launchResolution === "policy-required" ? result.value.policyChoices : [],
    );
    if (result.value.launchResolution === "unknown") {
      setUnknownPending(true);
      persistPending("unknown", selectedSource);
      setNotice("Rescan launch is uncertain. Check this same request before trying another one.");
      return;
    }
    if (result.value.launchResolution === "policy-required") {
      setUnknownPending(false);
      persistPending("policy-required", selectedSource, result.value.policyChoices);
      setNotice("Open Kritt needs an explicit launch-policy choice for this rescan.");
      return;
    }
    if (result.value.launchResolution === "rejected") {
      setUnknownPending(false);
      pendingSource.current = null;
      persistPending(null);
      setRequestId(randomUUID().replaceAll("-", ""));
      setNotice(
        result.value.fieldErrors.length === 0
          ? "Open Kritt rejected the rescan configuration."
          : result.value.fieldErrors.map((error) => `${error.field}: ${error.message}`).join("; "),
      );
      return;
    }
    setUnknownPending(false);
    pendingSource.current = null;
    persistPending(null);
    setRequestId(randomUUID().replaceAll("-", ""));
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
        disabled={
          disabled ||
          pending ||
          unknownPending ||
          unresolvedWithoutPayload ||
          policyChoices.length > 0
        }
      >
        {pending ? (
          <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
        ) : (
          <RefreshCwIcon />
        )}
        {pending ? "Queueing…" : "Rescan new revision"}
      </Button>
      {unknownPending ? (
        <Button size="sm" variant="outline" onClick={() => void start()} disabled={pending}>
          {pending ? "Checking…" : "Check rescan status"}
        </Button>
      ) : null}
      {policyChoices.map((choice) => (
        <Button
          key={choice}
          size="sm"
          variant="outline"
          onClick={() => void start(choice)}
          disabled={pending}
        >
          {choice}
        </Button>
      ))}
      {notice ? (
        <span role="status" className="text-xs text-muted-foreground">
          {notice}
        </span>
      ) : null}
    </span>
  );
}
