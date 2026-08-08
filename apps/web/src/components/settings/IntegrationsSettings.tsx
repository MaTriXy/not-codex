import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ProviderInstanceId,
  type EnvironmentId,
  type IntegrationDescriptor,
  type IntegrationState,
  type MonkeyLoopyValidateResult,
  type RuntimeMode,
} from "@notcodex/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import {
  BlocksIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  FlaskConicalIcon,
  LoaderCircleIcon,
  PlayIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { integrationEnvironment } from "../../state/integrations";
import { useEnvironments, usePrimaryEnvironment } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { randomUUID } from "../../lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { LoopAnyDiagnosticsPanel } from "../integrations/LoopAnyDiagnosticsPanel";
import {
  DEFAULT_MONKEY_LOOPY_SPEC,
  isCurrentLoopSpecExecutionReady,
  isCurrentLoopSpecRequest,
  LOOPY_RUNTIME_MODE_OPTIONS,
  normalizeIntegrationRunTimeout,
  parseRunInputsJson,
  resolveRunEnvironmentSelection,
} from "./IntegrationsRun.logic";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

type Notice = { readonly tone: "success" | "error" | "info"; readonly message: string };

export type OpenKrittSettingsCardInput = {
  readonly enabled: boolean;
  readonly tokenConfigured: boolean;
  readonly serverUrl: string;
  readonly health: string;
};

export function deriveOpenKrittSettingsCard(input: OpenKrittSettingsCardInput) {
  return {
    title: "Open Kritt",
    enabled: input.enabled,
    tokenConfigured: input.tokenConfigured,
    health: input.health,
    links: [
      { label: "Source and AGPL license", href: "https://github.com/Kritt-ai/open-kritt" },
      { label: "Official documentation", href: "https://docs.kritt.ai" },
    ],
    warning:
      "Open Kritt is a separately installed AGPL service. Keep it private behind operator network authentication and review model-provider data egress before enabling it.",
  } as const;
}

export type OpenKrittSettingsDraft = {
  readonly enabled: boolean;
  readonly serverUrl: string;
  readonly authMode: "none" | "bearer";
  readonly tokenConfigured: boolean;
  readonly replacementToken: string;
  readonly acknowledgeNonLoopbackWarning: boolean;
  readonly snapshotRoot?: string | null;
  /** Bounded operator allowlist of private IPs/CIDRs; empty means loopback only. */
  readonly allowedPrivateAddresses?: readonly string[];
  readonly pollIntervalSeconds?: number;
  readonly pollConcurrency?: number;
  readonly defaultWorkflowId?: string | null;
  readonly defaultProviderId?: string | null;
  readonly defaultModelId?: string | null;
};

/** Splits the operator textarea into bounded literal address entries. */
export function parseOpenKrittAllowedAddressesInput(value: string): readonly string[] {
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Mirrors the server contract: literal IPv4/IPv6 addresses or CIDR ranges only. */
const OPEN_KRITT_PRIVATE_ADDRESS = /^[0-9A-Fa-f.:]+(?:\/\d{1,3})?$/;

function isOpenKrittAuthMode(value: string): value is OpenKrittSettingsDraft["authMode"] {
  return value === "none" || value === "bearer";
}

function isLoopbackOpenKrittUrl(serverUrl: string): boolean {
  try {
    const url = new URL(serverUrl.trim());
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    // Mirrors isOpenKrittLoopbackHostname on the server, including all of
    // 127.0.0.0/8 rather than only the canonical address.
    return (
      hostname === "localhost" ||
      hostname === "::1" ||
      /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname)
    );
  } catch {
    return false;
  }
}

export function validateOpenKrittSettingsDraft(draft: OpenKrittSettingsDraft):
  | {
      readonly ok: true;
      readonly settings: Omit<
        OpenKrittSettingsDraft,
        "replacementToken" | "acknowledgeNonLoopbackWarning"
      >;
    }
  | { readonly ok: false; readonly message: string } {
  const serverUrl = draft.serverUrl.trim();
  if (draft.enabled && serverUrl.length === 0)
    return {
      ok: false,
      message: "Enter a private Open Kritt server URL before enabling the connector.",
    };
  if (serverUrl.length > 0) {
    let url: URL;
    try {
      url = new URL(serverUrl);
    } catch {
      return { ok: false, message: "Enter a valid Open Kritt server URL." };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, message: "Open Kritt server URLs must use HTTP or HTTPS." };
    }
    if (url.protocol === "http:" && !isLoopbackOpenKrittUrl(serverUrl)) {
      return { ok: false, message: "Open Kritt requires HTTPS for non-loopback endpoints." };
    }
    if (url.username || url.password || url.search || url.hash) {
      return {
        ok: false,
        message: "The Open Kritt URL cannot contain credentials, queries, or fragments.",
      };
    }
    // Mirrors normalizeOpenKrittBasePath on the server: a reverse-proxy base path
    // is supported, but only as bounded literal segments with no traversal or
    // percent-encoding, so the client and server agree on the approved prefix.
    if (url.pathname !== "" && url.pathname !== "/") {
      const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
      const valid =
        !url.pathname.includes("%") &&
        segments.length > 0 &&
        segments.length <= 8 &&
        segments.every(
          (segment) =>
            segment !== "." && segment !== ".." && /^[A-Za-z0-9._~-]{1,64}$/.test(segment),
        );
      if (!valid) {
        return {
          ok: false,
          message:
            "The Open Kritt URL base path may only contain simple path segments, such as /kritt.",
        };
      }
    }
    if (
      !isLoopbackOpenKrittUrl(serverUrl) &&
      draft.enabled &&
      !draft.acknowledgeNonLoopbackWarning
    ) {
      return {
        ok: false,
        message:
          "Acknowledge that the non-loopback Open Kritt service is private and protected by authentication/network policy.",
      };
    }
  }
  const allowedPrivateAddresses = draft.allowedPrivateAddresses ?? [];
  if (allowedPrivateAddresses.length > 8) {
    return { ok: false, message: "At most 8 allowed private Open Kritt addresses are supported." };
  }
  if (allowedPrivateAddresses.some((entry) => !OPEN_KRITT_PRIVATE_ADDRESS.test(entry))) {
    return {
      ok: false,
      message:
        "Allowed private addresses must be literal IP addresses or CIDR ranges, such as 192.168.10.20 or 10.1.0.0/24.",
    };
  }
  if (
    draft.enabled &&
    draft.authMode === "bearer" &&
    !draft.tokenConfigured &&
    draft.replacementToken.trim().length === 0
  ) {
    return { ok: false, message: "Enter a bearer token before enabling authenticated Open Kritt." };
  }
  return {
    ok: true,
    settings: {
      enabled: draft.enabled,
      serverUrl,
      authMode: draft.authMode,
      tokenConfigured: draft.tokenConfigured,
    },
  };
}

