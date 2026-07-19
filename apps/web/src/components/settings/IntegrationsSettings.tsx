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
  isCurrentLoopSpecValidationRequest,
  LOOPY_RUNTIME_MODE_OPTIONS,
  normalizeIntegrationRunTimeout,
  parseRunInputsJson,
  resolveRunEnvironmentSelection,
} from "./IntegrationsRun.logic";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

type Notice = { readonly tone: "success" | "error" | "info"; readonly message: string };

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
      !isCurrentLoopSpecValidationRequest({
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
          ? "LoopSpec passes v0.5 authoring validation and is verified for the Not Codex executor."
          : result.value.valid
            ? "The v0.5 LoopSpec is valid for authoring but is not execution-ready in Not Codex."
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
          title="v0.5 agent workflow"
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
        {loopAny?.diagnostics ? (
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
