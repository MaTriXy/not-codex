import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  deriveIntegrationRunControls,
  getOrCreateIntegrationRetryRequest,
  integrationRunOperationConfirmation,
  type IntegrationRetryRequest,
  type IntegrationRunOperation,
} from "@notcodex/client-runtime/state/integration-run-operations";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@notcodex/client-runtime/state/runtime";
import { EnvironmentId } from "@notcodex/contracts";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { LoadingStrip } from "../../components/LoadingStrip";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironments } from "../../state/environments";
import { useProjects, useThreadShells } from "../../state/entities";
import { integrationEnvironment } from "../../state/integrations";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  integrationRunDetailIsLoading,
  integrationRunDurationLabel,
  integrationRunHasRefreshWarning,
  integrationRunIsActive,
  integrationRunIsStale,
  integrationRunProjectLabel,
  selectIntegrationRunDetailRun,
  selectIntegrationRunRuntimeInspection,
  integrationRunThreadLinks,
} from "./integrationRunsPresentation";
import {
  interruptedIntegrationCommandDetail,
  safeIntegrationRequestErrorDetail,
} from "../settings/integrationPresentation";

type IntegrationRunDetailRouteProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly runId: string;
}>;

function DetailRow(props: { readonly label: string; readonly value: string }) {
  return (
    <View className="gap-1 border-b border-border/70 py-3 last:border-b-0">
      <Text className="text-xs font-notcodex-bold uppercase tracking-wide text-foreground-muted">
        {props.label}
      </Text>
      <Text className="text-sm leading-normal text-foreground" selectable>
        {props.value}
      </Text>
    </View>
  );
}

function operationLabel(operation: IntegrationRunOperation): string {
  if (operation === "cancel") return "Cancel run";
  if (operation === "resume") return "Resume run";
  return "Retry run";
}

function operationFailureMessage(
  operation: IntegrationRunOperation,
  result: Parameters<typeof squashAtomCommandFailure>[0],
): string {
  const error = squashAtomCommandFailure(result);
  const fallback = `${operationLabel(operation)} failed.`;
  return safeIntegrationRequestErrorDetail(error, `${fallback} Refresh before retrying.`);
}

