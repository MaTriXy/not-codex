import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  reconcileLoopAnySettingsSnapshot,
  validateLoopAnySettingsDraft,
  type LoopAnySettingsSyncBarrier,
} from "@notcodex/client-runtime/state/loopany-settings";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@notcodex/client-runtime/state/runtime";
import {
  EnvironmentId,
  type LoopAnyConnectorDiagnostics,
  type LoopAnyHealthState,
  type LoopAnySettings,
} from "@notcodex/contracts";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { LoadingStrip } from "../../components/LoadingStrip";
import { StatusPill, type StatusTone } from "../../components/StatusPill";
import { useThemeColor } from "../../lib/useThemeColor";
import { useEnvironments } from "../../state/environments";
import { integrationEnvironment } from "../../state/integrations";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";
import {
  integrationAvailability,
  integrationStatusDetail,
  safeIntegrationRequestErrorDetail,
} from "../settings/integrationPresentation";

type LoopAnySettingsRouteProps = StaticScreenProps<{ readonly environmentId: string }>;
type Operation = "save" | "test" | "clear";
type Notice = { readonly tone: "success" | "error" | "info"; readonly message: string };

const EMPTY_SETTINGS: LoopAnySettings = {
  enabled: false,
  serverUrl: "",
  allowedRoots: [],
  pollWaitSeconds: 25,
};

function healthTone(health: LoopAnyHealthState): StatusTone {
  const success = health === "healthy";
  const warning = health === "connecting" || health === "backing-off";
  const neutral = health === "disabled";
  return {
    label: health,
    pillClassName: success
      ? "bg-emerald-500/12 dark:bg-emerald-500/16"
      : warning
        ? "bg-amber-500/12 dark:bg-amber-500/16"
        : neutral
          ? "bg-neutral-500/10 dark:bg-neutral-500/16"
          : "bg-rose-500/12 dark:bg-rose-500/16",
    textClassName: success
      ? "text-emerald-700 dark:text-emerald-300"
      : warning
        ? "text-amber-700 dark:text-amber-300"
        : neutral
          ? "text-neutral-600 dark:text-neutral-300"
          : "text-rose-700 dark:text-rose-300",
  };
}

function timestampLabel(value: string | null): string {
  return value === null ? "Not reported" : new Date(value).toLocaleString();
}

function commandFailureMessage(
  operation: Operation,
  result: Parameters<typeof isAtomCommandInterrupted>[0],
): string {
  if (isAtomCommandInterrupted(result))
    return "The command was interrupted. Refresh before retrying.";
  if (result._tag !== "Failure") return "The integration command did not complete.";
  const error = squashAtomCommandFailure(result);
  const fallback =
    operation === "test"
      ? "The saved LoopAny connection could not be verified."
      : operation === "clear"
        ? "The saved LoopAny token could not be removed."
        : "The LoopAny settings could not be saved.";
  return safeIntegrationRequestErrorDetail(error, fallback);
}

