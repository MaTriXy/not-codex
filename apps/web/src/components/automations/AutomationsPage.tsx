import {
  AutomationId,
  type AutomationDefinition,
  type AutomationDefinitionDraft,
  type AutomationRun,
  type AutomationSchedule,
  type AutomationTerminalCompletion,
  type AutomationTemplate,
} from "@notcodex/contracts";
import { nextAutomationRunAt } from "@notcodex/shared/automationSchedule";
import { useNavigate } from "@tanstack/react-router";
import * as DateTime from "effect/DateTime";
import {
  ArrowRightIcon,
  BellRingIcon,
  BotIcon,
  CalendarClockIcon,
  CircleStopIcon,
  Clock3Icon,
  GitBranchIcon,
  HistoryIcon,
  LoaderCircleIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Trash2Icon,
  WorkflowIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { useAtomCommand } from "../../state/use-atom-command";
import { automationEnvironment } from "../../state/automations";
import { useActiveEnvironmentId, useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

const WEEKDAYS = [
  { key: "mon", value: 1, label: "M" },
  { key: "tue", value: 2, label: "T" },
  { key: "wed", value: 3, label: "W" },
  { key: "thu", value: 4, label: "T" },
  { key: "fri", value: 5, label: "F" },
  { key: "sat", value: 6, label: "S" },
  { key: "sun", value: 0, label: "S" },
] as const;

const TERMINAL_STATUSES = new Set<AutomationRun["status"]>([
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
]);

export interface EditorState {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly enabled: boolean;
  readonly scheduleType: AutomationSchedule["type"];
  readonly intervalMinutes: number;
  readonly runAt: string;
  readonly localTime: string;
  readonly weekdays: ReadonlyArray<number>;
  readonly timeZone: string;
  readonly worktreeMode: "isolated" | "project-root";
  readonly runtimeMode: "approval-required" | "auto-accept-edits" | "full-access";
  readonly approvalHandling: "pause" | "fail";
  readonly maxDurationMinutes: number;
  readonly baseBranch: string;
  readonly cleanupOnSuccess: boolean;
  readonly completionType:
    | "turn-completed"
    | "goal-signal"
    | "checks-pass"
    | "follow-until-complete";
  readonly followUntilType: "turn-completed" | "goal-signal" | "checks-pass";
  readonly goalMarker: string;
  readonly checkScriptIds: ReadonlyArray<string>;
  readonly maxTurns: number;
  readonly followUpPrompt: string;
  readonly retryAttempts: number;
  readonly publishType: "never" | "branch" | "draft-pr" | "ready-pr";
  readonly titleTemplate: string;
  readonly readyPrConfirmed: boolean;
  readonly notifyStarted: boolean;
  readonly notifyWaiting: boolean;
  readonly notifySucceeded: boolean;
  readonly notifyFailed: boolean;
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function emptyAutomationEditor(projectId = ""): EditorState {
  return {
    id: "",
    projectId,
    name: "",
    description: "",
    prompt: "",
    enabled: true,
    scheduleType: "manual",
    intervalMinutes: 60,
    runAt: "",
    localTime: "09:00",
    weekdays: [1, 2, 3, 4, 5],
    timeZone: browserTimeZone(),
    worktreeMode: "isolated",
    runtimeMode: "approval-required",
    approvalHandling: "pause",
    maxDurationMinutes: 60,
    baseBranch: "",
    cleanupOnSuccess: false,
    completionType: "turn-completed",
    followUntilType: "turn-completed",
    goalMarker: "AUTOMATION_COMPLETE",
    checkScriptIds: [],
    maxTurns: 5,
    followUpPrompt:
      "Review the result against the original task. Continue fixing and verifying until it is genuinely complete.",
    retryAttempts: 2,
    publishType: "never",
    titleTemplate: "",
    readyPrConfirmed: false,
    notifyStarted: false,
    notifyWaiting: true,
    notifySucceeded: true,
    notifyFailed: true,
  };
}

export function automationEditorFromDefinition(definition: AutomationDefinition): EditorState {
  const schedule = definition.schedule;
  const completion = definition.completion;
  const terminal = completion.type === "follow-until-complete" ? completion.until : completion;
  return {
    ...emptyAutomationEditor(definition.projectId),
    id: definition.id,
    name: definition.name,
    description: definition.description ?? "",
    prompt: definition.prompt,
    enabled: definition.enabled,
    scheduleType: schedule.type,
    intervalMinutes: schedule.type === "interval" ? schedule.everyMinutes : 60,
    runAt: schedule.type === "once" ? schedule.runAt.slice(0, 16) : "",
    localTime: schedule.type === "calendar" ? schedule.localTime : "09:00",
    weekdays: schedule.type === "calendar" ? schedule.weekdays : [1, 2, 3, 4, 5],
    timeZone: schedule.type === "calendar" ? schedule.timeZone : browserTimeZone(),
    worktreeMode: definition.execution.worktreeMode,
    runtimeMode: definition.runtimeMode,
    approvalHandling: definition.execution.approvalHandling,
    maxDurationMinutes: definition.execution.maxDurationMinutes,
    baseBranch: definition.execution.baseBranch ?? "",
    cleanupOnSuccess: definition.execution.cleanupOnSuccess,
    completionType: completion.type,
    followUntilType: terminal.type,
    goalMarker: terminal.type === "goal-signal" ? terminal.marker : "AUTOMATION_COMPLETE",
    checkScriptIds: terminal.type === "checks-pass" ? terminal.scriptIds : [],
    maxTurns: completion.type === "follow-until-complete" ? completion.maxTurns : 5,
    followUpPrompt:
      completion.type === "follow-until-complete"
        ? completion.followUpPrompt
        : emptyAutomationEditor().followUpPrompt,
    retryAttempts: definition.retry.maxAttempts,
    publishType: definition.publish.type,
    titleTemplate:
      definition.publish.type === "draft-pr" || definition.publish.type === "ready-pr"
        ? (definition.publish.titleTemplate ?? "")
        : "",
    readyPrConfirmed: definition.publish.type === "ready-pr",
    notifyStarted: definition.notifications.onStarted,
    notifyWaiting: definition.notifications.onWaiting,
    notifySucceeded: definition.notifications.onSucceeded,
    notifyFailed: definition.notifications.onFailed,
  };
}

function fromTemplate(template: AutomationTemplate, projectId: string): EditorState {
  const editor = emptyAutomationEditor(projectId);
  const terminal =
    template.completion.type === "follow-until-complete"
      ? template.completion.until
      : template.completion;
  return {
    ...editor,
    name: template.name,
    description: template.description,
    prompt: template.prompt,
    scheduleType: template.schedule.type,
    intervalMinutes: template.schedule.type === "interval" ? template.schedule.everyMinutes : 60,
    runAt: template.schedule.type === "once" ? template.schedule.runAt.slice(0, 16) : "",
    localTime: template.schedule.type === "calendar" ? template.schedule.localTime : "09:00",
    weekdays: template.schedule.type === "calendar" ? template.schedule.weekdays : editor.weekdays,
    timeZone: template.schedule.type === "calendar" ? template.schedule.timeZone : editor.timeZone,
    worktreeMode: template.execution.worktreeMode,
    approvalHandling: template.execution.approvalHandling,
    maxDurationMinutes: template.execution.maxDurationMinutes,
    baseBranch: template.execution.baseBranch ?? "",
    cleanupOnSuccess: template.execution.cleanupOnSuccess,
    completionType: template.completion.type,
    followUntilType: terminal.type,
    goalMarker: terminal.type === "goal-signal" ? terminal.marker : editor.goalMarker,
    checkScriptIds: terminal.type === "checks-pass" ? terminal.scriptIds : [],
    maxTurns:
      template.completion.type === "follow-until-complete"
        ? template.completion.maxTurns
        : editor.maxTurns,
    followUpPrompt:
      template.completion.type === "follow-until-complete"
        ? template.completion.followUpPrompt
        : editor.followUpPrompt,
    retryAttempts: template.retry.maxAttempts,
    publishType: template.publish.type,
    titleTemplate:
      template.publish.type === "draft-pr" || template.publish.type === "ready-pr"
        ? (template.publish.titleTemplate ?? "")
        : "",
    readyPrConfirmed: template.publish.type === "ready-pr",
    notifyStarted: template.notifications.onStarted,
    notifyWaiting: template.notifications.onWaiting,
    notifySucceeded: template.notifications.onSucceeded,
    notifyFailed: template.notifications.onFailed,
  };
}

export function automationScheduleFromEditor(editor: EditorState): AutomationSchedule {
  switch (editor.scheduleType) {
    case "manual":
      return { type: "manual" };
    case "once":
      return { type: "once", runAt: new globalThis.Date(editor.runAt).toISOString() };
    case "interval":
      return {
        type: "interval",
        everyMinutes: Math.max(1, editor.intervalMinutes),
        anchorAt: new globalThis.Date().toISOString(),
      };
    case "calendar":
      return {
        type: "calendar",
        timeZone: editor.timeZone,
        localTime: editor.localTime,
        weekdays: editor.weekdays,
      };
  }
}

export function automationSchedulePreview(editor: EditorState): ReadonlyArray<string> {
  if (editor.scheduleType === "manual") return [];
  try {
    const schedule = automationScheduleFromEditor(editor);
    const values: Array<string> = [];
    let cursor = DateTime.makeUnsafe(new globalThis.Date());
    for (let index = 0; index < 3; index += 1) {
      const next = nextAutomationRunAt(schedule, cursor);
      if (next === null) break;
      values.push(next);
      cursor = DateTime.makeUnsafe(next);
    }
    return values;
  } catch {
    return [];
  }
}

export function automationCompletionFromEditor(
  editor: EditorState,
): AutomationDefinitionDraft["completion"] {
  const terminalType =
    editor.completionType === "follow-until-complete"
      ? editor.followUntilType
      : editor.completionType;
  const terminalCompletion: AutomationTerminalCompletion =
    terminalType === "goal-signal"
      ? { type: "goal-signal", marker: editor.goalMarker.trim() }
      : terminalType === "checks-pass"
        ? { type: "checks-pass", scriptIds: editor.checkScriptIds }
        : { type: "turn-completed" };
  return editor.completionType === "follow-until-complete"
    ? {
        type: "follow-until-complete",
        until: terminalCompletion,
        maxTurns: Math.max(1, editor.maxTurns),
        maxDurationMinutes: Math.max(1, editor.maxDurationMinutes),
        followUpPrompt: editor.followUpPrompt.trim(),
      }
    : terminalCompletion;
}

export function automationPublishFromEditor(
  editor: EditorState,
): AutomationDefinitionDraft["publish"] {
  const titleTemplate = editor.titleTemplate.trim() || null;
  switch (editor.publishType) {
    case "ready-pr":
      return { type: "ready-pr", titleTemplate, confirmed: true };
    case "draft-pr":
      return { type: "draft-pr", titleTemplate };
    case "branch":
      return { type: "branch" };
    case "never":
      return { type: "never" };
  }
}

function CheckboxRow({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/70 p-3 hover:bg-muted/40">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="mt-0.5 size-4 accent-primary"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{children}</label>
  );
}

function NativeSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
    >
      {children}
    </select>
  );
}

function statusTone(status: AutomationRun["status"]): string {
  if (status === "succeeded")
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "failed" || status === "cancelled")
    return "border-destructive/30 bg-destructive/10 text-destructive";
  if (status.startsWith("waiting"))
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
}

