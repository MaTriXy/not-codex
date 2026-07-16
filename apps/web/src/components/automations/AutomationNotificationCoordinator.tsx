import { useAtomValue } from "@effect/atom-react";
import type { AutomationRun } from "@notcodex/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { automationEnvironment } from "../../state/automations";
import { useActiveEnvironmentId } from "../../state/entities";
import { stackedThreadToast, toastManager } from "../ui/toast";

function notificationFor(run: AutomationRun): { title: string; body: string } | null {
  const policy = run.definitionSnapshot.notifications;
  if (run.status === "running" && policy.onStarted) {
    return {
      title: `${run.definitionSnapshot.name} started`,
      body: "The automation is running in a Not Codex thread.",
    };
  }
  if (run.status === "waiting-for-approval" && policy.onWaiting) {
    return {
      title: `${run.definitionSnapshot.name} needs approval`,
      body: "Open the automation thread to review the pending request.",
    };
  }
  if (run.status === "waiting-for-input" && policy.onWaiting) {
    return {
      title: `${run.definitionSnapshot.name} needs input`,
      body: "Open the automation thread to answer the agent.",
    };
  }
  if (run.status === "succeeded" && policy.onSucceeded) {
    return {
      title: `${run.definitionSnapshot.name} succeeded`,
      body: run.pullRequestUrl
        ? "The result and pull request are ready."
        : "The automation result is ready.",
    };
  }
  if ((run.status === "failed" || run.status === "cancelled") && policy.onFailed) {
    return {
      title: `${run.definitionSnapshot.name} ${run.status}`,
      body: run.errorMessage ?? "Review the run timeline for details.",
    };
  }
  return null;
}

function EnvironmentAutomationNotifications({
  environmentId,
}: {
  environmentId: NonNullable<ReturnType<typeof useActiveEnvironmentId>>;
}) {
  const navigate = useNavigate();
  const result = useAtomValue(automationEnvironment.changes({ environmentId, input: {} }));
  const lastStatusByRun = useRef(new Map<string, AutomationRun["status"]>());

  useEffect(() => {
    if (result._tag !== "Success" || result.value.type !== "run-upserted") return;
    const run = result.value.run;
    if (lastStatusByRun.current.get(run.id) === run.status) return;
    lastStatusByRun.current.set(run.id, run.status);
    const content = notificationFor(run);
    if (!content) return;

    toastManager.add(
      stackedThreadToast({
        type: run.status === "failed" || run.status === "cancelled" ? "error" : "info",
        title: content.title,
        description: content.body,
        ...(run.threadId
          ? {
              actionProps: {
                children: "Open thread",
                onClick: () =>
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: { environmentId, threadId: run.threadId! },
                  }),
              },
            }
          : {}),
      }),
    );

    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const notification = new Notification(content.title, {
      body: content.body,
      tag: `notcodex-automation-${run.id}-${run.status}`,
      icon: "/apple-touch-icon.png",
    });
    notification.addEventListener("click", () => {
      window.focus();
      if (run.threadId) {
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId: run.threadId },
        });
      }
      notification.close();
    });
  }, [environmentId, navigate, result]);

  return null;
}

export function AutomationNotificationCoordinator() {
  const environmentId = useActiveEnvironmentId();
  return environmentId ? (
    <EnvironmentAutomationNotifications environmentId={environmentId} />
  ) : null;
}
