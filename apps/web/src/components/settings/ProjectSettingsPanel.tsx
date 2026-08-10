import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@notcodex/client-runtime/state/runtime";
import { scopeProjectRef } from "@notcodex/client-runtime/environment";
import type {
  ContextMenuItem,
  ModelSelection,
  ProjectScript,
  SidebarProjectGroupingMode,
} from "@notcodex/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@notcodex/shared/keybindings";
import { createModelSelection } from "@notcodex/shared/model";
import { useCanGoBack, useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import { ChevronDownIcon, CopyIcon, Trash2Icon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { isElectron } from "../../env";
import {
  useClientSettings,
  usePrimarySettings,
  useUpdateClientSettings,
} from "../../hooks/useSettings";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import {
  decodeProjectScriptKeybindingRule,
  keybindingValueForCommand,
} from "../../lib/projectScriptKeybindings";
import { cn } from "../../lib/utils";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { commandForProjectScript, nextProjectScriptId } from "../../projectScripts";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectGroupMember,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects, useThreadShells } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { primaryServerProvidersAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { ProjectFavicon } from "../ProjectFavicon";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { ProjectFaviconPickerDialog } from "./ProjectFaviconPickerDialog";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import {
  deriveProjectGroupingOverrideKey,
  selectProjectGroupingSettings,
} from "../../logicalProject";
import { readLocalApi } from "../../localApi";

export const PROJECT_GROUPING_MODE_LABELS: Record<SidebarProjectGroupingMode, string> = {
  repository: "Group by repository",
  repository_path: "Group by repository path",
  separate: "Keep separate",
};

export function useSettingsProjectGroups(): SidebarProjectSnapshot[] {
  const projects = useProjects();
  const settings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const environmentLabelById = useMemo(
    () =>
      new Map(environments.map((environment) => [environment.environmentId, environment.label])),
    [environments],
  );
  return useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects,
        settings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
      }).sort((left, right) => left.displayName.localeCompare(right.displayName)),
    [environmentLabelById, primaryEnvironmentId, projects, settings],
  );
}

function memberKey(member: { environmentId: string; id: string }): string {
  return `${member.environmentId}:${member.id}`;
}

export function ProjectSettingsPage({ projectKey }: { projectKey: string }) {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const navigateBack = useCallback(() => {
    if (canGoBack) {
      window.history.back();
    } else {
      void navigate({ to: "/" });
    }
  }, [canGoBack, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      navigateBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateBack]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <div
          className={cn(
            isElectron
              ? "drag-region flex h-[52px] shrink-0 items-center px-5 wco:h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]"
              : "workspace-topbar px-3 sm:px-5",
            "transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <ProjectSettingsBreadcrumb projectKey={projectKey} />
        </div>
        <ProjectSettingsPanel projectKey={projectKey} />
      </div>
    </SidebarInset>
  );
}

function ProjectSettingsBreadcrumb({ projectKey }: { projectKey: string }) {
  const groups = useSettingsProjectGroups();
  const navigate = useNavigate();
  const selected = groups.find((group) => group.projectKey === projectKey) ?? null;
  const openProjectMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const api = readLocalApi();
    if (!api) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const items: ContextMenuItem<string>[] = groups.map((group) => ({
      id: group.projectKey,
      label: group.displayName,
    }));
    void settlePromise(() =>
      api.contextMenu.show(items, { x: rect.left, y: rect.bottom + 4 }),
    ).then((result) => {
      if (result._tag === "Failure" || result.value === null) return;
      void navigate({
        to: "/projects/$projectKey",
        params: { projectKey: result.value },
        replace: true,
        hashScrollIntoView: false,
      });
    });
  };
  return (
    <WorkspaceBreadcrumb ariaLabel="Project settings breadcrumb">
      <WorkspaceBreadcrumbItem>Projects</WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator />
      <WorkspaceBreadcrumbItem current>
        {selected ? (
          <button
            type="button"
            aria-haspopup="menu"
            aria-label="Switch project"
            onClick={openProjectMenu}
            className="group/project-title inline-flex min-w-0 max-w-64 cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 truncate">{selected.displayName}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/project-title:opacity-100 group-focus-visible/project-title:opacity-100" />
          </button>
        ) : (
          <span className="truncate text-muted-foreground">Unavailable project</span>
        )}
      </WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );
}

export function ProjectSettingsPanel({ projectKey }: { projectKey: string }) {
  const groups = useSettingsProjectGroups();
  const navigate = useNavigate();
  const selected = groups.find((group) => group.projectKey === projectKey) ?? null;
  const lastSelectionRef = useRef<{ key: string; members: string[] } | null>(null);
  useEffect(() => {
    if (selected) {
      lastSelectionRef.current = {
        key: selected.projectKey,
        members: selected.memberProjects.map((member) => member.physicalProjectKey),
      };
    }
  }, [selected]);
  useEffect(() => {
    if (selected) return;
    const last = lastSelectionRef.current;
    if (last?.key !== projectKey) return;
    const successor = groups.find((group) =>
      group.memberProjects.some((member) => last.members.includes(member.physicalProjectKey)),
    );
    if (successor) {
      void navigate({
        to: "/projects/$projectKey",
        params: { projectKey: successor.projectKey },
        replace: true,
        hashScrollIntoView: false,
      });
    }
  }, [groups, navigate, projectKey, selected]);

  if (!selected) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        {groups.length === 0
          ? "Add a project from the sidebar to configure it here."
          : "This project is no longer available."}
      </div>
    );
  }
  return <ProjectDetail key={selected.projectKey} group={selected} />;
}

