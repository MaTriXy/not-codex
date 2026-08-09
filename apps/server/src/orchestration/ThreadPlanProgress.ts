import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export interface ThreadPlanProgress {
  readonly step: string;
  readonly completedSteps: number;
  readonly totalSteps: number;
}

interface PlanStepInput {
  readonly step: string;
  readonly status: string;
}

interface ThreadPlanProgressShape {
  readonly recordPlanProgress: (threadId: string, plan: ReadonlyArray<PlanStepInput>) => void;
  readonly clearThreadPlanProgress: (threadId: string) => void;
  readonly getThreadPlanProgress: (threadId: string) => ThreadPlanProgress | null;
}

export function make(): ThreadPlanProgressShape {
  const progressByThreadId = new Map<string, ThreadPlanProgress>();
  return {
    recordPlanProgress: (threadId, plan) => {
      const completedSteps = plan.filter(({ status }) => status === "completed").length;
      const current =
        plan.find(({ status }) => status === "inProgress") ??
        plan.find(({ status }) => status !== "completed");
      if (plan.length === 0 || completedSteps === plan.length || current === undefined) {
        progressByThreadId.delete(threadId);
        return;
      }
      progressByThreadId.set(threadId, {
        step: current.step,
        completedSteps,
        totalSteps: plan.length,
      });
    },
    clearThreadPlanProgress: (threadId) => {
      progressByThreadId.delete(threadId);
    },
    getThreadPlanProgress: (threadId) => progressByThreadId.get(threadId) ?? null,
  };
}

export class ThreadPlanProgressService extends Context.Reference<ThreadPlanProgressShape>(
  "notcodex/orchestration/ThreadPlanProgressService",
  { defaultValue: make },
) {}

export const layer = Layer.succeed(ThreadPlanProgressService, make());