Object.defineProperty(validateOpenKrittSettingsDraft, "toJSON", {
  value: () => "Open Kritt settings validator",
  enumerable: false,
});

function FieldLabel({ children }: { readonly children: ReactNode }) {
  return (
    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{children}</label>
  );
}

function RunSelect({
  label,
  value,
  onChange,
  children,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly children: ReactNode;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
    >
      {children}
    </select>
  );
}

const STATE_VARIANTS: Record<
  IntegrationState,
  "success" | "error" | "warning" | "outline" | "secondary"
> = {
  ready: "success",
  error: "error",
  connecting: "warning",
  disconnected: "outline",
  disabled: "secondary",
};

function commandFailureMessage(result: { readonly cause: Cause.Cause<unknown> }): string {
  const failure = Cause.squash(result.cause);
  return failure instanceof Error && failure.message.trim().length > 0
    ? failure.message
    : "The integration request failed.";
}

function IntegrationHeader({ integration }: { readonly integration: IntegrationDescriptor }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate">{integration.name}</span>
      <Badge variant={STATE_VARIANTS[integration.state]}>{integration.state}</Badge>
      <span className="text-[11px] font-normal text-muted-foreground">v{integration.version}</span>
    </div>
  );
}

function NoticeLine({ notice }: { readonly notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      className={
        notice.tone === "error"
          ? "text-xs text-destructive-foreground"
          : notice.tone === "success"
            ? "text-xs text-success-foreground"
            : "text-xs text-muted-foreground"
      }
    >
      {notice.message}
    </p>
  );
}