function scriptFromInput(id: string, input: NewProjectScriptInput): ProjectScript {
  return {
    id,
    name: input.name,
    command: input.command,
    icon: input.icon,
    runOnWorktreeCreate: input.runOnWorktreeCreate,
    ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
    ...(input.previewUrl && input.autoOpenPreview ? { autoOpenPreview: true } : {}),
  };
}

function ProjectDetail({ group }: { group: SidebarProjectSnapshot }) {
  const navigate = useNavigate();
  const settings = usePrimarySettings();
  const updateClientSettings = useUpdateClientSettings();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const providers = useAtomValue(primaryServerProvidersAtom);
  const threads = useThreadShells();
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const deleteProject = useAtomCommand(projectEnvironment.delete, { reportFailure: false });
  const upsertKeybinding = useAtomCommand(serverEnvironment.upsertKeybinding, {
    reportFailure: false,
  });
  const removeKeybinding = useAtomCommand(serverEnvironment.removeKeybinding, {
    reportFailure: false,
  });
  const representative =
    group.memberProjects.find(
      (member) => member.environmentId === group.environmentId && member.id === group.id,
    ) ?? group.memberProjects[0]!;
  const faviconPath = representative.faviconPath ?? null;
  const [faviconPickerOpen, setFaviconPickerOpen] = useState(false);
  const [selectedCheckoutKey, setSelectedCheckoutKey] = useState(representative.physicalProjectKey);
  const selectedCheckout =
    group.memberProjects.find((member) => member.physicalProjectKey === selectedCheckoutKey) ??
    representative;
  const serverConfig = useAtomValue(
    serverEnvironment.configValueAtom(selectedCheckout.environmentId),
  );
  const keybindings = serverConfig?.keybindings ?? DEFAULT_RESOLVED_KEYBINDINGS;
  const { copyToClipboard: copyPath } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) =>
      toastManager.add({ type: "success", title: "Path copied", description: path }),
  });

  const reportFailure = useCallback((title: string, result: AtomCommandResult<void, unknown>) => {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  }, []);
  const updateAllMembers = useCallback(
    async (
      input: Partial<{
        title: string;
        defaultModelSelection: ModelSelection | null;
        faviconPath: string | null;
      }>,
      failureTitle: string,
    ) => {
      for (const member of group.memberProjects) {
        const result = mapAtomCommandResult(
          await updateProject({
            environmentId: member.environmentId,
            input: { projectId: member.id, ...input },
          }),
          () => undefined,
        );
        if (result._tag === "Failure") {
          reportFailure(failureTitle, result);
          return result;
        }
      }
      return AsyncResult.success(undefined);
    },
    [group.memberProjects, reportFailure, updateProject],
  );

  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
      ),
    [providers, settings],
  );
  const modelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(settings, providers),
    [providers, settings],
  );
  const selectedInstance = representative.defaultModelSelection
    ? instanceEntries.find(
        (entry) =>
          entry.instanceId === representative.defaultModelSelection?.instanceId &&
          entry.enabled &&
          entry.isAvailable,
      )
    : null;
  const fallbackInstance =
    selectedInstance ?? instanceEntries.find((entry) => entry.enabled && entry.isAvailable) ?? null;
  const resolvedSelection =
    selectedInstance && representative.defaultModelSelection
      ? representative.defaultModelSelection
      : fallbackInstance?.models[0]
        ? createModelSelection(fallbackInstance.instanceId, fallbackInstance.models[0].slug)
        : null;

  const persistScripts = useCallback(
    async (
      nextScripts: ReadonlyArray<ProjectScript>,
      keybinding: string | null | undefined,
      command: ReturnType<typeof commandForProjectScript>,
    ) => {
      const previousKey = keybindingValueForCommand(keybindings, command);
      const updateResult = mapAtomCommandResult(
        await updateProject({
          environmentId: selectedCheckout.environmentId,
          input: { projectId: selectedCheckout.id, scripts: nextScripts },
        }),
        () => undefined,
      );
      if (updateResult._tag === "Failure") {
        reportFailure("Failed to save project actions", updateResult);
        return updateResult;
      }
      if (!isElectron) return updateResult;
      const nextRule = decodeProjectScriptKeybindingRule({ keybinding, command });
      const previousRule = previousKey
        ? decodeProjectScriptKeybindingRule({ keybinding: previousKey, command })
        : null;
      const bindingResult = nextRule
        ? await upsertKeybinding({
            environmentId: selectedCheckout.environmentId,
            input:
              previousRule && previousRule.key !== nextRule.key
                ? { ...nextRule, replace: previousRule }
                : nextRule,
          })
        : previousRule
          ? await removeKeybinding({
              environmentId: selectedCheckout.environmentId,
              input: previousRule,
            })
          : null;
      if (bindingResult === null) return updateResult;
      const mapped = mapAtomCommandResult(bindingResult, () => undefined);
      reportFailure("Failed to save project action shortcut", mapped);
      return mapped;
    },
    [
      keybindings,
      removeKeybinding,
      reportFailure,
      selectedCheckout,
      updateProject,
      upsertKeybinding,
    ],
  );
  const addScript = useCallback(
    async (input: NewProjectScriptInput) => {
      const id = nextProjectScriptId(
        input.name,
        selectedCheckout.scripts.map((script) => script.id),
      );
      const script = scriptFromInput(id, input);
      const next = input.runOnWorktreeCreate
        ? [
            ...selectedCheckout.scripts.map((existing) =>
              existing.runOnWorktreeCreate ? { ...existing, runOnWorktreeCreate: false } : existing,
            ),
            script,
          ]
        : [...selectedCheckout.scripts, script];
      return persistScripts(next, input.keybinding, commandForProjectScript(id));
    },
    [persistScripts, selectedCheckout.scripts],
  );
  const updateScript = useCallback(
    async (id: string, input: NewProjectScriptInput) => {
      const updated = scriptFromInput(id, input);
      const next = selectedCheckout.scripts.map((script) =>
        script.id === id
          ? updated
          : input.runOnWorktreeCreate
            ? { ...script, runOnWorktreeCreate: false }
            : script,
      );
      return persistScripts(next, input.keybinding, commandForProjectScript(id));
    },
    [persistScripts, selectedCheckout.scripts],
  );
  const deleteScript = useCallback(
    (id: string) =>
      persistScripts(
        selectedCheckout.scripts.filter((script) => script.id !== id),
        null,
        commandForProjectScript(id),
      ),
    [persistScripts, selectedCheckout.scripts],
  );

  const updateGrouping = useCallback(
    (member: SidebarProjectGroupMember, selection: SidebarProjectGroupingMode | "inherit") => {
      const key = deriveProjectGroupingOverrideKey(member);
      const next = { ...groupingSettings.sidebarProjectGroupingOverrides };
      if (selection === "inherit") delete next[key];
      else next[key] = selection;
      updateClientSettings({ sidebarProjectGroupingOverrides: next });
    },
    [groupingSettings.sidebarProjectGroupingOverrides, updateClientSettings],
  );

  const removeMembers = useCallback(
    async (members: ReadonlyArray<SidebarProjectGroupMember>) => {
      const api = readLocalApi();
      if (!api) return;
      const memberKeys = new Set(members.map(memberKey));
      const projectThreads = threads.filter((thread) =>
        memberKeys.has(`${thread.environmentId}:${thread.projectId}`),
      );
      const wholeGroup = members.length === group.memberProjects.length;
      const confirmed = await settlePromise(() =>
        api.dialogs.confirm(
          [
            `Remove ${wholeGroup ? group.displayName : (members[0]?.title ?? "project")}?`,
            projectThreads.length > 0
              ? `This permanently deletes ${projectThreads.length} thread${projectThreads.length === 1 ? "" : "s"}.`
              : "Files on disk are not touched.",
            "This action cannot be undone.",
          ].join("\n"),
          { variant: "destructive" },
        ),
      );
      if (confirmed._tag === "Failure" || !confirmed.value) return;
      const draftStore = useComposerDraftStore.getState();
      for (const member of members) {
        const memberThreads = projectThreads.filter(
          (thread) =>
            thread.environmentId === member.environmentId && thread.projectId === member.id,
        );
        const result = mapAtomCommandResult(
          await deleteProject({
            environmentId: member.environmentId,
            input: { projectId: member.id, ...(memberThreads.length > 0 ? { force: true } : {}) },
          }),
          () => undefined,
        );
        if (result._tag === "Failure") {
          reportFailure("Failed to remove project", result);
          return;
        }
        draftStore.clearProjectDraftThreadId(scopeProjectRef(member.environmentId, member.id));
      }
      if (wholeGroup) void navigate({ to: "/", replace: true });
    },
    [deleteProject, group, navigate, reportFailure, threads],
  );

  const selectedGrouping =
    groupingSettings.sidebarProjectGroupingOverrides?.[
      deriveProjectGroupingOverrideKey(selectedCheckout)
    ] ?? "inherit";
  const selectedThreadCount = threads.filter(
    (thread) =>
      thread.environmentId === selectedCheckout.environmentId &&
      thread.projectId === selectedCheckout.id,
  ).length;

  return (
    <>
      <SettingsPageContainer>
        <SettingsSection title="Project">
          <SettingsRow
            title="Name"
            description="The shared name shown in the sidebar and thread lists."
            control={
              <Input
                key={`${group.projectKey}:${group.displayName}`}
                className="w-full sm:w-64"
                aria-label="Project name"
                defaultValue={group.displayName}
                onBlur={(event) => {
                  const title = event.currentTarget.value.trim();
                  if (title && title !== group.displayName) {
                    void updateAllMembers({ title }, "Failed to rename project");
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            }
          />
          <SettingsRow
            title="Project icon"
            description={faviconPath ?? "Automatically discovered from the project."}
            resetAction={
              faviconPath ? (
                <SettingResetButton
                  label="project icon"
                  onClick={() =>
                    void updateAllMembers({ faviconPath: null }, "Failed to reset project icon")
                  }
                />
              ) : null
            }
            control={
              <div className="flex items-center gap-2">
                <ProjectFavicon
                  environmentId={representative.environmentId}
                  cwd={representative.workspaceRoot}
                  faviconPath={faviconPath}
                  className="size-6"
                />
                <Button size="xs" variant="outline" onClick={() => setFaviconPickerOpen(true)}>
                  Choose file
                </Button>
              </div>
            }
          />
        </SettingsSection>

        <SettingsSection title="New threads">
          <SettingsRow
            title="Default model"
            description="New threads in every checkout of this project start with this provider and model."
            resetAction={
              representative.defaultModelSelection ? (
                <SettingResetButton
                  label="project default model"
                  onClick={() =>
                    void updateAllMembers(
                      { defaultModelSelection: null },
                      "Failed to reset default model",
                    )
                  }
                />
              ) : null
            }
            control={
              resolvedSelection ? (
                <ProviderModelPicker
                  activeInstanceId={resolvedSelection.instanceId}
                  model={resolvedSelection.model}
                  lockedProvider={null}
                  instanceEntries={instanceEntries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  triggerVariant="outline"
                  triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                  onInstanceModelChange={(instanceId, model) => {
                    void updateAllMembers(
                      { defaultModelSelection: createModelSelection(instanceId, model) },
                      "Failed to update default model",
                    );
                  }}
                />
              ) : (
                <span className="text-sm text-muted-foreground">No providers available</span>
              )
            }
          />
        </SettingsSection>

        <SettingsSection
          title="Checkout"
          headerAction={
            <Select
              value={selectedCheckout.physicalProjectKey}
              onValueChange={(value) => setSelectedCheckoutKey(String(value))}
            >
              <SelectTrigger size="sm" className="max-w-56">
                <SelectValue>{selectedCheckout.environmentLabel ?? "This machine"}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {group.memberProjects.map((member) => (
                  <SelectItem key={member.physicalProjectKey} value={member.physicalProjectKey}>
                    {member.environmentLabel ?? member.workspaceRoot}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        >
          <SettingsRow
            title="Path"
            description={`${selectedThreadCount} thread${selectedThreadCount === 1 ? "" : "s"}`}
            control={
              <Button
                size="xs"
                variant="outline"
                className="max-w-80"
                onClick={() =>
                  copyPath(selectedCheckout.workspaceRoot, { path: selectedCheckout.workspaceRoot })
                }
              >
                <CopyIcon />
                <span className="truncate font-mono">{selectedCheckout.workspaceRoot}</span>
              </Button>
            }
          />
          <SettingsRow
            title="Project grouping"
            description="Controls how this checkout joins related repositories in the sidebar."
            control={
              <Select
                value={selectedGrouping}
                onValueChange={(value) => {
                  if (
                    value === "inherit" ||
                    value === "repository" ||
                    value === "repository_path" ||
                    value === "separate"
                  ) {
                    updateGrouping(selectedCheckout, value);
                  }
                }}
              >
                <SelectTrigger aria-label="Project grouping rule">
                  <SelectValue>
                    {selectedGrouping === "inherit"
                      ? `Default (${PROJECT_GROUPING_MODE_LABELS[groupingSettings.sidebarProjectGroupingMode]})`
                      : PROJECT_GROUPING_MODE_LABELS[selectedGrouping]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="inherit">Use global default</SelectItem>
                  <SelectItem value="repository">
                    {PROJECT_GROUPING_MODE_LABELS.repository}
                  </SelectItem>
                  <SelectItem value="repository_path">
                    {PROJECT_GROUPING_MODE_LABELS.repository_path}
                  </SelectItem>
                  <SelectItem value="separate">{PROJECT_GROUPING_MODE_LABELS.separate}</SelectItem>
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            title="Actions"
            description="Commands saved for this checkout. Edit them here; run them from an active thread."
            control={
              <ProjectScriptsControl
                scripts={selectedCheckout.scripts}
                keybindings={keybindings}
                onRunScript={() =>
                  toastManager.add({ type: "info", title: "Open a thread to run this action" })
                }
                onAddScript={addScript}
                onUpdateScript={updateScript}
                onDeleteScript={deleteScript}
              />
            }
          />
          <SettingsRow
            title="Remove checkout"
            description="Removes this project entry and its conversation history. Files remain on disk."
            control={
              <Button
                variant="destructive-outline"
                size="xs"
                onClick={() => void removeMembers([selectedCheckout])}
              >
                <Trash2Icon /> Remove
              </Button>
            }
          />
        </SettingsSection>

        {group.memberProjects.length > 1 ? (
          <SettingsSection title="Danger">
            <SettingsRow
              title="Remove project everywhere"
              description="Removes every grouped checkout and its conversation history."
              control={
                <Button
                  variant="destructive-outline"
                  onClick={() => void removeMembers(group.memberProjects)}
                >
                  <Trash2Icon /> Remove all entries
                </Button>
              }
            />
          </SettingsSection>
        ) : null}
      </SettingsPageContainer>
      <ProjectFaviconPickerDialog
        open={faviconPickerOpen}
        onOpenChange={setFaviconPickerOpen}
        environmentId={representative.environmentId}
        cwd={representative.workspaceRoot}
        projectName={group.displayName}
        onSelect={(path) =>
          void updateAllMembers({ faviconPath: path }, "Failed to update project icon")
        }
      />
    </>
  );
}