export function IntegrationRunDetailRouteScreen(props: IntegrationRunDetailRouteProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const runId = props.route.params.runId;
  const { environments } = useEnvironments();
  const projects = useProjects();
  const threads = useThreadShells();
  const environment = environments.find((item) => item.environmentId === environmentId) ?? null;
  const durableQuery = useEnvironmentQuery(
    integrationEnvironment.getRun({ environmentId, input: { id: runId } }),
  );
  const inspectionQuery = useEnvironmentQuery(
    integrationEnvironment.inspectRun({ environmentId, input: { id: runId } }),
  );
  const cancelRun = useAtomCommand(integrationEnvironment.cancelRun, { reportFailure: false });
  const resumeRun = useAtomCommand(integrationEnvironment.resumeRun, { reportFailure: false });
  const retryRun = useAtomCommand(integrationEnvironment.retryRun, { reportFailure: false });
  const retryRequestRef = useRef<IntegrationRetryRequest | null>(null);
  const [pendingOperation, setPendingOperation] = useState<IntegrationRunOperation | null>(null);
  const operationLockRef = useRef(false);
  const [operationNotice, setOperationNotice] = useState<{
    readonly tone: "success" | "error" | "info";
    readonly message: string;
  } | null>(null);
  const inspection = inspectionQuery.data;
  const run = selectIntegrationRunDetailRun({
    inspectedRun: inspection?.run ?? null,
    durableRun: durableQuery.data,
    inspectionError: inspectionQuery.error,
  });
  const runtimeInspection = selectIntegrationRunRuntimeInspection({
    runtime: inspection?.runtime ?? null,
    inspectionError: inspectionQuery.error,
  });
  const stale = environment === null || integrationRunIsStale(environment.connection.phase);
  const shouldRefresh = run !== null && integrationRunIsActive(run.state) && !stale;
  const threadLinks = run === null ? [] : integrationRunThreadLinks(run, environmentId, threads);
  const connected = environment?.connection.phase === "connected";
  const controls =
    inspection && inspectionQuery.error === null
      ? deriveIntegrationRunControls({
          inspection,
          connected,
          queryPending: inspectionQuery.isPending,
          pendingOperation,
        })
      : [];

  const refresh = () => {
    durableQuery.refresh();
    inspectionQuery.refresh();
  };

  useEffect(() => {
    if (!shouldRefresh) return;
    const intervalId = setInterval(() => {
      durableQuery.refresh();
      inspectionQuery.refresh();
    }, 2_000);
    return () => clearInterval(intervalId);
  }, [durableQuery.refresh, inspectionQuery.refresh, shouldRefresh]);

  const executeOperation = async (operation: IntegrationRunOperation) => {
    if (
      run === null ||
      inspection === null ||
      inspectionQuery.error !== null ||
      inspectionQuery.isPending ||
      !inspection.operations[operation].allowed ||
      !connected ||
      pendingOperation !== null ||
      operationLockRef.current
    ) {
      return;
    }
    operationLockRef.current = true;
    setPendingOperation(operation);
    setOperationNotice(null);
    const result = await (async () => {
      if (operation === "cancel") {
        return cancelRun({ environmentId, input: { id: run.id } });
      }
      if (operation === "resume") {
        return resumeRun({
          environmentId,
          input: { id: run.id, approveCaps: run.state === "waiting" },
        });
      }
      const retryRequest = getOrCreateIntegrationRetryRequest(
        retryRequestRef.current,
        run.id,
        uuidv4(),
      );
      retryRequestRef.current = retryRequest;
      return retryRun({
        environmentId,
        input: { id: run.id, requestId: retryRequest.requestId },
      });
    })();
    operationLockRef.current = false;
    setPendingOperation(null);
    if (result._tag === "Failure") {
      setOperationNotice({
        tone: isAtomCommandInterrupted(result) ? "info" : "error",
        message: isAtomCommandInterrupted(result)
          ? interruptedIntegrationCommandDetail(operationLabel(operation))
          : operationFailureMessage(operation, result),
      });
      refresh();
      return;
    }
    if (operation === "retry") {
      retryRequestRef.current = null;
      navigation.navigate("SettingsSheet", {
        screen: "SettingsIntegrationRunDetail",
        params: {
          environmentId: String(environmentId),
          runId: result.value.run.id,
        },
      });
      return;
    }
    setOperationNotice({
      tone: "success",
      message:
        operation === "cancel"
          ? `Cancellation completed with state: ${result.value.run.state}.`
          : "Resume accepted. This run is continuing from its existing journal.",
    });
    refresh();
  };

  const confirmOperation = (operation: IntegrationRunOperation) => {
    if (run === null) return;
    const confirmation = integrationRunOperationConfirmation(operation, run);
    Alert.alert(confirmation.title, `${confirmation.description}\n\n${confirmation.consequence}`, [
      { text: "Keep run", style: "cancel" },
      {
        text: confirmation.confirmLabel,
        style: operation === "cancel" ? "destructive" : "default",
        onPress: () => void executeOperation(operation),
      },
    ]);
  };

  if (
    integrationRunDetailIsLoading(
      durableQuery.isPending || inspectionQuery.isPending,
      run !== null,
      stale,
    )
  ) {
    return (
      <View className="flex-1 bg-sheet">
        <LoadingStrip />
      </View>
    );
  }
  if (run === null) {
    return (
      <View className="flex-1 bg-sheet px-5 pt-8">
        <EmptyState
          title={stale ? "Run detail unavailable offline" : "Run unavailable"}
          detail={
            stale
              ? "Reconnect this execution environment to open the cached run history entry."
              : durableQuery.error || inspectionQuery.error
                ? safeIntegrationRequestErrorDetail(
                    durableQuery.error ?? inspectionQuery.error,
                    "This durable run is unavailable or no longer retained on the selected environment.",
                  )
                : "This durable run is missing or no longer retained on the selected environment."
          }
          actionLabel={stale ? undefined : "Retry"}
          onAction={stale ? undefined : refresh}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-sheet">
      {durableQuery.isPending || inspectionQuery.isPending || pendingOperation !== null ? (
        <LoadingStrip />
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-1">
          <Text accessibilityRole="header" className="text-2xl font-notcodex-bold text-foreground">
            {run.source === "loopany" ? "LoopAny run" : "Monkey.D.Loopy run"}
          </Text>
          <Text className="text-sm text-foreground-muted">
            {environment?.label ?? environmentId} · {run.state}
          </Text>
        </View>

        {stale ? (
          <View
            accessibilityRole="alert"
            className="rounded-[18px] border border-amber-500/30 bg-amber-500/10 p-3"
          >
            <Text className="text-sm font-notcodex-bold text-amber-800 dark:text-amber-200">
              Stale read-only snapshot
            </Text>
            <Text className="mt-1 text-sm text-foreground-muted">
              Reconnect this execution environment before relying on active state.
            </Text>
          </View>
        ) : null}

        {integrationRunHasRefreshWarning(durableQuery.error, run !== null) ? (
          <View
            accessibilityRole="alert"
            className="rounded-[18px] border border-amber-500/30 bg-amber-500/10 p-3"
          >
            <Text className="text-sm font-notcodex-bold text-amber-800 dark:text-amber-200">
              Refresh failed
            </Text>
            <Text className="mt-1 text-sm text-foreground-muted">
              Showing cached run details. Retry before relying on the latest state or timeline.
            </Text>
          </View>
        ) : null}

        {inspectionQuery.error && connected ? (
          <View
            accessibilityRole="alert"
            className="rounded-[18px] border border-rose-500/30 bg-rose-500/10 p-3"
          >
            <Text className="text-sm font-notcodex-bold text-rose-800 dark:text-rose-200">
              Run controls unavailable
            </Text>
            <Text className="mt-1 text-sm leading-normal text-foreground-muted">
              {safeIntegrationRequestErrorDetail(
                inspectionQuery.error,
                "Refresh the run before using server-authorized controls.",
              )}
            </Text>
          </View>
        ) : null}

        {controls.length > 0 ? (
          <View className="gap-3 rounded-[22px] bg-card p-4">
            <Text accessibilityRole="header" className="text-lg font-notcodex-bold text-foreground">
              Run controls
            </Text>
            <Text className="text-sm leading-normal text-foreground-muted">
              Only operations authorized by the latest server inspection appear here.
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {controls.map((control) => (
                <Pressable
                  key={control.operation}
                  accessibilityLabel={operationLabel(control.operation)}
                  accessibilityHint={
                    control.disabled
                      ? (control.disabledReason ?? undefined)
                      : integrationRunOperationConfirmation(control.operation, run).description
                  }
                  accessibilityRole="button"
                  accessibilityState={{ disabled: control.disabled }}
                  disabled={control.disabled}
                  className={
                    control.operation === "cancel"
                      ? "min-h-[48px] justify-center rounded-full bg-rose-500/12 px-4 disabled:opacity-40"
                      : "min-h-[48px] justify-center rounded-full bg-primary px-4 disabled:opacity-40"
                  }
                  onPress={() => confirmOperation(control.operation)}
                >
                  <Text
                    className={
                      control.operation === "cancel"
                        ? "font-notcodex-bold text-rose-700 dark:text-rose-300"
                        : "font-notcodex-bold text-primary-foreground"
                    }
                  >
                    {pendingOperation === control.operation
                      ? `${operationLabel(control.operation)}…`
                      : operationLabel(control.operation)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : inspection !== null ? (
          <View className="rounded-[18px] border border-border bg-card p-3">
            <Text className="text-sm text-foreground-muted">
              No run operations are authorized in the current state.
            </Text>
          </View>
        ) : null}

        {operationNotice ? (
          <View
            accessibilityRole={operationNotice.tone === "error" ? "alert" : "summary"}
            className={
              operationNotice.tone === "error"
                ? "rounded-[18px] border border-rose-500/30 bg-rose-500/10 p-3"
                : operationNotice.tone === "success"
                  ? "rounded-[18px] border border-emerald-500/30 bg-emerald-500/10 p-3"
                  : "rounded-[18px] border border-border bg-card p-3"
            }
          >
            <Text className="text-sm leading-normal text-foreground">
              {operationNotice.message}
            </Text>
          </View>
        ) : null}

        {runtimeInspection ? (
          <View className="gap-3 rounded-[22px] bg-card p-4">
            <View className="flex-row flex-wrap items-start justify-between gap-3">
              <Text
                accessibilityRole="header"
                className="text-lg font-notcodex-bold text-foreground"
              >
                Runtime inspection
              </Text>
              <Text className="text-xs font-notcodex-bold uppercase text-foreground-muted">
                {runtimeInspection.live ? "Live" : "Durable"} · {runtimeInspection.phase}
              </Text>
            </View>
            <View className="flex-row flex-wrap gap-x-5 gap-y-2">
              <Text className="text-sm text-foreground-muted">
                Started {runtimeInspection.progress.agentCallsStarted}
              </Text>
              <Text className="text-sm text-foreground-muted">
                Completed {runtimeInspection.progress.agentCallsCompleted}
              </Text>
              <Text className="text-sm text-foreground-muted">
                Recoverable {runtimeInspection.recoverable ? "yes" : "no"}
              </Text>
            </View>
            {runtimeInspection.progress.activeStep ? (
              <Text className="text-sm leading-normal text-foreground">
                Active step: {runtimeInspection.progress.activeStep}
              </Text>
            ) : null}
            {runtimeInspection.caps ? (
              <View className="gap-1 rounded-2xl bg-sheet p-3">
                <Text className="text-sm font-notcodex-bold text-foreground">Declared caps</Text>
                <Text className="text-xs leading-normal text-foreground-muted">
                  Iterations {runtimeInspection.caps.maxIterations} · on cap{" "}
                  {runtimeInspection.caps.onCapExceeded}
                  {runtimeInspection.caps.tokenBudget === null
                    ? ""
                    : ` · ${runtimeInspection.caps.tokenBudget} tokens`}
                  {runtimeInspection.caps.usdBudget === null
                    ? ""
                    : ` · $${runtimeInspection.caps.usdBudget}`}
                  {runtimeInspection.caps.wallclockBudget === null
                    ? ""
                    : ` · ${runtimeInspection.caps.wallclockBudget}`}
                </Text>
              </View>
            ) : null}
            {runtimeInspection.diagnostics.length > 0 ? (
              <Text className="text-xs leading-normal text-foreground-muted" selectable>
                {runtimeInspection.diagnostics.join("\n")}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View className="rounded-[22px] bg-card px-4">
          <DetailRow label="Environment" value={environment?.label ?? environmentId} />
          <DetailRow
            label="Project"
            value={integrationRunProjectLabel(run, projects, environmentId)}
          />
          <DetailRow label="State" value={run.state} />
          <DetailRow label="Attempt" value={String(run.attempt)} />
          <DetailRow label="Duration" value={integrationRunDurationLabel(run, Date.now())} />
          <DetailRow label="Updated" value={new Date(run.updatedAt).toLocaleString()} />
          <DetailRow label="Run ID" value={run.id} />
        </View>

        {run.parentRunId === null ? null : (
          <Pressable
            accessibilityLabel={`Open parent run ${run.parentRunId}`}
            accessibilityRole="button"
            className="min-h-[48px] justify-center rounded-[18px] bg-card px-4 active:opacity-70"
            onPress={() =>
              navigation.navigate("SettingsSheet", {
                screen: "SettingsIntegrationRunDetail",
                params: {
                  environmentId: String(environmentId),
                  runId: run.parentRunId!,
                },
              })
            }
          >
            <Text className="font-notcodex-bold text-foreground">
              Attempt {run.attempt} · open parent run
            </Text>
          </Pressable>
        )}

        {run.verification === null ? null : (
          <View className="gap-2 rounded-[22px] bg-card p-4">
            <Text accessibilityRole="header" className="text-lg font-notcodex-bold text-foreground">
              Verification
            </Text>
            <Text className="text-sm text-foreground-muted">
              {run.verification.name ?? "Unnamed specification"} · score{" "}
              {run.verification.score ?? "unavailable"}
            </Text>
            <Text className="text-sm text-foreground-muted">
              {run.verification.errorCount} errors · {run.verification.warningCount} warnings ·{" "}
              {run.verification.infoCount} info
            </Text>
            <Text className="text-sm text-foreground-muted">
              Factory {run.verification.factoryVersion} · runtime{" "}
              {run.verification.executionVersion}
            </Text>
          </View>
        )}

        {run.outputSummary === null ? null : (
          <View className="gap-2 rounded-[22px] bg-card p-4">
            <Text accessibilityRole="header" className="text-lg font-notcodex-bold text-foreground">
              Sanitized result
            </Text>
            <Text className="text-sm leading-normal text-foreground" selectable>
              {run.outputSummary}
            </Text>
          </View>
        )}

        {run.failure === null ? null : (
          <View
            accessibilityRole="alert"
            className="gap-2 rounded-[22px] border border-rose-500/30 bg-rose-500/10 p-4"
          >
            <Text
              accessibilityRole="header"
              className="text-lg font-notcodex-bold text-rose-800 dark:text-rose-200"
            >
              Sanitized failure
            </Text>
            <Text className="text-sm leading-normal text-foreground">{run.failure}</Text>
          </View>
        )}

        <View className="gap-3">
          <Text accessibilityRole="header" className="text-lg font-notcodex-bold text-foreground">
            Timeline
          </Text>
          {run.timeline.length === 0 ? (
            <Text className="text-sm text-foreground-muted">
              No lifecycle events were retained.
            </Text>
          ) : (
            run.timeline.map((event) => (
              <View
                key={`${event.sequence}:${event.occurredAt}`}
                className="gap-1 rounded-[18px] bg-card p-4"
              >
                <Text className="font-notcodex-bold text-foreground">{event.summary}</Text>
                <Text className="text-xs text-foreground-muted">
                  {event.state} · {new Date(event.occurredAt).toLocaleString()}
                </Text>
              </View>
            ))
          )}
        </View>

        <View className="gap-3">
          <Text accessibilityRole="header" className="text-lg font-notcodex-bold text-foreground">
            Linked threads
          </Text>
          {threadLinks.length === 0 ? (
            <Text className="text-sm text-foreground-muted">
              No ordinary Not Codex thread is linked yet.
            </Text>
          ) : (
            threadLinks.map((thread) => (
              <Pressable
                key={thread.threadId}
                accessibilityLabel={
                  thread.available
                    ? `Open linked thread ${thread.threadId}`
                    : `Linked thread ${thread.threadId} unavailable`
                }
                accessibilityRole="button"
                accessibilityState={{ disabled: !thread.available }}
                disabled={!thread.available}
                className="min-h-[48px] justify-center rounded-[18px] bg-card px-4 disabled:opacity-50"
                onPress={() =>
                  navigation.navigate("Thread", {
                    environmentId: String(environmentId),
                    threadId: String(thread.threadId),
                  })
                }
              >
                <Text className="font-notcodex-bold text-foreground">
                  {thread.available ? "Open thread" : "Thread unavailable"}
                </Text>
                <Text className="mt-1 text-xs text-foreground-muted" numberOfLines={1}>
                  {thread.threadId}
                </Text>
              </Pressable>
            ))
          )}
        </View>

        <Pressable
          accessibilityLabel="Refresh run detail"
          accessibilityRole="button"
          accessibilityState={{
            disabled: stale || durableQuery.isPending || inspectionQuery.isPending,
          }}
          disabled={stale || durableQuery.isPending || inspectionQuery.isPending}
          className="min-h-[48px] items-center justify-center rounded-full bg-primary px-5 active:opacity-70 disabled:opacity-40"
          onPress={refresh}
        >
          <Text className="font-notcodex-bold text-primary-foreground">Refresh</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
