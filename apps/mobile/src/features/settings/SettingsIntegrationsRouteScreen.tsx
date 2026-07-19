import type { EnvironmentId, IntegrationDescriptor } from "@notcodex/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { LoadingStrip } from "../../components/LoadingStrip";
import { StatusPill, type StatusTone } from "../../components/StatusPill";
import { useEnvironments } from "../../state/environments";
import { integrationEnvironment } from "../../state/integrations";
import { useEnvironmentQuery } from "../../state/query";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { SettingsSection } from "./components/SettingsSection";
import {
  integrationAvailability,
  integrationAccessibilityLabel,
  integrationAvailabilityLabel,
  integrationLastActivityLabel,
  integrationStatusDetail,
  isIntegrationQueryUnavailable,
  selectedIntegrationEnvironmentId,
  type IntegrationAvailability,
} from "./integrationPresentation";

function tone(availability: IntegrationAvailability): StatusTone {
  const danger =
    availability === "error" || availability === "offline" || availability === "unauthorized";
  const warning =
    availability === "connecting" ||
    availability === "unsupported" ||
    availability === "disconnected";
  return {
    label: integrationAvailabilityLabel(availability),
    pillClassName: danger
      ? "bg-rose-500/12 dark:bg-rose-500/16"
      : warning
        ? "bg-amber-500/12 dark:bg-amber-500/16"
        : availability === "ready"
          ? "bg-emerald-500/12 dark:bg-emerald-500/16"
          : "bg-neutral-500/10 dark:bg-neutral-500/16",
    textClassName: danger
      ? "text-rose-700 dark:text-rose-300"
      : warning
        ? "text-amber-700 dark:text-amber-300"
        : availability === "ready"
          ? "text-emerald-700 dark:text-emerald-300"
          : "text-neutral-600 dark:text-neutral-300",
  };
}

function IntegrationCard(props: {
  readonly descriptor: IntegrationDescriptor;
  readonly availability: IntegrationAvailability;
}) {
  const detail = integrationStatusDetail(props.availability);
  return (
    <View
      accessible
      accessibilityLabel={integrationAccessibilityLabel(props.descriptor, props.availability)}
      className="gap-3 rounded-[22px] bg-card p-4"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-lg font-notcodex-bold text-foreground">
            {props.descriptor.name}
          </Text>
          <Text className="text-sm leading-normal text-foreground-muted">
            {props.descriptor.description}
          </Text>
        </View>
        <StatusPill {...tone(props.availability)} size="compact" />
      </View>
      <View className="gap-1.5">
        <Text className="text-sm text-foreground-muted">Version {props.descriptor.version}</Text>
        <Text className="text-sm text-foreground-muted">
          Capabilities:{" "}
          {props.descriptor.capabilities.length
            ? props.descriptor.capabilities.join(", ")
            : "None reported"}
        </Text>
        <Text className="text-sm text-foreground-muted">
          Token configured: {props.descriptor.tokenConfigured ? "Yes" : "No"}
        </Text>
        <Text className="text-sm text-foreground-muted">
          Last activity: {integrationLastActivityLabel(props.descriptor.lastActivityAt)}
        </Text>
      </View>
      {detail ? (
        <Text className="text-sm leading-normal text-foreground-muted">{detail}</Text>
      ) : null}
    </View>
  );
}

export function SettingsIntegrationsRouteScreen() {
  const insets = useSafeAreaInsets();
  const { environments } = useEnvironments();
  const { onReconnectEnvironment } = useRemoteConnections();
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(
    environments[0]?.environmentId ?? null,
  );
  const resolvedEnvironmentId = selectedIntegrationEnvironmentId(
    environments.map((environment) => environment.environmentId),
    selectedEnvironmentId,
  );
  const selected =
    environments.find((environment) => environment.environmentId === resolvedEnvironmentId) ?? null;

  useEffect(() => {
    if (resolvedEnvironmentId !== selectedEnvironmentId) {
      setSelectedEnvironmentId(resolvedEnvironmentId);
    }
  }, [resolvedEnvironmentId, selectedEnvironmentId]);

  const integrations = useEnvironmentQuery(
    selected
      ? integrationEnvironment.list({ environmentId: selected.environmentId, input: undefined })
      : null,
  );
  const refresh = useCallback(() => integrations.refresh(), [integrations]);
  const queryAvailability = integrationAvailability({
    descriptor: null,
    connectionState: selected?.connection.phase ?? "disconnected",
    queryError: integrations.error,
  });
  const descriptors = useMemo(() => integrations.data?.integrations ?? [], [integrations.data]);
  const queryDetail = integrationStatusDetail(queryAvailability);

  if (environments.length === 0) {
    return (
      <EmptyState
        title="No environments"
        detail="Connect an environment to inspect its integrations."
        variant="plain"
      />
    );
  }

  return (
    <View className="flex-1 bg-sheet">
      {integrations.isPending ? (
        <View accessibilityLabel="Loading integrations" accessibilityRole="progressbar">
          <LoadingStrip />
        </View>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection title="Execution environment">
          <View className="gap-1 p-2">
            {environments.map((environment) => {
              const selectedEnvironment = environment.environmentId === selected?.environmentId;
              return (
                <Pressable
                  key={environment.environmentId}
                  accessibilityLabel={`Use ${environment.label} for integrations`}
                  accessibilityHint="Changes the environment whose integration status is shown"
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedEnvironment }}
                  className={
                    selectedEnvironment
                      ? "min-h-[48px] rounded-[16px] bg-subtle px-3 py-2.5"
                      : "min-h-[48px] rounded-[16px] px-3 py-2.5"
                  }
                  onPress={() => setSelectedEnvironmentId(environment.environmentId)}
                >
                  <Text className="text-base font-notcodex-bold text-foreground">
                    {environment.label}
                  </Text>
                  <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                    {environment.displayUrl ?? "Paired environment"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </SettingsSection>

        <View className="flex-row items-center justify-between gap-4">
          <View className="min-w-0 flex-1">
            <Text className="text-sm text-foreground-muted" numberOfLines={2}>
              Integration status is shown for {selected?.label} only.
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Refresh integrations"
            accessibilityHint={`Refreshes integration status for ${selected?.label ?? "the selected environment"}`}
            accessibilityRole="button"
            className="min-h-[48px] justify-center rounded-full bg-primary px-4 active:opacity-70"
            onPress={refresh}
          >
            <Text className="text-sm font-notcodex-bold text-primary-foreground">Refresh</Text>
          </Pressable>
        </View>

        {isIntegrationQueryUnavailable(queryAvailability) ? (
          <EmptyState
            title={integrationAvailabilityLabel(queryAvailability)}
            detail={queryDetail ?? "Could not load integrations for this environment."}
            actionLabel={
              queryAvailability === "disconnected" || queryAvailability === "offline"
                ? "Reconnect"
                : undefined
            }
            onAction={selected ? () => onReconnectEnvironment(selected.environmentId) : undefined}
          />
        ) : descriptors.length === 0 && !integrations.isPending ? (
          <EmptyState
            title="No integrations reported"
            detail="This environment did not report any available integrations."
          />
        ) : (
          <View className="gap-3">
            {descriptors.map((descriptor) => (
              <IntegrationCard
                key={descriptor.id}
                descriptor={descriptor}
                availability={integrationAvailability({
                  descriptor,
                  connectionState: selected?.connection.phase ?? "disconnected",
                  queryError: null,
                })}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
