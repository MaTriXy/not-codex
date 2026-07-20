import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId } from "@notcodex/contracts";
import { useEffect } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { LoadingStrip } from "../../components/LoadingStrip";
import { useEnvironments } from "../../state/environments";
import { useProjects, useThreadShells } from "../../state/entities";
import { integrationEnvironment } from "../../state/integrations";
import { useEnvironmentQuery } from "../../state/query";
import {
  integrationRunDurationLabel,
  integrationRunIsActive,
  integrationRunIsStale,
  integrationRunProjectLabel,
  integrationRunThreadLinks,
} from "./integrationRunsPresentation";

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

export function IntegrationRunDetailRouteScreen(props: IntegrationRunDetailRouteProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const runId = props.route.params.runId;
  const { environments } = useEnvironments();
  const projects = useProjects();
  const threads = useThreadShells();
  const environment = environments.find((item) => item.environmentId === environmentId) ?? null;
  const query = useEnvironmentQuery(
    integrationEnvironment.getRun({ environmentId, input: { id: runId } }),
  );
  const run = query.data;
  const stale = environment === null || integrationRunIsStale(environment.connection.phase);
  const shouldRefresh = run !== null && integrationRunIsActive(run.state) && !stale;
  const threadLinks = run === null ? [] : integrationRunThreadLinks(run, environmentId, threads);

  useEffect(() => {
    if (!shouldRefresh) return;
    const intervalId = setInterval(query.refresh, 2_000);
    return () => clearInterval(intervalId);
  }, [query.refresh, shouldRefresh]);

  if (query.isPending && run === null) {
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
          title="Run unavailable"
          detail={
            query.error ??
            "This durable run is missing or no longer retained on the selected environment."
          }
          actionLabel="Retry"
          onAction={query.refresh}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-sheet">
      {query.isPending ? <LoadingStrip /> : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-1">
          <Text className="text-2xl font-notcodex-bold text-foreground">
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
            <Text className="text-lg font-notcodex-bold text-foreground">Verification</Text>
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
            <Text className="text-lg font-notcodex-bold text-foreground">Sanitized result</Text>
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
            <Text className="text-lg font-notcodex-bold text-rose-800 dark:text-rose-200">
              Sanitized failure
            </Text>
            <Text className="text-sm leading-normal text-foreground">{run.failure}</Text>
          </View>
        )}

        <View className="gap-3">
          <Text className="text-lg font-notcodex-bold text-foreground">Timeline</Text>
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
          <Text className="text-lg font-notcodex-bold text-foreground">Linked threads</Text>
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
          className="min-h-[48px] items-center justify-center rounded-full bg-primary px-5 active:opacity-70"
          onPress={query.refresh}
        >
          <Text className="font-notcodex-bold text-primary-foreground">Refresh</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
