import type { StaticScreenProps } from "@react-navigation/native";
import { useNavigation } from "@react-navigation/native";
import {
  EnvironmentId,
  type IntegrationListRunsInput,
  type IntegrationRun,
  type IntegrationRunCursor,
} from "@notcodex/contracts";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { LoadingStrip } from "../../components/LoadingStrip";
import { StatusPill, type StatusTone } from "../../components/StatusPill";
import { relativeTime } from "../../lib/time";
import { useEnvironments } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { integrationEnvironment } from "../../state/integrations";
import { useEnvironmentQuery } from "../../state/query";
import {
  integrationRunDurationLabel,
  integrationRunHistoryHasRefreshWarning,
  integrationRunIsStale,
  integrationRunProjectLabel,
  integrationRunTone,
  popIntegrationRunPage,
  pushIntegrationRunPage,
} from "./integrationRunsPresentation";

type IntegrationRunsRouteProps = StaticScreenProps<{
  readonly environmentId?: string;
}>;

function runStatusTone(run: IntegrationRun): StatusTone {
  const tone = integrationRunTone(run.state);
  return {
    label: run.state,
    pillClassName:
      tone === "success"
        ? "bg-emerald-500/12 dark:bg-emerald-500/16"
        : tone === "danger"
          ? "bg-rose-500/12 dark:bg-rose-500/16"
          : tone === "warning"
            ? "bg-amber-500/12 dark:bg-amber-500/16"
            : "bg-neutral-500/10 dark:bg-neutral-500/16",
    textClassName:
      tone === "success"
        ? "text-emerald-700 dark:text-emerald-300"
        : tone === "danger"
          ? "text-rose-700 dark:text-rose-300"
          : tone === "warning"
            ? "text-amber-700 dark:text-amber-300"
            : "text-neutral-600 dark:text-neutral-300",
  };
}

