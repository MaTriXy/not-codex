import type { MenuAction } from "@react-native-menu/menu";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  DEFAULT_MONKEY_LOOPY_SPEC,
  isCurrentLoopSpecExecutionReady,
  isCurrentLoopSpecRequest,
  normalizeIntegrationRunTimeout,
  parseRunInputsJson,
} from "@notcodex/client-runtime/state/integration-run-launch";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@notcodex/client-runtime/state/runtime";
import {
  EnvironmentId,
  type MonkeyLoopyValidateResult,
  type ProjectId,
  type RuntimeMode,
} from "@notcodex/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { ControlPillMenu } from "../../components/ControlPill";
import { EmptyState } from "../../components/EmptyState";
import { LoadingStrip } from "../../components/LoadingStrip";
import { buildModelOptions } from "../../lib/modelOptions";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { integrationEnvironment } from "../../state/integrations";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  integrationLaunchCanSubmit,
  renewAttemptedIntegrationLaunchRequestId,
  selectIntegrationLaunchEnvironment,
  selectIntegrationLaunchModel,
  selectIntegrationLaunchProject,
} from "./integrationRunLaunchPresentation";

type IntegrationRunLaunchRouteProps = StaticScreenProps<{
  readonly environmentId?: string;
}>;

type Notice = { readonly tone: "success" | "error" | "info"; readonly message: string };

function commandFailureMessage(result: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The integration request failed.";
}

function SelectRow(props: {
  readonly label: string;
  readonly value: string;
  readonly actions: MenuAction[];
  readonly onSelect: (id: string) => void;
  readonly disabled?: boolean;
}) {
  const trigger = (
    <Pressable
      accessibilityLabel={`${props.label}, ${props.value}`}
      accessibilityHint={props.disabled ? undefined : "Opens selection menu"}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      className="min-h-[52px] flex-row items-center justify-between gap-3 rounded-2xl border border-input-border bg-input px-3.5 disabled:opacity-50"
    >
      <Text className="min-w-0 flex-1 text-base text-foreground" numberOfLines={1}>
        {props.value}
      </Text>
      <Text className="text-xl text-foreground-muted">›</Text>
    </Pressable>
  );
  return (
    <View className="gap-1.5">
      <Text className="text-xs font-notcodex-bold uppercase tracking-wide text-foreground-muted">
        {props.label}
      </Text>
      {props.disabled ? (
        trigger
      ) : (
        <ControlPillMenu
          actions={props.actions}
          onPressAction={({ nativeEvent }) => props.onSelect(nativeEvent.event)}
        >
          {trigger}
        </ControlPillMenu>
      )}
    </View>
  );
}

function NoticeCard({ notice }: { readonly notice: Notice | null }) {
  if (notice === null) return null;
  return (
    <View
      accessibilityRole={notice.tone === "error" ? "alert" : "summary"}
      className={
        notice.tone === "error"
          ? "rounded-[18px] border border-rose-500/30 bg-rose-500/10 p-3"
          : notice.tone === "success"
            ? "rounded-[18px] border border-emerald-500/30 bg-emerald-500/10 p-3"
            : "rounded-[18px] border border-border bg-card p-3"
      }
    >
      <Text className="text-sm leading-normal text-foreground">{notice.message}</Text>
    </View>
  );
}