export function IntegrationsSettingsPanel() {
  const navigate = useNavigate();
  const environment = usePrimaryEnvironment();
  const environmentId = environment?.environmentId ?? null;
  const { environments } = useEnvironments();
  const projects = useProjects();
  const [runEnvironmentId, setRunEnvironmentId] = useState<EnvironmentId | null>(environmentId);
  const authoringEnvironmentId = runEnvironmentId ?? environmentId;
  const savedLoopAny = usePrimarySettings((settings) => settings.integrations.loopAny);
  const savedOpenKritt = usePrimarySettings((settings) => settings.integrations.openKritt);
  const integrationsQuery = useEnvironmentQuery(
    environmentId ? integrationEnvironment.list({ environmentId, input: null }) : null,
  );
  const monkeyAuthoringQuery = useEnvironmentQuery(
    authoringEnvironmentId
      ? integrationEnvironment.getMonkeyLoopyAuthoringContext({
          environmentId: authoringEnvironmentId,
          input: null,
        })
      : null,
  );
  const configureLoopAny = useAtomCommand(integrationEnvironment.configureLoopAny, {
    reportFailure: false,
  });
  const testLoopAny = useAtomCommand(integrationEnvironment.testLoopAny, {
    reportFailure: false,
  });
  const configureOpenKritt = useAtomCommand(integrationEnvironment.configureOpenKritt, {
    reportFailure: false,
  });
  const testOpenKritt = useAtomCommand(integrationEnvironment.testOpenKritt, {
    reportFailure: false,
  });
  const refreshOpenKrittCatalog = useAtomCommand(integrationEnvironment.refreshOpenKrittCatalog, {
    reportFailure: false,
  });
  const validateMonkeyLoopy = useAtomCommand(integrationEnvironment.validateMonkeyLoopy, {
    reportFailure: false,
  });
  const scaffoldMonkeyLoopy = useAtomCommand(integrationEnvironment.scaffoldMonkeyLoopy, {
    reportFailure: false,
  });
  const runMonkeyLoopy = useAtomCommand(integrationEnvironment.runMonkeyLoopy, {
    reportFailure: false,
  });

  const [enabled, setEnabled] = useState(savedLoopAny.enabled);
  const [serverUrl, setServerUrl] = useState(savedLoopAny.serverUrl);
  const [allowedRootsText, setAllowedRootsText] = useState(savedLoopAny.allowedRoots.join("\n"));
  const [pollWaitSeconds, setPollWaitSeconds] = useState(savedLoopAny.pollWaitSeconds);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearingToken, setClearingToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loopAnyNotice, setLoopAnyNotice] = useState<Notice | null>(null);
  const [openKrittEnabled, setOpenKrittEnabled] = useState(savedOpenKritt.enabled);
  const [openKrittServerUrl, setOpenKrittServerUrl] = useState(savedOpenKritt.serverUrl);
  const [openKrittAuthMode, setOpenKrittAuthMode] = useState(savedOpenKritt.authMode);
  const [openKrittSnapshotRoot, setOpenKrittSnapshotRoot] = useState(
    savedOpenKritt.snapshotRoot ?? "",
  );
  const [openKrittAllowedPrivateAddresses, setOpenKrittAllowedPrivateAddresses] = useState(
    (savedOpenKritt.allowedPrivateAddresses ?? []).join("\n"),
  );
  const [openKrittPollIntervalSeconds, setOpenKrittPollIntervalSeconds] = useState(
    savedOpenKritt.pollIntervalSeconds,
  );
  const [openKrittPollConcurrency, setOpenKrittPollConcurrency] = useState(
    savedOpenKritt.pollConcurrency,
  );
  const [openKrittDefaultWorkflowId, setOpenKrittDefaultWorkflowId] = useState(
    savedOpenKritt.defaultWorkflowId ?? "",
  );
  const [openKrittDefaultProviderId, setOpenKrittDefaultProviderId] = useState(
    savedOpenKritt.defaultProviderId ?? "",
  );
  const [openKrittDefaultModelId, setOpenKrittDefaultModelId] = useState(
    savedOpenKritt.defaultModelId ?? "",
  );
  const [openKrittToken, setOpenKrittToken] = useState("");
  const [openKrittAcknowledgeWarning, setOpenKrittAcknowledgeWarning] = useState(false);
  const [openKrittSaving, setOpenKrittSaving] = useState(false);
  const [openKrittTesting, setOpenKrittTesting] = useState(false);
  const [openKrittRefreshing, setOpenKrittRefreshing] = useState(false);
  const [openKrittClearingToken, setOpenKrittClearingToken] = useState(false);
  const [openKrittNotice, setOpenKrittNotice] = useState<Notice | null>(null);
  const [openKrittCatalogSummary, setOpenKrittCatalogSummary] = useState<string | null>(null);
  const [monkeyYaml, setMonkeyYaml] = useState(DEFAULT_MONKEY_LOOPY_SPEC);
  const [monkeyValidation, setMonkeyValidation] = useState<MonkeyLoopyValidateResult | null>(null);
  const [validatedYaml, setValidatedYaml] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [scaffolding, setScaffolding] = useState<string | null>(null);
  const [monkeyNotice, setMonkeyNotice] = useState<Notice | null>(null);
  const [runProjectId, setRunProjectId] = useState("");
  const [runProviderId, setRunProviderId] = useState("");
  const [runModel, setRunModel] = useState("");
  const [runRuntimeMode, setRunRuntimeMode] = useState<RuntimeMode>("auto-accept-edits");
  const [runTimeoutMinutes, setRunTimeoutMinutes] = useState(30);
  const [runInputsJson, setRunInputsJson] = useState("{}");
  const [launchRequestId, setLaunchRequestId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchNotice, setLaunchNotice] = useState<Notice | null>(null);
  const launchNoticeRef = useRef<HTMLParagraphElement>(null);
  const validationRequestSequenceRef = useRef(0);

  useEffect(() => {
    setEnabled(savedLoopAny.enabled);
    setServerUrl(savedLoopAny.serverUrl);
    setAllowedRootsText(savedLoopAny.allowedRoots.join("\n"));
    setPollWaitSeconds(savedLoopAny.pollWaitSeconds);
  }, [savedLoopAny]);

  useEffect(() => {
    setOpenKrittEnabled(savedOpenKritt.enabled);
    setOpenKrittServerUrl(savedOpenKritt.serverUrl);
    setOpenKrittAuthMode(savedOpenKritt.authMode);
    setOpenKrittSnapshotRoot(savedOpenKritt.snapshotRoot ?? "");
    setOpenKrittPollIntervalSeconds(savedOpenKritt.pollIntervalSeconds);
    setOpenKrittPollConcurrency(savedOpenKritt.pollConcurrency);
    setOpenKrittDefaultWorkflowId(savedOpenKritt.defaultWorkflowId ?? "");
    setOpenKrittDefaultProviderId(savedOpenKritt.defaultProviderId ?? "");
    setOpenKrittDefaultModelId(savedOpenKritt.defaultModelId ?? "");
  }, [savedOpenKritt]);

  useEffect(() => {
    const selection = resolveRunEnvironmentSelection({
      currentEnvironmentId: runEnvironmentId,
      primaryEnvironmentId: environmentId,
      availableEnvironmentIds: environments.map((candidate) => candidate.environmentId),
    });
    if (!selection.changed) return;
    validationRequestSequenceRef.current += 1;
    setValidating(false);
    setRunEnvironmentId(selection.environmentId);
    setMonkeyValidation(null);
    setValidatedYaml(null);
    setLaunchRequestId(null);
    setMonkeyNotice({
      tone: "info",
      message: "The execution environment changed. Validate the LoopSpec again before launching.",
    });
    setLaunchNotice(null);
  }, [environmentId, environments, runEnvironmentId]);

  const runProjects = useMemo(
    () => projects.filter((project) => project.environmentId === authoringEnvironmentId),
    [authoringEnvironmentId, projects],
  );
  const selectedRunProject = runProjects.find((project) => project.id === runProjectId) ?? null;

  useEffect(() => {
    if (selectedRunProject) return;
    const nextProject = runProjects.find((project) => project.defaultModelSelection !== null);
    setRunProjectId(nextProject?.id ?? "");
    setRunProviderId(nextProject?.defaultModelSelection?.instanceId ?? "");
    setRunModel(nextProject?.defaultModelSelection?.model ?? "");
  }, [runProjects, selectedRunProject]);

  const descriptors = integrationsQuery.data?.integrations ?? [];
  const monkey = descriptors.find((item) => item.id === "monkey-d-loopy") ?? null;
  const loopAny = descriptors.find((item) => item.id === "loopany") ?? null;
  const openKritt = descriptors.find((item) => item.id === "open-kritt") ?? null;
  const currentSpecExecutionReady = isCurrentLoopSpecExecutionReady({
    yaml: monkeyYaml,
    validatedYaml,
    validation: monkeyValidation,
  });
  const allowedRoots = useMemo(
    () => [
      ...new Set(
        allowedRootsText
          .split("\n")
          .map((root) => root.trim())
          .filter(Boolean),
      ),
    ],
    [allowedRootsText],
  );

  const handleSave = async () => {
    if (!environmentId) return;
    setSaving(true);
    setLoopAnyNotice(null);
    const result = await configureLoopAny({
      environmentId,
      input: {
        settings: { enabled, serverUrl, allowedRoots, pollWaitSeconds },
        ...(token.trim().length > 0 ? { token: token.trim() } : {}),
      },
    });
    setSaving(false);
    if (result._tag === "Success") {
      setToken("");
      setLoopAnyNotice({ tone: "success", message: "LoopAny settings saved." });
      integrationsQuery.refresh();
      return;
    }
    setLoopAnyNotice({ tone: "error", message: commandFailureMessage(result) });
  };

  const handleTest = async () => {
    if (!environmentId) return;
    setTesting(true);
    setLoopAnyNotice(null);
    const result = await testLoopAny({ environmentId, input: null });
    setTesting(false);
    if (result._tag === "Success") {
      setLoopAnyNotice({ tone: "success", message: result.value.message });
      integrationsQuery.refresh();
      return;
    }
    setLoopAnyNotice({ tone: "error", message: commandFailureMessage(result) });
  };

  const handleOpenKrittSave = async () => {
    if (!environmentId) return;
    const validation = validateOpenKrittSettingsDraft({
      enabled: openKrittEnabled,
      serverUrl: openKrittServerUrl,
      authMode: openKrittAuthMode,
      tokenConfigured: openKritt?.tokenConfigured ?? false,
      replacementToken: openKrittToken,
      acknowledgeNonLoopbackWarning: openKrittAcknowledgeWarning,
      snapshotRoot: openKrittSnapshotRoot,
      allowedPrivateAddresses: parseOpenKrittAllowedAddressesInput(
        openKrittAllowedPrivateAddresses,
      ),
    });
    if (!validation.ok) {
      setOpenKrittNotice({ tone: "error", message: validation.message });
      return;
    }
    setOpenKrittSaving(true);
    setOpenKrittNotice(null);
    const result = await configureOpenKritt({
      environmentId,
      input: {
        settings: {
          enabled: validation.settings.enabled,
          serverUrl: validation.settings.serverUrl,
          authMode: validation.settings.authMode,
          snapshotRoot:
            openKrittSnapshotRoot.trim().length === 0 ? null : openKrittSnapshotRoot.trim(),
          allowedPrivateAddresses: parseOpenKrittAllowedAddressesInput(
            openKrittAllowedPrivateAddresses,
          ),
          pollIntervalSeconds: Math.max(5, Math.min(300, Math.trunc(openKrittPollIntervalSeconds))),
          pollConcurrency: Math.max(1, Math.min(64, Math.trunc(openKrittPollConcurrency))),
          defaultWorkflowId:
            openKrittDefaultWorkflowId.trim().length === 0
              ? null
              : openKrittDefaultWorkflowId.trim(),
          defaultProviderId:
            openKrittDefaultProviderId.trim().length === 0
              ? null
              : openKrittDefaultProviderId.trim(),
          defaultModelId:
            openKrittDefaultModelId.trim().length === 0 ? null : openKrittDefaultModelId.trim(),
        },
        acknowledgeNonLoopbackWarning: openKrittAcknowledgeWarning,
        ...(openKrittToken.trim().length > 0 ? { token: openKrittToken.trim() } : {}),
      },
    });
    setOpenKrittSaving(false);
    if (result._tag === "Success") {
      setOpenKrittToken("");
      setOpenKrittNotice({ tone: "success", message: "Open Kritt settings saved." });
      integrationsQuery.refresh();
      return;
    }
    setOpenKrittNotice({ tone: "error", message: commandFailureMessage(result) });
  };

  const handleOpenKrittTest = async () => {
    if (!environmentId) return;
    setOpenKrittTesting(true);
    setOpenKrittNotice(null);
    const result = await testOpenKritt({ environmentId, input: null });
    setOpenKrittTesting(false);
    if (result._tag === "Success") {
      setOpenKrittNotice({ tone: "success", message: result.value.message });
      integrationsQuery.refresh();
      return;
    }
    setOpenKrittNotice({ tone: "error", message: commandFailureMessage(result) });
  };

  const handleOpenKrittCatalogRefresh = async () => {
    if (!environmentId) return;
    setOpenKrittRefreshing(true);
    setOpenKrittNotice(null);
    const result = await refreshOpenKrittCatalog({ environmentId, input: null });
    setOpenKrittRefreshing(false);
    if (result._tag === "Success") {
      setOpenKrittCatalogSummary(
        `${result.value.workflows.length} workflows · ${result.value.postScripts.length} post-scripts · ${result.value.modelProviders.length} model providers`,
      );
      setOpenKrittNotice({ tone: "success", message: "Open Kritt catalog refreshed." });
      return;
    }
    setOpenKrittNotice({ tone: "error", message: commandFailureMessage(result) });
  };

  const handleOpenKrittClearToken = async () => {
    if (!environmentId) return;
    setOpenKrittClearingToken(true);
    setOpenKrittNotice(null);
    const result = await configureOpenKritt({
      environmentId,
      input: { settings: { enabled: false }, clearToken: true },
    });
    setOpenKrittClearingToken(false);
    if (result._tag === "Success") {
      setOpenKrittEnabled(false);
      setOpenKrittToken("");
      setOpenKrittNotice({
        tone: "success",
        message: "Open Kritt was disabled and its token removed.",
      });
      integrationsQuery.refresh();
      return;
    }
    setOpenKrittNotice({ tone: "error", message: commandFailureMessage(result) });
  };

  const handleClearToken = async () => {
    if (!environmentId) return;
    setClearingToken(true);
    setLoopAnyNotice(null);
    const result = await configureLoopAny({
      environmentId,
      input: { settings: { enabled: false }, clearToken: true },
    });
    setClearingToken(false);
    if (result._tag === "Success") {
      setEnabled(false);
      setToken("");
      setLoopAnyNotice({ tone: "success", message: "LoopAny was disabled and its token removed." });
      integrationsQuery.refresh();
      return;
    }
    setLoopAnyNotice({ tone: "error", message: commandFailureMessage(result) });
  };

  const handleValidate = async () => {
    if (!authoringEnvironmentId) return;
    const requestSequence = validationRequestSequenceRef.current + 1;
    validationRequestSequenceRef.current = requestSequence;
    const validationEnvironmentId = authoringEnvironmentId;
    const validationYaml = monkeyYaml;
    setValidating(true);
    setMonkeyNotice(null);
    const result = await validateMonkeyLoopy({
      environmentId: validationEnvironmentId,
      input: { yaml: validationYaml },
    });
    if (
      !isCurrentLoopSpecRequest({
        requestSequence,
        currentRequestSequence: validationRequestSequenceRef.current,
      })
    ) {
      return;
    }
    setValidating(false);
    if (result._tag === "Success") {
      setMonkeyValidation(result.value);
      setValidatedYaml(validationYaml);
      setLaunchRequestId(result.value.executionReady ? randomUUID() : null);
      setLaunchNotice(null);
      setMonkeyNotice({
        tone: result.value.executionReady ? "success" : "info",
        message: result.value.executionReady
          ? "LoopSpec passes authoring validation and is verified for the Not Codex executor."
          : result.value.valid
            ? "The LoopSpec is valid for authoring but is not execution-ready in Not Codex."
            : "The LoopSpec needs authoring fixes before it can continue.",
      });
      return;
    }
    setValidatedYaml(null);
    setLaunchRequestId(null);
    setMonkeyNotice({ tone: "error", message: commandFailureMessage(result) });
  };

  const handleScaffoldRecipe = async (recipe: string) => {
    if (!authoringEnvironmentId) return;
    setScaffolding(recipe);
    setMonkeyNotice(null);
    const result = await scaffoldMonkeyLoopy({
      environmentId: authoringEnvironmentId,
      input: { id: `not-codex-${recipe}`, recipe },
    });
    setScaffolding(null);
    if (result._tag === "Success") {
      validationRequestSequenceRef.current += 1;
      setValidating(false);
      setMonkeyYaml(result.value.yaml);
      setMonkeyValidation(null);
      setValidatedYaml(null);
      setLaunchRequestId(null);
      setLaunchNotice(null);
      setMonkeyNotice({
        tone: "info",
        message: `Loaded ${recipe} from the canonical v${result.value.factoryVersion} catalog. Review its effects and harness, then validate it.`,
      });
      return;
    }
    setMonkeyNotice({ tone: "error", message: commandFailureMessage(result) });
  };

  const handleMonkeyYamlChange = (value: string) => {
    validationRequestSequenceRef.current += 1;
    setValidating(false);
    setMonkeyYaml(value);
    setMonkeyValidation(null);
    setValidatedYaml(null);
    setLaunchRequestId(null);
    setLaunchNotice(null);
  };

  const handleRunProjectChange = (projectId: string) => {
    const project = runProjects.find((candidate) => candidate.id === projectId) ?? null;
    setRunProjectId(projectId);
    setRunProviderId(project?.defaultModelSelection?.instanceId ?? "");
    setRunModel(project?.defaultModelSelection?.model ?? "");
    setLaunchNotice(null);
  };

  const handleRunEnvironmentChange = (nextEnvironmentId: string) => {
    validationRequestSequenceRef.current += 1;
    setValidating(false);
    setRunEnvironmentId(nextEnvironmentId as EnvironmentId);
    setRunProjectId("");
    setRunProviderId("");
    setRunModel("");
    setMonkeyValidation(null);
    setValidatedYaml(null);
    setLaunchRequestId(null);
    setMonkeyNotice({
      tone: "info",
      message: "Validate the LoopSpec against the selected execution environment.",
    });
    setLaunchNotice(null);
  };

  const handleLaunch = async () => {
    if (
      !authoringEnvironmentId ||
      !currentSpecExecutionReady ||
      !selectedRunProject ||
      !launchRequestId
    ) {
      setLaunchNotice({
        tone: "error",
        message: "Validate the current LoopSpec and choose an execution environment and project.",
      });
      return;
    }
    const parsedInputs = parseRunInputsJson(runInputsJson);
    if (!parsedInputs.ok) {
      setLaunchNotice({ tone: "error", message: parsedInputs.message });
      requestAnimationFrame(() => launchNoticeRef.current?.focus());
      return;
    }
    if (runProviderId.trim().length === 0 || runModel.trim().length === 0) {
      setLaunchNotice({
        tone: "error",
        message: "Choose a configured provider instance and model before running.",
      });
      requestAnimationFrame(() => launchNoticeRef.current?.focus());
      return;
    }
    setLaunching(true);
    setLaunchNotice(null);
    let providerInstanceId: ReturnType<typeof ProviderInstanceId.make>;
    try {
      providerInstanceId = ProviderInstanceId.make(runProviderId.trim());
    } catch {
      setLaunching(false);
      setLaunchNotice({
        tone: "error",
        message: "The provider instance id is invalid. Choose a configured provider.",
      });
      requestAnimationFrame(() => launchNoticeRef.current?.focus());
      return;
    }
    const result = await runMonkeyLoopy({
      environmentId: authoringEnvironmentId,
      input: {
        requestId: launchRequestId,
        projectId: selectedRunProject.id,
        yaml: monkeyYaml,
        inputs: parsedInputs.value,
        modelSelection: { instanceId: providerInstanceId, model: runModel.trim() },
        runtimeMode: runRuntimeMode,
        timeoutMinutes: normalizeIntegrationRunTimeout(runTimeoutMinutes),
      },
    });
    setLaunching(false);
    if (result._tag === "Failure") {
      setLaunchNotice({ tone: "error", message: commandFailureMessage(result) });
      requestAnimationFrame(() => launchNoticeRef.current?.focus());
      return;
    }
    await navigate({
      to: "/runs/$environmentId/$runId",
      params: { environmentId: authoringEnvironmentId, runId: result.value.run.id },
    });
  };

  return (
    <SettingsPageContainer>
      <div className="space-y-1 px-1">
        <h1 className="text-xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Run bounded loops through the Not Codex harness or connect an optional external control
          plane. Tokens stay server-side and are never returned to the browser.
        </p>
      </div>

      {integrationsQuery.error ? (
        <p role="alert" className="px-1 text-sm text-destructive-foreground">
          {integrationsQuery.error}
        </p>
      ) : null}

      <SettingsSection
        title="Monkey.D.Loopy"
        icon={<BlocksIcon className="size-3.5" />}
        headerAction={monkey ? <IntegrationHeader integration={monkey} /> : null}
      >
        <SettingsRow
          title="Verified agent workflow"
          description="Start from canonical context and verified recipes; keep external completion evidence and every cap explicit."
          status={
            monkeyAuthoringQuery.data
              ? `authoring v${monkeyAuthoringQuery.data.factoryVersion} · execution v${monkeyAuthoringQuery.data.executionVersion}`
              : "Loading the embedded catalog…"
          }
        >
          <div className="space-y-3 pb-4 pt-3 text-xs text-muted-foreground">
            {monkeyAuthoringQuery.data ? (
              <>
                <p>{monkeyAuthoringQuery.data.executionNotice}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    render={
                      <a
                        href={monkeyAuthoringQuery.data.guideUrl}
                        target="_blank"
                        rel="noreferrer"
                      />
                    }
                  >
                    <BookOpenIcon /> Agent guide
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    render={
                      <a
                        href={monkeyAuthoringQuery.data.llmsUrl}
                        target="_blank"
                        rel="noreferrer"
                      />
                    }
                  >
                    llms.txt
                  </Button>
                </div>
                <div>
                  <p className="mb-2 font-medium text-foreground">Verified recipes</p>
                  <div className="flex flex-wrap gap-2">
                    {monkeyAuthoringQuery.data.recipes.map((recipe) => (
                      <Button
                        key={recipe.name}
                        size="sm"
                        variant="outline"
                        disabled={scaffolding !== null}
                        title={`${recipe.summary} Minimum score ${recipe.minimumScore}. ${recipe.safety}`}
                        onClick={() => handleScaffoldRecipe(recipe.name)}
                      >
                        {scaffolding === recipe.name ? "Loading…" : recipe.title}
                      </Button>
                    ))}
                  </div>
                </div>
              </>
            ) : monkeyAuthoringQuery.error ? (
              <p role="alert" className="text-destructive-foreground">
                {monkeyAuthoringQuery.error}
              </p>
            ) : null}
          </div>
        </SettingsRow>
        <SettingsRow
          title="Validate a LoopSpec"
          description="Only the not-codex agent harness is accepted. Shell and HTTP effects are disabled."
          status={
            monkey
              ? `${monkey.capabilities.join(" · ")} · journals are stored outside projects`
              : null
          }
        >
          <div className="space-y-3 pb-4 pt-3">
            <Textarea
              aria-label="Monkey.D.Loopy YAML LoopSpec"
              className="font-mono text-xs"
              rows={16}
              value={monkeyYaml}
              onChange={(event) => handleMonkeyYamlChange(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={handleValidate}
                disabled={!authoringEnvironmentId || validating}
              >
                <FlaskConicalIcon />
                {validating ? "Validating…" : "Validate safely"}
              </Button>
              {monkeyValidation?.score !== null && monkeyValidation?.score !== undefined ? (
                <Badge variant="outline">score {monkeyValidation.score}</Badge>
              ) : null}
              {currentSpecExecutionReady ? (
                <Badge variant="success">
                  <CheckCircle2Icon /> execution-ready
                </Badge>
              ) : null}
            </div>
            <NoticeLine notice={monkeyNotice} />
            {monkeyValidation && monkeyValidation.diagnostics.length > 0 ? (
              <ul className="space-y-1 rounded-lg border bg-muted/30 p-3 text-xs">
                {monkeyValidation.diagnostics.map((diagnostic) => (
                  <li key={`${diagnostic.level}:${diagnostic.path ?? ""}:${diagnostic.message}`}>
                    <span className="font-medium">{diagnostic.level}:</span> {diagnostic.message}
                    {diagnostic.path ? ` (${diagnostic.path})` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </SettingsRow>
        <SettingsRow
          title="Run this LoopSpec"
          description="Launch the validated spec durably and follow each agent step as an ordinary Not Codex thread."
          status={
            currentSpecExecutionReady
              ? "Ready to queue"
              : "Validate the current LoopSpec before launching."
          }
        >
          <div className="space-y-4 pb-5 pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel>Execution environment</FieldLabel>
                <RunSelect
                  label="LoopSpec execution environment"
                  value={authoringEnvironmentId ?? ""}
                  onChange={handleRunEnvironmentChange}
                >
                  <option value="" disabled>
                    Choose an environment
                  </option>
                  {environments.map((candidate) => (
                    <option key={candidate.environmentId} value={candidate.environmentId}>
                      {candidate.label}
                    </option>
                  ))}
                </RunSelect>
              </div>
              <div>
                <FieldLabel>Project</FieldLabel>
                <RunSelect
                  label="LoopSpec project"
                  value={runProjectId}
                  onChange={handleRunProjectChange}
                >
                  <option value="">Choose a project</option>
                  {runProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </RunSelect>
              </div>
              <div>
                <FieldLabel>Provider instance</FieldLabel>
                <Input
                  aria-label="LoopSpec provider instance"
                  value={runProviderId}
                  onChange={(event) => {
                    setRunProviderId(event.currentTarget.value);
                    setLaunchNotice(null);
                  }}
                  placeholder="Configured provider id"
                />
              </div>
              <div>
                <FieldLabel>Model</FieldLabel>
                <Input
                  aria-label="LoopSpec model"
                  value={runModel}
                  onChange={(event) => {
                    setRunModel(event.currentTarget.value);
                    setLaunchNotice(null);
                  }}
                  placeholder="Model id"
                />
              </div>
              <div>
                <FieldLabel>Permission mode</FieldLabel>
                <RunSelect
                  label="LoopSpec permission mode"
                  value={runRuntimeMode}
                  onChange={(value) => {
                    setRunRuntimeMode(value as RuntimeMode);
                    setLaunchNotice(null);
                  }}
                >
                  {LOOPY_RUNTIME_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </RunSelect>
              </div>
              <div>
                <FieldLabel>Timeout (minutes)</FieldLabel>
                <Input
                  aria-label="LoopSpec timeout in minutes"
                  type="number"
                  min={1}
                  max={240}
                  value={runTimeoutMinutes}
                  onChange={(event) => {
                    setRunTimeoutMinutes(Number(event.currentTarget.value));
                    setLaunchNotice(null);
                  }}
                />
              </div>
            </div>
            <div>
              <FieldLabel>Input values (JSON object)</FieldLabel>
              <Textarea
                aria-label="LoopSpec input values JSON"
                className="min-h-24 font-mono text-xs"
                value={runInputsJson}
                onChange={(event) => {
                  setRunInputsJson(event.currentTarget.value);
                  setLaunchNotice(null);
                }}
                spellCheck={false}
              />
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="flex items-start gap-2">
                <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-success-foreground" />
                Agent steps use normal Not Codex threads. Journals stay in server-managed storage
                outside project roots; direct shell and HTTP effects remain disabled. Interactive
                approvals are not supported from a Loopy receipt yet.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={handleLaunch}
                disabled={
                  launching ||
                  !currentSpecExecutionReady ||
                  !selectedRunProject ||
                  runProviderId.trim().length === 0 ||
                  runModel.trim().length === 0
                }
              >
                {launching ? (
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <PlayIcon />
                )}
                {launching ? "Queuing…" : "Run this LoopSpec"}
              </Button>
              {launchNotice ? (
                <p
                  ref={launchNoticeRef}
                  tabIndex={-1}
                  role={launchNotice.tone === "error" ? "alert" : "status"}
                  className={
                    launchNotice.tone === "error"
                      ? "text-xs text-destructive-foreground outline-none"
                      : "text-xs text-muted-foreground outline-none"
                  }
                >
                  {launchNotice.message}
                </p>
              ) : null}
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Open Kritt"
        icon={<ShieldCheckIcon className="size-3.5" />}
        headerAction={openKritt ? <IntegrationHeader integration={openKritt} /> : null}
      >
        <SettingsRow
          title="Enable connector"
          description="Run scans through the server-only HTTP connector. Open Kritt remains separately installed and licensed."
          status={openKritt?.error ?? "Disabled by default."}
          control={
            <Switch
              aria-label="Enable Open Kritt connector"
              checked={openKrittEnabled}
              onCheckedChange={setOpenKrittEnabled}
            />
          }
        />
        <div className="space-y-2 border-b border-border/60 px-4 py-3 text-xs text-muted-foreground sm:px-5">
          <p>
            Open Kritt is an AGPL service maintained and licensed separately from Not Codex. Keep it
            on a private, operator-controlled network; its scan jobs may send source contents to the
            model provider configured in that installation.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              render={
                <a href="https://github.com/Kritt-ai/open-kritt" target="_blank" rel="noreferrer" />
              }
            >
              Source / AGPL
            </Button>
            <Button
              size="sm"
              variant="outline"
              render={<a href="https://docs.kritt.ai" target="_blank" rel="noreferrer" />}
            >
              Official docs
            </Button>
          </div>
        </div>
        <SettingsRow
          title="Server URL"
          description="HTTPS is required for non-loopback endpoints; plain HTTP is restricted to localhost."
        >
          <div className="pb-4 pt-3">
            <Input
              aria-label="Open Kritt server URL"
              placeholder="https://open-kritt.internal.example"
              value={openKrittServerUrl}
              onChange={(event) => setOpenKrittServerUrl(event.currentTarget.value)}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          title="Authentication"
          description="Bearer tokens are write-only and stored in the server secret store."
        >
          <div className="space-y-3 pb-4 pt-3">
            <RunSelect
              label="Open Kritt authentication mode"
              value={openKrittAuthMode}
              onChange={(value) => {
                if (isOpenKrittAuthMode(value)) setOpenKrittAuthMode(value);
              }}
            >
              <option value="none">Operator network policy only</option>
              <option value="bearer">Bearer token / reverse proxy</option>
            </RunSelect>
            {openKrittAuthMode === "bearer" ? (
              <Input
                aria-label="Open Kritt bearer token"
                type="password"
                autoComplete="off"
                placeholder={
                  openKritt?.tokenConfigured ? "Saved — enter a replacement" : "Bearer token"
                }
                value={openKrittToken}
                onChange={(event) => setOpenKrittToken(event.currentTarget.value)}
              />
            ) : null}
            {openKritt?.tokenConfigured ? (
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !environmentId || openKrittSaving || openKrittTesting || openKrittClearingToken
                }
                onClick={handleOpenKrittClearToken}
              >
                {openKrittClearingToken ? "Removing…" : "Disable and remove saved token"}
              </Button>
            ) : null}
          </div>
        </SettingsRow>
        {!isLoopbackOpenKrittUrl(openKrittServerUrl) && openKrittServerUrl.trim().length > 0 ? (
          <div className="border-b border-border/60 px-4 py-3 text-xs text-muted-foreground sm:px-5">
            <label className="flex items-start gap-2">
              <input
                aria-label="Acknowledge private non-loopback Open Kritt service"
                type="checkbox"
                checked={openKrittAcknowledgeWarning}
                onChange={(event) => setOpenKrittAcknowledgeWarning(event.currentTarget.checked)}
                className="mt-0.5"
              />
              <span>
                I confirm this non-loopback service is private and protected by operator
                authentication/network policy, and I understand its Docker privileges and model
                provider data egress.
              </span>
            </label>
          </div>
        ) : null}
        <SettingsRow
          title="Local snapshot root"
          description="Optional dedicated host directory mounted read-only to Open Kritt as /local_repos; never use a live project directory."
        >
          <div className="pb-4 pt-3">
            <Input
              aria-label="Open Kritt local snapshot root"
              placeholder="/srv/open-kritt-snapshots"
              value={openKrittSnapshotRoot}
              onChange={(event) => setOpenKrittSnapshotRoot(event.currentTarget.value)}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          title="Allowed private addresses"
          description="Literal IP addresses or CIDR ranges this server may connect to for a private Open Kritt host. Leave empty to allow loopback only. Link-local, metadata, multicast and reserved ranges are always refused."
        >
          <div className="pb-4 pt-3">
            <Input
              aria-label="Open Kritt allowed private addresses"
              placeholder="192.168.10.20, 10.1.0.0/24"
              value={openKrittAllowedPrivateAddresses}
              onChange={(event) => setOpenKrittAllowedPrivateAddresses(event.currentTarget.value)}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          title="Polling and rescan defaults"
          description="Polling is server-owned; these bounded defaults are used for durable refreshes and rescans."
        >
          <div className="grid gap-3 pb-4 pt-3 sm:grid-cols-2">
            <label className="text-xs font-medium">
              Poll interval (seconds)
              <Input
                className="mt-1"
                type="number"
                min={5}
                max={300}
                value={openKrittPollIntervalSeconds}
                onChange={(event) =>
                  setOpenKrittPollIntervalSeconds(Number(event.currentTarget.value))
                }
                aria-label="Open Kritt poll interval seconds"
              />
            </label>
            <label className="text-xs font-medium">
              Poll concurrency
              <Input
                className="mt-1"
                type="number"
                min={1}
                max={64}
                value={openKrittPollConcurrency}
                onChange={(event) => setOpenKrittPollConcurrency(Number(event.currentTarget.value))}
                aria-label="Open Kritt poll concurrency"
              />
            </label>
            <label className="text-xs font-medium">
              Default workflow ID
              <Input
                className="mt-1"
                value={openKrittDefaultWorkflowId}
                onChange={(event) => setOpenKrittDefaultWorkflowId(event.currentTarget.value)}
                aria-label="Open Kritt default workflow ID"
              />
            </label>
            <label className="text-xs font-medium">
              Default provider ID
              <Input
                className="mt-1"
                value={openKrittDefaultProviderId}
                onChange={(event) => setOpenKrittDefaultProviderId(event.currentTarget.value)}
                aria-label="Open Kritt default provider ID"
              />
            </label>
            <label className="text-xs font-medium sm:col-span-2">
              Default model ID
              <Input
                className="mt-1"
                value={openKrittDefaultModelId}
                onChange={(event) => setOpenKrittDefaultModelId(event.currentTarget.value)}
                aria-label="Open Kritt default model ID"
              />
            </label>
          </div>
        </SettingsRow>
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-4 sm:px-5">
          <Button
            onClick={handleOpenKrittSave}
            disabled={!environmentId || openKrittSaving || openKrittTesting || openKrittRefreshing}
          >
            {openKrittSaving ? "Saving…" : "Save connector"}
          </Button>
          <Button
            variant="outline"
            onClick={handleOpenKrittTest}
            disabled={!environmentId || openKrittSaving || openKrittTesting || openKrittRefreshing}
          >
            {openKrittTesting ? "Testing…" : "Test connection"}
          </Button>
          <Button
            variant="outline"
            onClick={handleOpenKrittCatalogRefresh}
            disabled={!environmentId || openKrittSaving || openKrittTesting || openKrittRefreshing}
          >
            <RefreshCwIcon
              className={
                openKrittRefreshing ? "animate-spin motion-reduce:animate-none" : undefined
              }
            />
            {openKrittRefreshing ? "Refreshing…" : "Refresh catalog"}
          </Button>
          {openKrittCatalogSummary ? (
            <span className="text-xs text-muted-foreground">{openKrittCatalogSummary}</span>
          ) : null}
          <NoticeLine notice={openKrittNotice} />
        </div>
      </SettingsSection>

      <SettingsSection
        title="LoopAny"
        icon={<RefreshCwIcon className="size-3.5" />}
        headerAction={loopAny ? <IntegrationHeader integration={loopAny} /> : null}
      >
        <SettingsRow
          title="Enable connector"
          description="Poll LoopAny for work and route accepted agent calls through ordinary Not Codex threads."
          status={loopAny?.error ?? "Disabled by default."}
          control={
            <Switch
              aria-label="Enable LoopAny connector"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          }
        />
        <SettingsRow title="Server URL" description="The HTTPS base URL of your LoopAny server.">
          <div className="pb-4 pt-3">
            <Input
              aria-label="LoopAny server URL"
              placeholder="https://loopany.example.com"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          title="Device token"
          description="Write-only. Leave blank to keep the saved token."
          status={
            loopAny?.tokenConfigured
              ? "A device token is stored on this server."
              : "No token stored."
          }
        >
          <div className="space-y-2 pb-4 pt-3">
            <Input
              aria-label="LoopAny device token"
              type="password"
              autoComplete="off"
              placeholder={
                loopAny?.tokenConfigured ? "Saved — enter a replacement" : "Device token"
              }
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            {loopAny?.tokenConfigured ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!environmentId || saving || testing || clearingToken}
                onClick={handleClearToken}
              >
                {clearingToken ? "Removing…" : "Disable and remove saved token"}
              </Button>
            ) : null}
          </div>
        </SettingsRow>
        <SettingsRow
          title="Allowed project roots"
          description="One absolute directory per line. Deliveries outside these roots are rejected, including symlink escapes."
        >
          <div className="pb-4 pt-3">
            <Textarea
              aria-label="LoopAny allowed project roots"
              className="font-mono text-xs"
              rows={4}
              placeholder="/Users/you/Projects"
              value={allowedRootsText}
              onChange={(event) => setAllowedRootsText(event.target.value)}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          title="Long-poll wait"
          description="How long LoopAny may hold each delivery poll, from 5 to 60 seconds."
          control={
            <Input
              aria-label="LoopAny poll wait seconds"
              className="w-24"
              type="number"
              min={5}
              max={60}
              value={pollWaitSeconds}
              onChange={(event) => setPollWaitSeconds(Number(event.target.value))}
            />
          }
        />
        {loopAny?.diagnostics && "protocolVersion" in loopAny.diagnostics ? (
          <LoopAnyDiagnosticsPanel
            diagnostics={loopAny.diagnostics}
            environmentId={environmentId}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-4 sm:px-5">
          <Button
            onClick={handleSave}
            disabled={!environmentId || saving || testing || clearingToken}
          >
            {saving ? "Saving…" : "Save connector"}
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={!environmentId || saving || testing || clearingToken}
          >
            {testing ? "Testing…" : "Test saved connection"}
          </Button>
          <NoticeLine notice={loopAnyNotice} />
        </div>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