export function IntegrationRunsRouteScreen(props: IntegrationRunsRouteProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environments } = useEnvironments();
  const projects = useProjects();
  const requestedEnvironmentId = props.route.params?.environmentId ?? null;
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(() => {
    const requested =
      requestedEnvironmentId === null ? null : EnvironmentId.make(requestedEnvironmentId);
    return requested ?? environments[0]?.environmentId ?? null;
  });
  const selected =
    environments.find((environment) => environment.environmentId === selectedEnvironmentId) ??
    environments[0] ??
    null;
  const [pageCursors, setPageCursors] = useState<ReadonlyArray<IntegrationRunCursor | null>>([
    null,
  ]);
  const cursor = pageCursors.at(-1) ?? null;

  useEffect(() => {
    if (selected === null) {
      setSelectedEnvironmentId(null);
      return;
    }
    if (selected.environmentId !== selectedEnvironmentId) {
      setSelectedEnvironmentId(selected.environmentId);
    }
  }, [selected, selectedEnvironmentId]);

  useEffect(() => setPageCursors([null]), [selectedEnvironmentId]);

  const input = useMemo<IntegrationListRunsInput>(
    () => ({ ...(cursor === null ? {} : { cursor }), limit: 20 }),
    [cursor],
  );
  const query = useEnvironmentQuery(
    selected === null
      ? null
      : integrationEnvironment.listRuns({ environmentId: selected.environmentId, input }),
  );
  const runs = query.data?.runs ?? [];
  const stale = selected === null || integrationRunIsStale(selected.connection.phase);
  const now = Date.now();

  if (environments.length === 0) {
    return (
      <EmptyState
        title="No environments"
        detail="Connect an environment to inspect integration runs."
        variant="plain"
      />
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
        <View className="gap-2">
          <Text className="text-xs font-notcodex-bold uppercase tracking-wide text-foreground-muted">
            Execution environment
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {environments.map((environment) => {
              const active = environment.environmentId === selected?.environmentId;
              return (
                <Pressable
                  key={environment.environmentId}
                  accessibilityLabel={`Show runs from ${environment.label}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className={
                    active
                      ? "min-h-[44px] justify-center rounded-full bg-primary px-4"
                      : "min-h-[44px] justify-center rounded-full bg-card px-4"
                  }
                  onPress={() => setSelectedEnvironmentId(environment.environmentId)}
                >
                  <Text
                    className={
                      active
                        ? "font-notcodex-bold text-primary-foreground"
                        : "font-notcodex-bold text-foreground"
                    }
                  >
                    {environment.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {stale ? (
          <View
            accessibilityRole="alert"
            className="rounded-[18px] border border-amber-500/30 bg-amber-500/10 p-3"
          >
            <Text className="text-sm font-notcodex-bold text-amber-800 dark:text-amber-200">
              Showing stale read-only data
            </Text>
            <Text className="mt-1 text-sm text-foreground-muted">
              Reconnect {selected?.label ?? "this environment"} to refresh active and terminal
              states.
            </Text>
          </View>
        ) : null}

        {integrationRunHistoryHasRefreshWarning(query.error, runs.length) ? (
          <View
            accessibilityRole="alert"
            className="rounded-[18px] border border-amber-500/30 bg-amber-500/10 p-3"
          >
            <Text className="text-sm font-notcodex-bold text-amber-800 dark:text-amber-200">
              Refresh failed
            </Text>
            <Text className="mt-1 text-sm text-foreground-muted">
              Showing cached run history. Retry before relying on the latest run states.
            </Text>
          </View>
        ) : null}

        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-sm text-foreground-muted">
            Page {pageCursors.length} · {selected?.label}
          </Text>
          <Pressable
            accessibilityLabel="Refresh integration runs"
            accessibilityRole="button"
            className="min-h-[44px] justify-center rounded-full bg-card px-4"
            onPress={query.refresh}
          >
            <Text className="font-notcodex-bold text-foreground">Refresh</Text>
          </Pressable>
        </View>

        {query.error && runs.length === 0 ? (
          <EmptyState
            title="Run history unavailable"
            detail="Reconnect or retry this environment request."
            actionLabel="Retry"
            onAction={query.refresh}
          />
        ) : runs.length === 0 && !query.isPending ? (
          <EmptyState
            title="No integration runs"
            detail="Validated Loopy launches and accepted LoopAny deliveries will appear here."
          />
        ) : (
          <View className="gap-3">
            {runs.map((run) => (
              <Pressable
                key={run.id}
                accessibilityLabel={`${run.source === "loopany" ? "LoopAny" : "Monkey D. Loopy"} run ${run.state}, ${selected?.label}`}
                accessibilityHint="Opens durable run details"
                accessibilityRole="button"
                className="gap-3 rounded-[22px] bg-card p-4 active:opacity-70"
                onPress={() =>
                  navigation.navigate("SettingsSheet", {
                    screen: "SettingsIntegrationRunDetail",
                    params: {
                      environmentId: String(selected!.environmentId),
                      runId: run.id,
                    },
                  })
                }
              >
                <View className="flex-row items-start justify-between gap-3">
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-base font-notcodex-bold text-foreground">
                      {run.source === "loopany" ? "LoopAny" : "Monkey.D.Loopy"}
                    </Text>
                    <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                      {integrationRunProjectLabel(run, projects, selected!.environmentId)}
                    </Text>
                  </View>
                  <StatusPill {...runStatusTone(run)} size="compact" />
                </View>
                <View className="flex-row flex-wrap gap-x-4 gap-y-1">
                  <Text className="text-xs text-foreground-muted">
                    {relativeTime(run.createdAt)} ago
                  </Text>
                  <Text className="text-xs text-foreground-muted">
                    Duration {integrationRunDurationLabel(run, now)}
                  </Text>
                  <Text className="text-xs text-foreground-muted">Attempt {run.attempt}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <View className="flex-row items-center justify-between border-t border-border pt-4">
          <Pressable
            accessibilityLabel="Previous run page"
            accessibilityRole="button"
            accessibilityState={{ disabled: pageCursors.length === 1 }}
            disabled={pageCursors.length === 1}
            className="min-h-[44px] justify-center rounded-full bg-card px-4 disabled:opacity-40"
            onPress={() => setPageCursors(popIntegrationRunPage)}
          >
            <Text className="font-notcodex-bold text-foreground">Previous</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Next run page"
            accessibilityRole="button"
            accessibilityState={{
              disabled: query.data?.nextCursor === null || query.data === null,
            }}
            disabled={query.data?.nextCursor === null || query.data === null}
            className="min-h-[44px] justify-center rounded-full bg-card px-4 disabled:opacity-40"
            onPress={() =>
              setPageCursors((pages) =>
                pushIntegrationRunPage(pages, query.data?.nextCursor ?? null),
              )
            }
          >
            <Text className="font-notcodex-bold text-foreground">Next</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