export function IntegrationRunLaunchRouteScreen(props: IntegrationRunLaunchRouteProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environments } = useEnvironments();
  const projects = useProjects();
  const requestedEnvironmentId = props.route.params?.environmentId ?? null;
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(() =>
    requestedEnvironmentId === null ? null : EnvironmentId.make(requestedEnvironmentId),
  );
  const selectedEnvironment = selectIntegrationLaunchEnvironment(
    environments,
    selectedEnvironmentId,
  );
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | null>(null);
  const selectedProject = selectIntegrationLaunchProject(
    projects,
    selectedEnvironment?.environmentId ?? null,
    selectedProjectId,
  );
  const serverConfig = useEnvironmentServerConfig(selectedEnvironment?.environmentId ?? null);
  const modelOptions = useMemo(
    () => buildModelOptions(serverConfig, selectedProject?.defaultModelSelection ?? null),
    [selectedProject?.defaultModelSelection, serverConfig],
  );
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null);
  const selectedModel = selectIntegrationLaunchModel(
    modelOptions,
    selectedModelKey,
    selectedProject?.defaultModelSelection ?? null,
  );

  const [yaml, setYaml] = useState(DEFAULT_MONKEY_LOOPY_SPEC);
  const [inputsJson, setInputsJson] = useState("{}");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("approval-required");
  const [timeoutMinutes, setTimeoutMinutes] = useState("30");
  const [validation, setValidation] = useState<MonkeyLoopyValidateResult | null>(null);
  const [validatedYaml, setValidatedYaml] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [scaffolding, setScaffolding] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const validationRequestSequenceRef = useRef(0);
  const scaffoldRequestSequenceRef = useRef(0);
  const attemptedLaunchRequestIdRef = useRef<string | null>(null);

  const authoring = useEnvironmentQuery(
    selectedEnvironment === null
      ? null
      : integrationEnvironment.getMonkeyLoopyAuthoringContext({
          environmentId: selectedEnvironment.environmentId,
          input: null,
        }),
  );
  const validate = useAtomCommand(integrationEnvironment.validateMonkeyLoopy, {
    reportFailure: false,
  });
  const scaffold = useAtomCommand(integrationEnvironment.scaffoldMonkeyLoopy, {
    reportFailure: false,
  });
  const run = useAtomCommand(integrationEnvironment.runMonkeyLoopy, { reportFailure: false });

  useEffect(() => {
    if (selectedEnvironment?.environmentId !== selectedEnvironmentId) {
      validationRequestSequenceRef.current += 1;
      scaffoldRequestSequenceRef.current += 1;
      setValidating(false);
      setScaffolding(false);
      setValidation(null);
      setValidatedYaml(null);
      setRequestId(null);
      setSelectedEnvironmentId(selectedEnvironment?.environmentId ?? null);
    }
  }, [selectedEnvironment?.environmentId, selectedEnvironmentId]);

  useEffect(() => {
    if (selectedProject?.id !== selectedProjectId)
      setSelectedProjectId(selectedProject?.id ?? null);
  }, [selectedProject?.id, selectedProjectId]);

  useEffect(() => {
    if (selectedModel?.key !== selectedModelKey) setSelectedModelKey(selectedModel?.key ?? null);
  }, [selectedModel?.key, selectedModelKey]);

  const executionReady = isCurrentLoopSpecExecutionReady({ yaml, validatedYaml, validation });
  const connected = selectedEnvironment?.connection.phase === "connected";
  const busy = validating || scaffolding || launching;
  const canLaunch = integrationLaunchCanSubmit({
    connected,
    executionReady,
    hasProject: selectedProject !== null,
    hasModel: selectedModel !== null,
    hasRequestId: requestId !== null,
    busy,
  });

  const resetValidation = (message?: string) => {
    validationRequestSequenceRef.current += 1;
    scaffoldRequestSequenceRef.current += 1;
    setValidating(false);
    setScaffolding(false);
    setValidation(null);
    setValidatedYaml(null);
    setRequestId(null);
    attemptedLaunchRequestIdRef.current = null;
    setNotice(message ? { tone: "info", message } : null);
  };

  const invalidateAttemptedLaunch = () => {
    const attemptedRequestId = attemptedLaunchRequestIdRef.current;
    attemptedLaunchRequestIdRef.current = null;
    setRequestId((currentRequestId) =>
      renewAttemptedIntegrationLaunchRequestId({
        currentRequestId,
        attemptedRequestId,
        createRequestId: uuidv4,
      }),
    );
    setNotice(null);
  };

  const handleEnvironmentSelect = (environmentId: string) => {
    setSelectedEnvironmentId(EnvironmentId.make(environmentId));
    setSelectedProjectId(null);
    setSelectedModelKey(null);
    resetValidation("Validate this LoopSpec against the selected execution environment.");
  };

  const handleValidate = async () => {
    if (selectedEnvironment === null || !connected) {
      resetValidation();
      setNotice({ tone: "error", message: "Reconnect the execution environment to validate." });
      return;
    }
    const requestSequence = validationRequestSequenceRef.current + 1;
    validationRequestSequenceRef.current = requestSequence;
    const validationEnvironmentId = selectedEnvironment.environmentId;
    const validationYaml = yaml;
    setValidating(true);
    setNotice(null);
    const result = await validate({
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
    if (result._tag === "Failure") {
      setValidation(null);
      setValidatedYaml(null);
      setRequestId(null);
      if (!isAtomCommandInterrupted(result)) {
        setNotice({ tone: "error", message: commandFailureMessage(result) });
      }
      return;
    }
    setValidation(result.value);
    setValidatedYaml(validationYaml);
    setRequestId(result.value.executionReady ? uuidv4() : null);
    setNotice({
      tone: result.value.executionReady ? "success" : "info",
      message: result.value.executionReady
        ? "The LoopSpec is verified and ready for the Not Codex harness."
        : result.value.valid
          ? "The LoopSpec is valid for authoring but is not execution-ready."
          : "Fix the reported diagnostics, then validate again.",
    });
  };

  const handleScaffold = async (recipe: string) => {
    if (selectedEnvironment === null || !connected) return;
    const requestSequence = scaffoldRequestSequenceRef.current + 1;
    scaffoldRequestSequenceRef.current = requestSequence;
    const scaffoldEnvironmentId = selectedEnvironment.environmentId;
    setScaffolding(true);
    setNotice(null);
    const result = await scaffold({
      environmentId: scaffoldEnvironmentId,
      input: { id: `not-codex-${recipe}`, recipe },
    });
    if (
      !isCurrentLoopSpecRequest({
        requestSequence,
        currentRequestSequence: scaffoldRequestSequenceRef.current,
      })
    ) {
      return;
    }
    setScaffolding(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        setNotice({ tone: "error", message: commandFailureMessage(result) });
      }
      return;
    }
    setYaml(result.value.yaml);
    resetValidation(`Loaded the ${recipe} recipe. Review it, then validate before running.`);
  };

  const handleLaunch = async () => {
    if (
      !canLaunch ||
      selectedEnvironment === null ||
      selectedProject === null ||
      selectedModel === null ||
      requestId === null
    ) {
      setNotice({
        tone: "error",
        message: "Validate the current LoopSpec and choose a connected project and model.",
      });
      return;
    }
    const inputs = parseRunInputsJson(inputsJson);
    if (!inputs.ok) {
      setNotice({ tone: "error", message: inputs.message });
      return;
    }
    setLaunching(true);
    setNotice(null);
    attemptedLaunchRequestIdRef.current = requestId;
    const result = await run({
      environmentId: selectedEnvironment.environmentId,
      input: {
        requestId,
        projectId: selectedProject.id,
        yaml,
        inputs: inputs.value,
        modelSelection: selectedModel.selection,
        runtimeMode,
        timeoutMinutes: normalizeIntegrationRunTimeout(Number(timeoutMinutes)),
      },
    });
    setLaunching(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        setNotice({ tone: "error", message: commandFailureMessage(result) });
      }
      return;
    }
    resetValidation("Validate this LoopSpec again before launching another run.");
    navigation.navigate("SettingsSheet", {
      screen: "SettingsIntegrationRunDetail",
      params: {
        environmentId: String(selectedEnvironment.environmentId),
        runId: result.value.run.id,
      },
    });
  };

  if (environments.length === 0) {
    return (
      <EmptyState
        title="No environments"
        detail="Connect an execution environment before launching a LoopSpec."
        variant="plain"
      />
    );
  }

  const environmentActions: MenuAction[] = environments.map((environment) => ({
    id: String(environment.environmentId),
    title: environment.label,
    state: environment.environmentId === selectedEnvironment?.environmentId ? "on" : "off",
  }));
  const projectActions: MenuAction[] = projects
    .filter((project) => project.environmentId === selectedEnvironment?.environmentId)
    .map((project) => ({
      id: String(project.id),
      title: project.title,
      state: project.id === selectedProject?.id ? "on" : "off",
    }));
  const modelActions: MenuAction[] = modelOptions.map((model) => ({
    id: model.key,
    title: model.label,
    subtitle: model.subtitle,
    state: model.key === selectedModel?.key ? "on" : "off",
  }));
  const runtimeActions: MenuAction[] = [
    {
      id: "approval-required",
      title: "Ask for approvals",
      state: runtimeMode === "approval-required" ? "on" : "off",
    },
    {
      id: "auto-accept-edits",
      title: "Auto-accept edits",
      state: runtimeMode === "auto-accept-edits" ? "on" : "off",
    },
    {
      id: "full-access",
      title: "Full access",
      state: runtimeMode === "full-access" ? "on" : "off",
      attributes: { destructive: true },
    },
  ];

  return (
    <View className="flex-1 bg-sheet">
      {authoring.isPending || busy ? <LoadingStrip /> : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-1">
          <Text className="text-2xl font-notcodex-bold text-foreground">Run a LoopSpec</Text>
          <Text className="text-sm leading-normal text-foreground-muted">
            Validate on the selected environment, then run through ordinary Not Codex provider
            threads. The phone never executes the loop locally.
          </Text>
        </View>

        <SelectRow
          label="Execution environment"
          value={selectedEnvironment?.label ?? "Choose an environment"}
          actions={environmentActions}
          onSelect={handleEnvironmentSelect}
        />

        {!connected ? (
          <View
            accessibilityRole="alert"
            className="rounded-[18px] border border-amber-500/30 bg-amber-500/10 p-3"
          >
            <Text className="text-sm text-foreground">
              This environment is offline. Launch stays read-only until it reconnects.
            </Text>
          </View>
        ) : null}

        {authoring.data?.recipes.length ? (
          <View className="gap-2">
            <Text className="text-xs font-notcodex-bold uppercase tracking-wide text-foreground-muted">
              Verified recipes
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {authoring.data.recipes.map((recipe) => (
                <Pressable
                  key={recipe.name}
                  accessibilityLabel={`Load ${recipe.title} recipe`}
                  accessibilityHint={recipe.summary}
                  accessibilityRole="button"
                  disabled={!connected || busy}
                  className="min-h-[44px] justify-center rounded-full bg-card px-4 disabled:opacity-50"
                  onPress={() => void handleScaffold(recipe.name)}
                >
                  <Text className="font-notcodex-bold text-foreground">{recipe.title}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View className="gap-1.5">
          <Text className="text-xs font-notcodex-bold uppercase tracking-wide text-foreground-muted">
            LoopSpec YAML
          </Text>
          <TextInput
            accessibilityLabel="Monkey D. Loopy YAML LoopSpec"
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-[360px] font-mono text-sm"
            multiline
            onChangeText={(value) => {
              setYaml(value);
              resetValidation();
            }}
            scrollEnabled
            textAlignVertical="top"
            value={yaml}
          />
          <Text className="text-xs text-foreground-muted">
            Paste a saved specification or start from a verified recipe. Any edit requires fresh
            validation.
          </Text>
        </View>

        <Pressable
          accessibilityLabel={validating ? "Validating LoopSpec" : "Validate LoopSpec safely"}
          accessibilityRole="button"
          disabled={!connected || busy || yaml.trim().length === 0}
          className="min-h-[50px] items-center justify-center rounded-full bg-card px-5 disabled:opacity-50"
          onPress={() => void handleValidate()}
        >
          <Text className="font-notcodex-bold text-foreground">
            {validating ? "Validating…" : "Validate safely"}
          </Text>
        </Pressable>

        <NoticeCard notice={notice} />

        {validation ? (
          <View className="gap-2 rounded-[22px] bg-card p-4">
            <Text className="font-notcodex-bold text-foreground">
              {validation.name ?? "Unnamed LoopSpec"} · score {validation.score ?? "unavailable"}
            </Text>
            <Text className="text-sm text-foreground-muted">
              Authoring {validation.factoryVersion} · runtime {validation.executionVersion}
            </Text>
            {validation.diagnostics.map((diagnostic) => (
              <Text
                key={`${diagnostic.level}:${diagnostic.path ?? ""}:${diagnostic.message}`}
                className="text-sm leading-normal text-foreground-muted"
              >
                {diagnostic.level}: {diagnostic.message}
                {diagnostic.path ? ` (${diagnostic.path})` : ""}
              </Text>
            ))}
          </View>
        ) : null}

        <View className="gap-4 rounded-[22px] bg-card p-4">
          <Text className="text-lg font-notcodex-bold text-foreground">Harness settings</Text>
          <SelectRow
            label="Project"
            value={selectedProject?.title ?? "Choose a project"}
            actions={projectActions}
            onSelect={(id) => {
              setSelectedProjectId(id as ProjectId);
              setSelectedModelKey(null);
              invalidateAttemptedLaunch();
            }}
            disabled={projectActions.length === 0}
          />
          <SelectRow
            label="Model"
            value={
              selectedModel
                ? `${selectedModel.label} · ${selectedModel.subtitle}`
                : "Choose a model"
            }
            actions={modelActions}
            onSelect={(id) => {
              setSelectedModelKey(id);
              invalidateAttemptedLaunch();
            }}
            disabled={modelActions.length === 0}
          />
          <SelectRow
            label="Permission mode"
            value={
              runtimeMode === "approval-required"
                ? "Ask for approvals"
                : runtimeMode === "auto-accept-edits"
                  ? "Auto-accept edits"
                  : "Full access"
            }
            actions={runtimeActions}
            onSelect={(id) => {
              setRuntimeMode(id as RuntimeMode);
              invalidateAttemptedLaunch();
            }}
          />
          {runtimeMode === "full-access" ? (
            <View className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3">
              <Text className="text-sm leading-normal text-foreground">
                Full access removes approval prompts. Use it only for a trusted specification and
                project.
              </Text>
            </View>
          ) : null}
          <View className="gap-1.5">
            <Text className="text-xs font-notcodex-bold uppercase tracking-wide text-foreground-muted">
              Timeout (minutes)
            </Text>
            <TextInput
              accessibilityLabel="LoopSpec timeout in minutes"
              keyboardType="number-pad"
              maxLength={3}
              onChangeText={(value) => {
                setTimeoutMinutes(value);
                invalidateAttemptedLaunch();
              }}
              value={timeoutMinutes}
            />
            <Text className="text-xs text-foreground-muted">Allowed range: 1–240 minutes.</Text>
          </View>
          <View className="gap-1.5">
            <Text className="text-xs font-notcodex-bold uppercase tracking-wide text-foreground-muted">
              Input values (JSON object)
            </Text>
            <TextInput
              accessibilityLabel="LoopSpec input values JSON"
              autoCapitalize="none"
              autoCorrect={false}
              className="min-h-[120px] font-mono text-sm"
              multiline
              onChangeText={(value) => {
                setInputsJson(value);
                invalidateAttemptedLaunch();
              }}
              textAlignVertical="top"
              value={inputsJson}
            />
          </View>
        </View>

        <View className="rounded-[18px] border border-border bg-card p-3">
          <Text className="text-sm leading-normal text-foreground-muted">
            Journals and recovery metadata remain in server-managed storage. The mobile client sends
            the selected spec and settings only to this paired environment.
          </Text>
        </View>

        <Pressable
          accessibilityLabel={launching ? "Queuing LoopSpec" : "Run this LoopSpec"}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canLaunch }}
          disabled={!canLaunch}
          className="min-h-[52px] items-center justify-center rounded-full bg-primary px-5 disabled:opacity-40"
          onPress={() => void handleLaunch()}
        >
          <Text className="font-notcodex-bold text-primary-foreground">
            {launching ? "Queuing…" : "Run this LoopSpec"}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