function scheduleLabel(schedule: AutomationSchedule): string {
  switch (schedule.type) {
    case "manual":
      return "Manual";
    case "once":
      return `Once · ${schedule.runAt.replace("T", " ").slice(0, 16)} UTC`;
    case "interval":
      return `Every ${schedule.everyMinutes} min`;
    case "calendar":
      return `${schedule.localTime} · ${schedule.timeZone}`;
  }
}

function DefinitionEditor({
  editor,
  isExisting,
  projects,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  editor: EditorState;
  isExisting: boolean;
  projects: ReturnType<typeof useProjects>;
  saving: boolean;
  onChange: (next: EditorState) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const update = <K extends keyof EditorState>(key: K, value: EditorState[K]) =>
    onChange({ ...editor, [key]: value });
  const selectedProject = projects.find((project) => project.id === editor.projectId);
  const terminalType =
    editor.completionType === "follow-until-complete"
      ? editor.followUntilType
      : editor.completionType;
  const upcomingRuns = useMemo(
    () => automationSchedulePreview(editor),
    [
      editor.intervalMinutes,
      editor.localTime,
      editor.runAt,
      editor.scheduleType,
      editor.timeZone,
      editor.weekdays,
    ],
  );
  const valid =
    editor.name.trim().length > 0 &&
    editor.prompt.trim().length > 0 &&
    selectedProject?.defaultModelSelection != null &&
    (editor.scheduleType !== "once" || editor.runAt.length > 0) &&
    (editor.scheduleType !== "calendar" || editor.weekdays.length > 0) &&
    (terminalType !== "goal-signal" || editor.goalMarker.trim().length > 0) &&
    (terminalType !== "checks-pass" || editor.checkScriptIds.length > 0) &&
    (editor.completionType !== "follow-until-complete" ||
      editor.followUpPrompt.trim().length > 0) &&
    (editor.publishType !== "ready-pr" || editor.readyPrConfirmed);

  return (
    <div className="min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 px-5 py-6 sm:px-8">
        <div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">
                {isExisting ? "Edit automation" : "New automation"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Every run becomes a normal Not Codex thread with durable history and a clear
                handoff.
              </p>
            </div>
            <CheckboxRow
              checked={editor.enabled}
              label="Enabled"
              onChange={(checked) => update("enabled", checked)}
            />
          </div>
        </div>

        <section className="space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <BotIcon className="size-4" /> Task
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Name</FieldLabel>
              <Input
                value={editor.name}
                onChange={(event) => update("name", event.currentTarget.value)}
                placeholder="Dependency health check"
              />
            </div>
            <div>
              <FieldLabel>Project</FieldLabel>
              <NativeSelect
                value={editor.projectId}
                onChange={(value) => update("projectId", value)}
              >
                <option value="">Choose a project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div>
            <FieldLabel>Description</FieldLabel>
            <Input
              value={editor.description}
              onChange={(event) => update("description", event.currentTarget.value)}
              placeholder="What this automation owns"
            />
          </div>
          <div>
            <FieldLabel>Agent prompt</FieldLabel>
            <Textarea
              className="min-h-40"
              value={editor.prompt}
              onChange={(event) => update("prompt", event.currentTarget.value)}
              placeholder="Describe the outcome, constraints, checks, and definition of done…"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Provider:{" "}
              {selectedProject?.defaultModelSelection
                ? `${selectedProject.defaultModelSelection.instanceId} · ${selectedProject.defaultModelSelection.model}`
                : "Configure a default provider on this project first."}
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClockIcon className="size-4" /> Schedule
          </h3>
          <div>
            <FieldLabel>Run cadence</FieldLabel>
            <NativeSelect
              value={editor.scheduleType}
              onChange={(value) => update("scheduleType", value as EditorState["scheduleType"])}
            >
              <option value="manual">Manual only</option>
              <option value="once">One time</option>
              <option value="interval">Recurring interval</option>
              <option value="calendar">Weekly calendar</option>
            </NativeSelect>
          </div>
          {editor.scheduleType === "once" ? (
            <div>
              <FieldLabel>Run at</FieldLabel>
              <Input
                type="datetime-local"
                value={editor.runAt}
                onChange={(event) => update("runAt", event.currentTarget.value)}
              />
            </div>
          ) : null}
          {editor.scheduleType === "interval" ? (
            <div>
              <FieldLabel>Every (minutes)</FieldLabel>
              <Input
                type="number"
                min={1}
                value={editor.intervalMinutes}
                onChange={(event) => update("intervalMinutes", Number(event.currentTarget.value))}
              />
            </div>
          ) : null}
          {editor.scheduleType === "calendar" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel>Local time</FieldLabel>
                <Input
                  type="time"
                  value={editor.localTime}
                  onChange={(event) => update("localTime", event.currentTarget.value)}
                />
              </div>
              <div>
                <FieldLabel>IANA time zone</FieldLabel>
                <Input
                  value={editor.timeZone}
                  onChange={(event) => update("timeZone", event.currentTarget.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel>Days</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((day) => {
                    const active = editor.weekdays.includes(day.value);
                    return (
                      <button
                        key={day.key}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          update(
                            "weekdays",
                            active
                              ? editor.weekdays.filter((value) => value !== day.value)
                              : [...editor.weekdays, day.value],
                          )
                        }
                        className={
                          active
                            ? "size-9 rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                            : "size-9 rounded-full border border-border text-xs font-semibold text-muted-foreground hover:bg-muted"
                        }
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
          {editor.scheduleType !== "manual" ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium">Upcoming runs</p>
              {upcomingRuns.length > 0 ? (
                <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {upcomingRuns.map((value) => (
                    <li key={value}>{value.replace("T", " ").slice(0, 16)} UTC</li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                  Complete the schedule fields to preview upcoming runs.
                </p>
              )}
            </div>
          ) : null}
        </section>

        <section className="space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <GitBranchIcon className="size-4" /> Execution & safety
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Workspace</FieldLabel>
              <NativeSelect
                value={editor.worktreeMode}
                onChange={(value) => update("worktreeMode", value as EditorState["worktreeMode"])}
              >
                <option value="isolated">Isolated worktree</option>
                <option value="project-root">Project root</option>
              </NativeSelect>
            </div>
            <div>
              <FieldLabel>Agent permissions</FieldLabel>
              <NativeSelect
                value={editor.runtimeMode}
                onChange={(value) => update("runtimeMode", value as EditorState["runtimeMode"])}
              >
                <option value="approval-required">Ask for approvals</option>
                <option value="auto-accept-edits">Auto-accept edits</option>
                <option value="full-access">Full access</option>
              </NativeSelect>
            </div>
            <div>
              <FieldLabel>Approval requests</FieldLabel>
              <NativeSelect
                value={editor.approvalHandling}
                onChange={(value) =>
                  update("approvalHandling", value as EditorState["approvalHandling"])
                }
              >
                <option value="pause">Pause and notify</option>
                <option value="fail">Fail the run</option>
              </NativeSelect>
            </div>
            <div>
              <FieldLabel>Maximum duration (minutes)</FieldLabel>
              <Input
                type="number"
                min={1}
                value={editor.maxDurationMinutes}
                onChange={(event) =>
                  update("maxDurationMinutes", Number(event.currentTarget.value))
                }
              />
            </div>
            <div>
              <FieldLabel>Base branch (optional)</FieldLabel>
              <Input
                value={editor.baseBranch}
                onChange={(event) => update("baseBranch", event.currentTarget.value)}
                placeholder="main"
              />
            </div>
          </div>
          <CheckboxRow
            checked={editor.cleanupOnSuccess}
            label="Clean up isolated worktree after success"
            description="The thread and run history remain available."
            onChange={(checked) => update("cleanupOnSuccess", checked)}
          />
          {editor.worktreeMode === "project-root" ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              Project-root runs can modify your active checkout. Isolated worktrees are safer and
              remain the recommended default.
            </p>
          ) : null}
          {editor.runtimeMode === "full-access" ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              Full access allows the selected agent to run commands and modify files without the
              usual edit boundary. Use it only for trusted prompts and repositories you can recover.
            </p>
          ) : null}
        </section>

        <section className="space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheckIcon className="size-4" /> Completion
          </h3>
          <div>
            <FieldLabel>Definition of done</FieldLabel>
            <NativeSelect
              value={editor.completionType}
              onChange={(value) => update("completionType", value as EditorState["completionType"])}
            >
              <option value="turn-completed">First turn completes</option>
              <option value="goal-signal">Assistant returns a marker</option>
              <option value="checks-pass">Project checks pass</option>
              <option value="follow-until-complete">Follow until complete</option>
            </NativeSelect>
          </div>
          {editor.completionType === "follow-until-complete" ? (
            <div className="space-y-4">
              <div>
                <FieldLabel>Continue until</FieldLabel>
                <NativeSelect
                  value={editor.followUntilType}
                  onChange={(value) =>
                    update("followUntilType", value as EditorState["followUntilType"])
                  }
                >
                  <option value="turn-completed">A turn completes</option>
                  <option value="goal-signal">Assistant returns a marker</option>
                  <option value="checks-pass">Project checks pass</option>
                </NativeSelect>
              </div>
              <div>
                <FieldLabel>Maximum turns</FieldLabel>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={editor.maxTurns}
                  onChange={(event) => update("maxTurns", Number(event.currentTarget.value))}
                />
              </div>
              <div>
                <FieldLabel>Follow-up prompt</FieldLabel>
                <Textarea
                  value={editor.followUpPrompt}
                  onChange={(event) => update("followUpPrompt", event.currentTarget.value)}
                />
              </div>
            </div>
          ) : null}
          {terminalType === "goal-signal" ? (
            <div>
              <FieldLabel>Completion marker</FieldLabel>
              <Input
                value={editor.goalMarker}
                onChange={(event) => update("goalMarker", event.currentTarget.value)}
              />
            </div>
          ) : null}
          {terminalType === "checks-pass" ? (
            <div>
              <FieldLabel>Required project checks</FieldLabel>
              {selectedProject?.scripts.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {selectedProject.scripts.map((script) => (
                    <CheckboxRow
                      key={script.id}
                      checked={editor.checkScriptIds.includes(script.id)}
                      label={script.name}
                      description={script.command}
                      onChange={(checked) =>
                        update(
                          "checkScriptIds",
                          checked
                            ? [...editor.checkScriptIds, script.id]
                            : editor.checkScriptIds.filter((id) => id !== script.id),
                        )
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                  Add project scripts before using check-based completion.
                </p>
              )}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Maximum attempts</FieldLabel>
              <Input
                type="number"
                min={1}
                max={10}
                value={editor.retryAttempts}
                onChange={(event) => update("retryAttempts", Number(event.currentTarget.value))}
              />
            </div>
            <div>
              <FieldLabel>Publish result</FieldLabel>
              <NativeSelect
                value={editor.publishType}
                onChange={(value) => update("publishType", value as EditorState["publishType"])}
              >
                <option value="never">Keep local</option>
                <option value="branch">Push branch</option>
                <option value="draft-pr">Open draft PR</option>
                <option value="ready-pr">Open ready PR</option>
              </NativeSelect>
            </div>
          </div>
          {editor.publishType === "draft-pr" || editor.publishType === "ready-pr" ? (
            <div>
              <FieldLabel>PR title template (optional)</FieldLabel>
              <Input
                value={editor.titleTemplate}
                onChange={(event) => update("titleTemplate", event.currentTarget.value)}
                placeholder="{name} · automation {runId}"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Supports {"{name}"} and {"{runId}"}.
              </p>
            </div>
          ) : null}
          {editor.publishType === "ready-pr" ? (
            <CheckboxRow
              checked={editor.readyPrConfirmed}
              label="I confirm this automation may publish a ready-for-review PR"
              description="This is deliberately explicit because it changes external state."
              onChange={(checked) => update("readyPrConfirmed", checked)}
            />
          ) : null}
        </section>

        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <SparklesIcon className="size-4" /> Notifications
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <CheckboxRow
              checked={editor.notifyStarted}
              label="Run started"
              onChange={(checked) => update("notifyStarted", checked)}
            />
            <CheckboxRow
              checked={editor.notifyWaiting}
              label="Needs attention"
              onChange={(checked) => update("notifyWaiting", checked)}
            />
            <CheckboxRow
              checked={editor.notifySucceeded}
              label="Succeeded"
              onChange={(checked) => update("notifySucceeded", checked)}
            />
            <CheckboxRow
              checked={editor.notifyFailed}
              label="Failed"
              onChange={(checked) => update("notifyFailed", checked)}
            />
          </div>
        </section>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background/95 py-4 backdrop-blur">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!valid || saving} onClick={onSave}>
            {saving ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
            {isExisting ? "Save changes" : "Create automation"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AutomationsPage() {
  const navigate = useNavigate();
  const environmentId = useActiveEnvironmentId();
  const allProjects = useProjects();
  const projects = useMemo(
    () => allProjects.filter((project) => project.environmentId === environmentId),
    [allProjects, environmentId],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scheduleFilter, setScheduleFilter] = useState("all");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<AutomationRun["id"] | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));

  const definitionsQuery = useEnvironmentQuery(
    environmentId
      ? automationEnvironment.definitions({ environmentId, input: { includeDisabled: true } })
      : null,
  );
  const runsQuery = useEnvironmentQuery(
    environmentId ? automationEnvironment.runs({ environmentId, input: { limit: 100 } }) : null,
  );
  const templatesQuery = useEnvironmentQuery(
    environmentId ? automationEnvironment.templates({ environmentId, input: {} }) : null,
  );
  const runDetailQuery = useEnvironmentQuery(
    environmentId && expandedRunId
      ? automationEnvironment.run({ environmentId, input: { runId: expandedRunId } })
      : null,
  );
  const createDefinition = useAtomCommand(automationEnvironment.create, { reportFailure: false });
  const updateDefinition = useAtomCommand(automationEnvironment.update, { reportFailure: false });
  const deleteDefinition = useAtomCommand(automationEnvironment.remove, { reportFailure: false });
  const runNow = useAtomCommand(automationEnvironment.runNow, { reportFailure: false });
  const cancelRun = useAtomCommand(automationEnvironment.cancelRun, { reportFailure: false });
  const retryRun = useAtomCommand(automationEnvironment.retryRun, { reportFailure: false });

  const definitions = definitionsQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const visibleDefinitions = useMemo(
    () =>
      definitions.filter(
        (definition) =>
          (projectFilter === "all" || definition.projectId === projectFilter) &&
          (statusFilter === "all" ||
            (statusFilter === "enabled" ? definition.enabled : !definition.enabled)) &&
          (scheduleFilter === "all" || definition.schedule.type === scheduleFilter),
      ),
    [definitions, projectFilter, scheduleFilter, statusFilter],
  );
  const selected =
    visibleDefinitions.find((definition) => definition.id === selectedId) ??
    visibleDefinitions[0] ??
    null;
  const selectedRuns = selected ? runs.filter((run) => run.automationId === selected.id) : runs;

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  useEffect(() => {
    if (expandedRunId && !selectedRuns.some((run) => run.id === expandedRunId)) {
      setExpandedRunId(null);
    }
  }, [expandedRunId, selectedRuns]);

  if (environmentId === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        Connect an environment to use Automations.
      </div>
    );
  }

  const startCreate = (template?: AutomationTemplate) => {
    const projectId = selected?.projectId ?? projects[0]?.id ?? "";
    setEditor(template ? fromTemplate(template, projectId) : emptyAutomationEditor(projectId));
    setMessage(null);
  };

  const save = async () => {
    if (!editor || !environmentId) return;
    const project = projects.find((candidate) => candidate.id === editor.projectId);
    if (!project?.defaultModelSelection) return;
    setSaving(true);
    setMessage(null);
    const completion = automationCompletionFromEditor(editor);
    const publish = automationPublishFromEditor(editor);
    const draft: AutomationDefinitionDraft = {
      projectId: project.id,
      name: editor.name.trim(),
      description: editor.description.trim() || null,
      enabled: editor.enabled,
      prompt: editor.prompt.trim(),
      modelSelection: project.defaultModelSelection,
      runtimeMode: editor.runtimeMode,
      schedule: automationScheduleFromEditor(editor),
      execution: {
        worktreeMode: editor.worktreeMode,
        approvalHandling: editor.approvalHandling,
        maxDurationMinutes: Math.max(1, editor.maxDurationMinutes),
        baseBranch: editor.baseBranch.trim() || null,
        cleanupOnSuccess: editor.cleanupOnSuccess,
      },
      completion,
      retry: {
        maxAttempts: Math.max(1, editor.retryAttempts),
        initialDelaySeconds: 30,
        maxDelaySeconds: 900,
      },
      publish,
      notifications: {
        onStarted: editor.notifyStarted,
        onWaiting: editor.notifyWaiting,
        onSucceeded: editor.notifySucceeded,
        onFailed: editor.notifyFailed,
      },
    };
    const existing = definitions.some((definition) => definition.id === editor.id);
    const result = existing
      ? await updateDefinition({
          environmentId,
          input: { id: AutomationId.make(editor.id), patch: draft },
        })
      : await createDefinition({ environmentId, input: draft });
    setSaving(false);
    if (result._tag === "Failure") {
      setMessage("Could not save this automation. Review the fields and try again.");
      return;
    }
    setSelectedId(result.value.id);
    setEditor(null);
    setMessage(existing ? "Automation updated." : "Automation created.");
    definitionsQuery.refresh();
  };

  const runAction = async (action: "run" | "delete" | "toggle") => {
    if (!selected || !environmentId) return;
    setMessage(null);
    if (action === "delete") {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        `Delete automation “${selected.name}”? Its run history remains auditable.`,
        { variant: "destructive" },
      );
      if (!confirmed) return;
      const result = await deleteDefinition({ environmentId, input: { id: selected.id } });
      if (result._tag === "Failure") setMessage("Could not delete the automation.");
      else {
        setSelectedId(null);
        definitionsQuery.refresh();
      }
      return;
    }
    if (action === "toggle") {
      const result = await updateDefinition({
        environmentId,
        input: { id: selected.id, patch: { enabled: !selected.enabled } },
      });
      if (result._tag === "Failure") setMessage("Could not update the automation.");
      else definitionsQuery.refresh();
      return;
    }
    const result = await runNow({ environmentId, input: { id: selected.id } });
    if (result._tag === "Failure") setMessage("Could not queue the automation run.");
    else {
      setMessage("Run queued.");
      runsQuery.refresh();
    }
  };

  const enableSystemNotifications = async () => {
    if (typeof Notification === "undefined") return;
    setNotificationPermission(await Notification.requestPermission());
  };

  if (editor) {
    return (
      <DefinitionEditor
        editor={editor}
        isExisting={definitions.some((definition) => definition.id === editor.id)}
        projects={projects}
        saving={saving}
        onChange={setEditor}
        onCancel={() => setEditor(null)}
        onSave={() => void save()}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex min-h-14 items-center gap-3 border-b border-border px-5 sm:px-7">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <WorkflowIcon className="size-4.5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold">Automations</h1>
          <p className="text-xs text-muted-foreground">
            Let coding agents keep working while you focus elsewhere.
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          {notificationPermission === "default" ? (
            <Button size="sm" variant="outline" onClick={() => void enableSystemNotifications()}>
              <BellRingIcon className="size-4" /> Enable alerts
            </Button>
          ) : null}
          <Button size="sm" onClick={() => startCreate()}>
            <PlusIcon className="size-4" /> New automation
          </Button>
        </div>
      </header>

      {message ? (
        <div className="border-b border-border bg-muted/40 px-5 py-2 text-xs text-muted-foreground sm:px-7">
          {message}
        </div>
      ) : null}
      {definitionsQuery.error ? (
        <div className="border-b border-destructive/20 bg-destructive/5 px-5 py-2 text-xs text-destructive sm:px-7">
          {definitionsQuery.error}
        </div>
      ) : null}

      {definitions.length === 0 && !definitionsQuery.isPending ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
            <div className="max-w-2xl">
              <Badge variant="outline" className="mb-4">
                <SparklesIcon className="size-3" /> Local-first agent workflows
              </Badge>
              <h2 className="text-3xl font-semibold tracking-tight">
                Turn recurring engineering work into reliable runs.
              </h2>
              <p className="mt-3 text-base leading-7 text-muted-foreground">
                Automations use your configured coding-agent providers, your local repository, and
                ordinary Not Codex threads. Nothing becomes a hidden black box.
              </p>
            </div>
            <div className="mt-10 grid gap-3 md:grid-cols-2">
              {(templatesQuery.data ?? []).map((template) => (
                <button
                  type="button"
                  key={template.id}
                  onClick={() => startCreate(template)}
                  className="group rounded-xl border border-border bg-card p-5 text-left transition hover:border-primary/40 hover:shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <SparklesIcon className="size-4" />
                    </div>
                    <div>
                      <h3 className="font-medium">{template.name}</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {template.description}
                      </p>
                      <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary">
                        Use template{" "}
                        <ArrowRightIcon className="size-3 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-r border-border bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="text-xs font-medium text-muted-foreground">Workflows</span>
              <span className="text-[11px] text-muted-foreground">
                {visibleDefinitions.length}/{definitions.length}
              </span>
            </div>
            <div className="mb-3 space-y-2 px-1">
              <NativeSelect value={projectFilter} onChange={setProjectFilter}>
                <option value="all">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </NativeSelect>
              <div className="grid grid-cols-2 gap-2">
                <NativeSelect value={statusFilter} onChange={setStatusFilter}>
                  <option value="all">Any status</option>
                  <option value="enabled">Enabled</option>
                  <option value="paused">Paused</option>
                </NativeSelect>
                <NativeSelect value={scheduleFilter} onChange={setScheduleFilter}>
                  <option value="all">Any schedule</option>
                  <option value="manual">Manual</option>
                  <option value="once">One time</option>
                  <option value="interval">Interval</option>
                  <option value="calendar">Calendar</option>
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-1">
              {visibleDefinitions.map((definition) => (
                <button
                  type="button"
                  key={definition.id}
                  onClick={() => setSelectedId(definition.id)}
                  className={
                    definition.id === selected?.id
                      ? "w-full rounded-lg border border-border bg-background p-3 text-left shadow-xs"
                      : "w-full rounded-lg border border-transparent p-3 text-left hover:bg-background/70"
                  }
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        definition.enabled
                          ? "size-2 rounded-full bg-emerald-500"
                          : "size-2 rounded-full bg-muted-foreground/30"
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {definition.name}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Clock3Icon className="size-3" /> {scheduleLabel(definition.schedule)}
                  </div>
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {definition.modelSelection.model}
                    {definition.nextRunAt
                      ? ` · next ${definition.nextRunAt.replace("T", " ").slice(0, 16)} UTC`
                      : ""}
                  </div>
                </button>
              ))}
              {visibleDefinitions.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No automations match these filters.
                </p>
              ) : null}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto">
            {selected ? (
              <div className="mx-auto max-w-4xl space-y-8 px-5 py-7 sm:px-8">
                <section>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-semibold">{selected.name}</h2>
                        <Badge
                          variant="outline"
                          className={
                            selected.enabled
                              ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                              : ""
                          }
                        >
                          {selected.enabled ? "Enabled" : "Paused"}
                        </Badge>
                      </div>
                      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                        {selected.description || "No description yet."}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setEditor({
                            ...automationEditorFromDefinition(selected),
                            id: "",
                            name: `${selected.name} copy`,
                            enabled: false,
                          })
                        }
                      >
                        Duplicate
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditor(automationEditorFromDefinition(selected))}
                      >
                        Edit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void runAction("toggle")}>
                        {selected.enabled ? "Pause" : "Enable"}
                      </Button>
                      <Button size="sm" onClick={() => void runAction("run")}>
                        <PlayIcon className="size-4" /> Run now
                      </Button>
                    </div>
                  </div>
                  <div className="mt-6 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-border p-4">
                      <Clock3Icon className="size-4 text-muted-foreground" />
                      <p className="mt-3 text-xs text-muted-foreground">Schedule</p>
                      <p className="mt-1 text-sm font-medium">{scheduleLabel(selected.schedule)}</p>
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <GitBranchIcon className="size-4 text-muted-foreground" />
                      <p className="mt-3 text-xs text-muted-foreground">Workspace</p>
                      <p className="mt-1 text-sm font-medium">
                        {selected.execution.worktreeMode === "isolated"
                          ? "Isolated worktree"
                          : "Project root"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <ShieldCheckIcon className="size-4 text-muted-foreground" />
                      <p className="mt-3 text-xs text-muted-foreground">Publish</p>
                      <p className="mt-1 text-sm font-medium">
                        {selected.publish.type.replaceAll("-", " ")}
                      </p>
                    </div>
                  </div>
                </section>

                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <HistoryIcon className="size-4" /> Run history
                    </h3>
                    <Button size="xs" variant="ghost" onClick={runsQuery.refresh}>
                      <RotateCcwIcon className="size-3.5" /> Refresh
                    </Button>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border">
                    {selectedRuns.length === 0 ? (
                      <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                        No runs yet. Queue the first one when you’re ready.
                      </div>
                    ) : (
                      selectedRuns.map((run, index) => {
                        const expanded = expandedRunId === run.id;
                        const detail = expanded ? runDetailQuery.data : null;
                        return (
                          <div
                            key={run.id}
                            className={index === 0 ? "p-4" : "border-t border-border p-4"}
                          >
                            <div className="flex flex-wrap items-center gap-3">
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone(run.status)}`}
                              >
                                {run.status.replaceAll("-", " ")}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Attempt {run.attempt} · {run.trigger}
                              </span>
                              <span className="ms-auto text-xs text-muted-foreground">
                                {run.createdAt.replace("T", " ").slice(0, 16)} UTC
                              </span>
                            </div>
                            {run.errorMessage ? (
                              <p className="mt-2 text-xs text-destructive">{run.errorMessage}</p>
                            ) : null}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => setExpandedRunId(expanded ? null : run.id)}
                              >
                                <HistoryIcon className="size-3" />{" "}
                                {expanded ? "Hide timeline" : "Timeline"}
                              </Button>
                              {run.threadId ? (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() =>
                                    void navigate({
                                      to: "/$environmentId/$threadId",
                                      params: { environmentId, threadId: run.threadId! },
                                    })
                                  }
                                >
                                  Open thread <ArrowRightIcon className="size-3" />
                                </Button>
                              ) : null}
                              {run.pullRequestUrl ? (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() =>
                                    window.open(
                                      run.pullRequestUrl!,
                                      "_blank",
                                      "noopener,noreferrer",
                                    )
                                  }
                                >
                                  Open PR <GitBranchIcon className="size-3" />
                                </Button>
                              ) : null}
                              {!TERMINAL_STATUSES.has(run.status) ? (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() =>
                                    void cancelRun({
                                      environmentId,
                                      input: { runId: run.id },
                                    }).then(runsQuery.refresh)
                                  }
                                >
                                  <CircleStopIcon className="size-3" /> Cancel
                                </Button>
                              ) : null}
                              {run.status === "failed" || run.status === "cancelled" ? (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() =>
                                    void retryRun({ environmentId, input: { runId: run.id } }).then(
                                      runsQuery.refresh,
                                    )
                                  }
                                >
                                  <RotateCcwIcon className="size-3" /> Retry
                                </Button>
                              ) : null}
                            </div>
                            {expanded ? (
                              <div className="mt-4 border-t border-border pt-4">
                                {runDetailQuery.isPending ? (
                                  <p className="text-xs text-muted-foreground">Loading timeline…</p>
                                ) : detail?.events.length ? (
                                  <ol className="space-y-3">
                                    {detail.events.map((event) => (
                                      <li
                                        key={event.id}
                                        className="grid grid-cols-[8px_minmax(0,1fr)] gap-3"
                                      >
                                        <span className="mt-1.5 size-2 rounded-full bg-primary/70" />
                                        <div>
                                          <div className="flex flex-wrap items-baseline gap-2">
                                            <span className="text-xs font-medium">
                                              {event.kind.replaceAll("-", " ")}
                                            </span>
                                            <time className="text-[11px] text-muted-foreground">
                                              {event.createdAt.replace("T", " ").slice(0, 19)} UTC
                                            </time>
                                          </div>
                                          {event.message ? (
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                              {event.message}
                                            </p>
                                          ) : null}
                                        </div>
                                      </li>
                                    ))}
                                  </ol>
                                ) : (
                                  <p className="text-xs text-muted-foreground">
                                    No timeline events recorded yet.
                                  </p>
                                )}
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>

                <section className="flex items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
                  <div>
                    <h3 className="text-sm font-medium">Delete automation</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Stops future schedules. Existing run and thread history stays available.
                    </p>
                  </div>
                  <Button size="sm" variant="destructive" onClick={() => void runAction("delete")}>
                    <Trash2Icon className="size-4" /> Delete
                  </Button>
                </section>
              </div>
            ) : null}
          </main>
        </div>
      )}
    </div>
  );
}
