import { useEffect, useMemo, useState } from "react";
import type {
  IntegrationDescriptor,
  IntegrationState,
  MonkeyLoopyValidateResult,
} from "@notcodex/contracts";
import * as Cause from "effect/Cause";
import {
  BlocksIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  FlaskConicalIcon,
  RefreshCwIcon,
} from "lucide-react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { integrationEnvironment } from "../../state/integrations";
import { usePrimaryEnvironment } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const MONKEY_SAMPLE = `loopspec: "0.1"
id: not-codex-review
meta:
  name: Not Codex review loop
pattern: react
state:
  store: journal
  vars:
    agent_runs: { type: int, init: 0 }
body:
  - id: review
    kind: agent
    harness: not-codex
    prompt: Review the current work and complete one safe, verifiable improvement.
    on_done: { incr: agent_runs }
terminate:
  signal: state-predicate
  until: "\${state.agent_runs >= 1}"
caps:
  max_iterations: 2
  on_cap_exceeded: fail
schedule: { mode: manual }
`;

type Notice = { readonly tone: "success" | "error" | "info"; readonly message: string };

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
  const environment = usePrimaryEnvironment();
  const environmentId = environment?.environmentId ?? null;
  const savedLoopAny = usePrimarySettings((settings) => settings.integrations.loopAny);
  const integrationsQuery = useEnvironmentQuery(
    environmentId ? integrationEnvironment.list({ environmentId, input: undefined }) : null,
  );
  const monkeyAuthoringQuery = useEnvironmentQuery(
    environmentId
      ? integrationEnvironment.getMonkeyLoopyAuthoringContext({
          environmentId,
          input: undefined,
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

  const [enabled, setEnabled] = useState(savedLoopAny.enabled);
  const [serverUrl, setServerUrl] = useState(savedLoopAny.serverUrl);
  const [allowedRootsText, setAllowedRootsText] = useState(savedLoopAny.allowedRoots.join("\n"));
  const [pollWaitSeconds, setPollWaitSeconds] = useState(savedLoopAny.pollWaitSeconds);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearingToken, setClearingToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loopAnyNotice, setLoopAnyNotice] = useState<Notice | null>(null);
  const [monkeyYaml, setMonkeyYaml] = useState(MONKEY_SAMPLE);
  const [monkeyValidation, setMonkeyValidation] = useState<MonkeyLoopyValidateResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [scaffolding, setScaffolding] = useState<string | null>(null);
  const [monkeyNotice, setMonkeyNotice] = useState<Notice | null>(null);

  useEffect(() => {
    setEnabled(savedLoopAny.enabled);
    setServerUrl(savedLoopAny.serverUrl);
    setAllowedRootsText(savedLoopAny.allowedRoots.join("\n"));
    setPollWaitSeconds(savedLoopAny.pollWaitSeconds);
  }, [savedLoopAny]);

  const descriptors = integrationsQuery.data?.integrations ?? [];
  const monkey = descriptors.find((item) => item.id === "monkey-d-loopy") ?? null;
  const loopAny = descriptors.find((item) => item.id === "loopany") ?? null;
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
    const result = await testLoopAny({ environmentId, input: undefined });
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
    if (!environmentId) return;
    setValidating(true);
    setMonkeyNotice(null);
    const result = await validateMonkeyLoopy({
      environmentId,
      input: { yaml: monkeyYaml },
    });
    setValidating(false);
    if (result._tag === "Success") {
      setMonkeyValidation(result.value);
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
    setMonkeyNotice({ tone: "error", message: commandFailureMessage(result) });
  };

  const handleScaffoldRecipe = async (recipe: string) => {
    if (!environmentId) return;
    setScaffolding(recipe);
    setMonkeyNotice(null);
    const result = await scaffoldMonkeyLoopy({
      environmentId,
      input: { id: `not-codex-${recipe}`, recipe },
    });
    setScaffolding(null);
    if (result._tag === "Success") {
      setMonkeyYaml(result.value.yaml);
      setMonkeyValidation(null);
      setMonkeyNotice({
        tone: "info",
        message: `Loaded ${recipe} from the canonical v${result.value.factoryVersion} catalog. Review its effects and harness, then validate it.`,
      });
      return;
    }
    setMonkeyNotice({ tone: "error", message: commandFailureMessage(result) });
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
              onChange={(event) => setMonkeyYaml(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={handleValidate} disabled={!environmentId || validating}>
                <FlaskConicalIcon />
                {validating ? "Validating…" : "Validate safely"}
              </Button>
              {monkeyValidation?.score !== null && monkeyValidation?.score !== undefined ? (
                <Badge variant="outline">score {monkeyValidation.score}</Badge>
              ) : null}
              {monkeyValidation?.executionReady ? (
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