function Field(props: {
  readonly label: string;
  readonly detail: string;
  readonly children: React.ReactNode;
}) {
  return (
    <View className="gap-2 border-b border-border/70 p-4 last:border-b-0">
      <View className="gap-1">
        <Text className="font-notcodex-bold text-foreground">{props.label}</Text>
        <Text className="text-sm leading-normal text-foreground-muted">{props.detail}</Text>
      </View>
      {props.children}
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

function DiagnosticsCard(props: {
  readonly diagnostics: LoopAnyConnectorDiagnostics;
  readonly environmentId: EnvironmentId;
}) {
  const navigation = useNavigation();
  const events = props.diagnostics.recentEvents.toReversed().slice(0, 10);
  return (
    <SettingsSection title="Connector diagnostics" card>
      <View className="gap-4 p-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1 gap-1">
            <Text className="font-notcodex-bold text-foreground">Server-reported health</Text>
            <Text className="text-sm text-foreground-muted">
              Protocol {props.diagnostics.protocolVersion}
              {props.diagnostics.serverVersion
                ? ` · server ${props.diagnostics.serverVersion}`
                : ""}
            </Text>
          </View>
          <StatusPill {...healthTone(props.diagnostics.health)} size="compact" />
        </View>

        <View className="gap-1.5 rounded-2xl bg-subtle p-3">
          <Text className="text-sm text-foreground-muted">
            Last poll: {timestampLabel(props.diagnostics.lastPollAt)}
          </Text>
          <Text className="text-sm text-foreground-muted">
            Last success: {timestampLabel(props.diagnostics.lastSuccessAt)}
          </Text>
          <Text className="text-sm text-foreground-muted">
            Next retry: {timestampLabel(props.diagnostics.nextRetryAt)}
          </Text>
          <Text className="text-sm text-foreground-muted">
            In flight: {props.diagnostics.inFlight} · consecutive failures:{" "}
            {props.diagnostics.consecutiveFailures}
          </Text>
        </View>

        {props.diagnostics.lastError ? (
          <View accessibilityRole="alert" className="rounded-2xl bg-rose-500/10 p-3">
            <Text className="text-sm font-notcodex-bold text-foreground">
              {props.diagnostics.lastError.code}
            </Text>
            <Text className="mt-1 text-sm leading-normal text-foreground-muted">
              {props.diagnostics.lastError.message}
            </Text>
          </View>
        ) : null}

        {events.length > 0 ? (
          <View className="gap-2">
            <Text className="text-xs font-notcodex-bold uppercase tracking-wide text-foreground-muted">
              Recent events
            </Text>
            {events.map((event) => {
              const content = (
                <View className="gap-1 rounded-2xl bg-subtle p-3">
                  <Text className="text-sm font-notcodex-bold text-foreground">{event.code}</Text>
                  <Text className="text-sm leading-normal text-foreground-muted">
                    {event.summary}
                  </Text>
                  <Text className="text-xs text-foreground-muted">
                    {timestampLabel(event.occurredAt)}
                    {event.runId ? " · Open run ›" : ""}
                  </Text>
                </View>
              );
              return event.runId ? (
                <Pressable
                  key={event.id}
                  accessibilityLabel={`${event.code}. ${event.summary}. Open related run`}
                  accessibilityRole="button"
                  className="active:opacity-70"
                  onPress={() =>
                    navigation.navigate("SettingsSheet", {
                      screen: "SettingsIntegrationRunDetail",
                      params: {
                        environmentId: String(props.environmentId),
                        runId: event.runId!,
                      },
                    })
                  }
                >
                  {content}
                </Pressable>
              ) : (
                <View key={event.id}>{content}</View>
              );
            })}
          </View>
        ) : (
          <Text className="text-sm text-foreground-muted">No connector events reported yet.</Text>
        )}
      </View>
    </SettingsSection>
  );
}

export function LoopAnySettingsRouteScreen(props: LoopAnySettingsRouteProps) {
  const insets = useSafeAreaInsets();
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const { environments } = useEnvironments();
  const environment =
    environments.find((candidate) => candidate.environmentId === environmentId) ?? null;
  const savedSettings =
    useAtomValue(serverEnvironment.settingsValueAtom(environmentId))?.integrations.loopAny ?? null;
  const integrations = useEnvironmentQuery(
    integrationEnvironment.list({ environmentId, input: null }),
  );
  const configure = useAtomCommand(integrationEnvironment.configureLoopAny, {
    reportFailure: false,
  });
  const testConnection = useAtomCommand(integrationEnvironment.testLoopAny, {
    reportFailure: false,
  });
  const descriptor =
    integrations.data?.integrations.find((candidate) => candidate.id === "loopany") ?? null;
  const availability = integrationAvailability({
    descriptor,
    connectionState: environment?.connection.phase ?? "disconnected",
    queryError: integrations.error,
  });
  const connected = environment?.connection.phase === "connected";
  const canMutate =
    connected && descriptor !== null && integrations.error === null && !integrations.isPending;
  const activeTrack = String(useThemeColor("--color-switch-active"));
  const inactiveTrack = String(useThemeColor("--color-secondary-border"));
  const [enabled, setEnabled] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [allowedRootsText, setAllowedRootsText] = useState("");
  const [pollWaitSecondsText, setPollWaitSecondsText] = useState("25");
  const [replacementToken, setReplacementToken] = useState("");
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<Operation | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const operationLockRef = useRef(false);
  const initializedRef = useRef(false);
  const settingsSyncBarrierRef = useRef<LoopAnySettingsSyncBarrier | null>(null);

  const applySettings = (settings: LoopAnySettings) => {
    setEnabled(settings.enabled);
    setServerUrl(settings.serverUrl);
    setAllowedRootsText(settings.allowedRoots.join("\n"));
    setPollWaitSecondsText(String(settings.pollWaitSeconds));
    setDirty(false);
    initializedRef.current = true;
  };

  useEffect(() => {
    if (savedSettings !== null && (!initializedRef.current || !dirty)) {
      const sync = reconcileLoopAnySettingsSnapshot(savedSettings, settingsSyncBarrierRef.current);
      settingsSyncBarrierRef.current = sync.barrier;
      if (sync.apply) applySettings(savedSettings);
    } else if (savedSettings === null && !initializedRef.current) {
      applySettings(EMPTY_SETTINGS);
    }
  }, [dirty, savedSettings]);

  useEffect(() => {
    if (descriptor !== null) setTokenConfigured(descriptor.tokenConfigured);
  }, [descriptor]);

  useEffect(() => {
    if (!connected) setReplacementToken("");
  }, [connected]);

  const changeDraft = (change: () => void) => {
    change();
    setDirty(true);
    setNotice(null);
  };

  const runOperation = async (operation: Operation, effect: () => Promise<void>) => {
    if (operationLockRef.current) return;
    operationLockRef.current = true;
    setPendingOperation(operation);
    setNotice(null);
    try {
      await effect();
    } finally {
      operationLockRef.current = false;
      setPendingOperation(null);
    }
  };

  const handleSave = () =>
    runOperation("save", async () => {
      if (!canMutate) {
        setNotice({ tone: "error", message: "Reconnect this environment before saving." });
        return;
      }
      const validation = validateLoopAnySettingsDraft({
        enabled,
        serverUrl,
        allowedRootsText,
        pollWaitSecondsText,
        tokenConfigured,
        replacementToken,
      });
      if (!validation.ok) {
        setNotice({ tone: "error", message: validation.message });
        return;
      }
      const result = await configure({
        environmentId,
        input: {
          settings: validation.settings,
          ...(replacementToken.trim().length > 0 ? { token: replacementToken.trim() } : {}),
        },
      });
      if (result._tag === "Failure") {
        setNotice({
          tone: isAtomCommandInterrupted(result) ? "info" : "error",
          message: commandFailureMessage("save", result),
        });
        return;
      }
      settingsSyncBarrierRef.current = {
        staleSettings: savedSettings,
        appliedSettings: result.value.settings,
      };
      applySettings(result.value.settings);
      setReplacementToken("");
      setTokenConfigured(result.value.tokenConfigured);
      setNotice({ tone: "success", message: "LoopAny settings saved on this environment." });
      integrations.refresh();
    });

  const handleTest = () =>
    runOperation("test", async () => {
      if (!canMutate || dirty || replacementToken.trim().length > 0) {
        setNotice({ tone: "info", message: "Save the current settings before testing them." });
        return;
      }
      const result = await testConnection({ environmentId, input: null });
      if (result._tag === "Failure") {
        setNotice({
          tone: isAtomCommandInterrupted(result) ? "info" : "error",
          message: commandFailureMessage("test", result),
        });
        return;
      }
      setNotice({ tone: result.value.ok ? "success" : "error", message: result.value.message });
      integrations.refresh();
    });

  const clearToken = () =>
    runOperation("clear", async () => {
      if (!canMutate) {
        setNotice({
          tone: "error",
          message: "Reconnect this environment before removing the token.",
        });
        return;
      }
      const result = await configure({
        environmentId,
        input: { settings: { enabled: false }, clearToken: true },
      });
      if (result._tag === "Failure") {
        setNotice({
          tone: isAtomCommandInterrupted(result) ? "info" : "error",
          message: commandFailureMessage("clear", result),
        });
        return;
      }
      settingsSyncBarrierRef.current = {
        staleSettings: savedSettings,
        appliedSettings: result.value.settings,
      };
      applySettings(result.value.settings);
      setReplacementToken("");
      setTokenConfigured(false);
      setNotice({ tone: "success", message: "LoopAny was disabled and its token removed." });
      integrations.refresh();
    });

  const confirmClearToken = () =>
    Alert.alert(
      "Disable LoopAny and remove its token?",
      "The connector will stop polling. You will need to enter a new device token before enabling it again.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove Token", style: "destructive", onPress: () => void clearToken() },
      ],
    );

  if (environment === null) {
    return (
      <EmptyState
        title="Environment unavailable"
        detail="The selected environment is no longer paired with this device."
        variant="plain"
      />
    );
  }

  const busy = pendingOperation !== null;
  const mutationDisabled = !canMutate || busy;
  const statusDetail = integrationStatusDetail(availability);

  return (
    <View className="flex-1 bg-sheet">
      {integrations.isPending ? <LoadingStrip /> : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-2 rounded-[22px] bg-card p-4">
          <Text className="text-lg font-notcodex-bold text-foreground">{environment.label}</Text>
          <Text className="text-sm leading-normal text-foreground-muted">
            Configure the connector on this paired execution environment. The token is write-only
            and is never returned to or stored by the phone.
          </Text>
        </View>

        {!canMutate ? (
          <View
            accessibilityRole="alert"
            className="rounded-[18px] border border-amber-500/30 bg-amber-500/10 p-3"
          >
            <Text className="text-sm leading-normal text-foreground">
              {statusDetail ??
                "Configuration is read-only until this environment reports current integration status."}
            </Text>
          </View>
        ) : null}

        <SettingsSection title="Connector configuration" card>
          <Field
            label="Enable connector"
            detail="Poll LoopAny for eligible work and route every accepted agent step through the Not Codex harness."
          >
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-sm text-foreground-muted">
                {enabled ? "Enabled after save" : "Disabled after save"}
              </Text>
              <Switch
                accessibilityLabel="Enable LoopAny connector"
                accessibilityState={{ checked: enabled, disabled: mutationDisabled }}
                disabled={mutationDisabled}
                ios_backgroundColor={inactiveTrack}
                onValueChange={(value) => changeDraft(() => setEnabled(value))}
                trackColor={{ false: inactiveTrack, true: activeTrack }}
                value={enabled}
              />
            </View>
          </Field>
          <Field label="Server URL" detail="The HTTP or HTTPS base URL of your LoopAny server.">
            <TextInput
              accessibilityLabel="LoopAny server URL"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!mutationDisabled}
              keyboardType="url"
              onChangeText={(value) => changeDraft(() => setServerUrl(value))}
              placeholder="https://loopany.example.com"
              value={serverUrl}
            />
          </Field>
          <Field
            label="Device token"
            detail="Write-only. Leave blank to keep the saved token, or enter a replacement and save."
          >
            <TextInput
              accessibilityLabel="LoopAny replacement device token"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              editable={!mutationDisabled}
              onChangeText={(value) => changeDraft(() => setReplacementToken(value))}
              placeholder={tokenConfigured ? "Saved — enter a replacement" : "Device token"}
              secureTextEntry
              value={replacementToken}
            />
            <Text className="text-xs text-foreground-muted">
              {tokenConfigured
                ? "A token is stored in the server secret store."
                : "No token is stored on this environment."}
            </Text>
            {tokenConfigured ? (
              <Pressable
                accessibilityLabel="Disable LoopAny and remove saved device token"
                accessibilityRole="button"
                disabled={mutationDisabled}
                accessibilityState={{ disabled: mutationDisabled }}
                className="min-h-[48px] items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10 px-4 disabled:opacity-40"
                onPress={confirmClearToken}
              >
                <Text className="font-notcodex-bold text-foreground">
                  {pendingOperation === "clear" ? "Removing…" : "Disable and remove token"}
                </Text>
              </Pressable>
            ) : null}
          </Field>
          <Field
            label="Allowed project roots"
            detail="One absolute directory per line. Deliveries outside these roots, including symlink escapes, are rejected."
          >
            <TextInput
              accessibilityLabel="LoopAny allowed project roots"
              autoCapitalize="none"
              autoCorrect={false}
              className="min-h-[120px] font-mono text-sm"
              editable={!mutationDisabled}
              multiline
              onChangeText={(value) => changeDraft(() => setAllowedRootsText(value))}
              placeholder="/Users/you/Projects"
              textAlignVertical="top"
              value={allowedRootsText}
            />
          </Field>
          <Field
            label="Long-poll wait"
            detail="How long LoopAny may hold each delivery poll, from 5 to 60 seconds."
          >
            <TextInput
              accessibilityLabel="LoopAny long-poll wait in seconds"
              editable={!mutationDisabled}
              keyboardType="number-pad"
              maxLength={2}
              onChangeText={(value) => changeDraft(() => setPollWaitSecondsText(value))}
              value={pollWaitSecondsText}
            />
          </Field>
        </SettingsSection>

        <View className="flex-row flex-wrap gap-2">
          <Pressable
            accessibilityLabel={
              pendingOperation === "save" ? "Saving LoopAny settings" : "Save LoopAny settings"
            }
            accessibilityRole="button"
            accessibilityState={{ disabled: mutationDisabled || !dirty }}
            disabled={mutationDisabled || !dirty}
            className="min-h-[50px] min-w-[160px] flex-1 items-center justify-center rounded-full bg-primary px-5 disabled:opacity-40"
            onPress={() => void handleSave()}
          >
            <Text className="font-notcodex-bold text-primary-foreground">
              {pendingOperation === "save" ? "Saving…" : "Save connector"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Test saved LoopAny connection"
            accessibilityRole="button"
            accessibilityState={{ disabled: mutationDisabled || dirty || !tokenConfigured }}
            disabled={mutationDisabled || dirty || !tokenConfigured}
            className="min-h-[50px] min-w-[160px] flex-1 items-center justify-center rounded-full bg-card px-5 disabled:opacity-40"
            onPress={() => void handleTest()}
          >
            <Text className="font-notcodex-bold text-foreground">
              {pendingOperation === "test" ? "Testing…" : "Test saved connection"}
            </Text>
          </Pressable>
        </View>

        {dirty ? (
          <Text className="px-2 text-xs text-foreground-muted">
            Save these changes before testing the connection.
          </Text>
        ) : null}
        <NoticeCard notice={notice} />

        {descriptor?.diagnostics ? (
          <DiagnosticsCard diagnostics={descriptor.diagnostics} environmentId={environmentId} />
        ) : null}

        <View className="rounded-[18px] border border-border bg-card p-3">
          <Text className="text-sm leading-normal text-foreground-muted">
            The phone may cache these non-secret settings for reconnect UX. Device and delivery
            tokens, unrestricted paths, workflow payloads, and connector journals remain
            server-side.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
