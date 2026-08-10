import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as PartitionedSemaphore from "effect/PartitionedSemaphore";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import { PullRequestBusyError } from "@notcodex/contracts";

const GLOBAL_CONCURRENCY = 12;
const HOST_CONCURRENCY = 4;
const GLOBAL_OUTSTANDING_LIMIT = 64;
const HOST_OUTSTANDING_LIMIT = 20;
const RETRY_AFTER_MS = 1_000;

export interface PullRequestWorkBudgetLimits {
  readonly globalConcurrency: number;
  readonly hostConcurrency: number;
  readonly globalOutstandingLimit: number;
  readonly hostOutstandingLimit: number;
  readonly retryAfterMs: number;
}

const DEFAULT_LIMITS: PullRequestWorkBudgetLimits = {
  globalConcurrency: GLOBAL_CONCURRENCY,
  hostConcurrency: HOST_CONCURRENCY,
  globalOutstandingLimit: GLOBAL_OUTSTANDING_LIMIT,
  hostOutstandingLimit: HOST_OUTSTANDING_LIMIT,
  retryAfterMs: RETRY_AFTER_MS,
};

interface BudgetState {
  readonly total: number;
  readonly byHost: ReadonlyMap<string, number>;
}

export class PullRequestWorkBudget extends Context.Service<
  PullRequestWorkBudget,
  {
    readonly runRead: <A, E, R>(
      host: string,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | PullRequestBusyError, R>;
  }
>()("notcodex/pullRequest/PullRequestWorkBudget") {}

export const makeWithLimits = Effect.fn("PullRequestWorkBudget.makeWithLimits")(function* (
  limits: PullRequestWorkBudgetLimits,
) {
  const globalSlots = yield* Semaphore.make(limits.globalConcurrency);
  const hostSlots = yield* PartitionedSemaphore.make<string>({ permits: limits.hostConcurrency });
  const state = yield* Ref.make<BudgetState>({ total: 0, byHost: new Map() });

  const reserve = Effect.fn("PullRequestWorkBudget.reserve")(function* (host: string) {
    const normalizedHost = host.trim().toLowerCase();
    const accepted = yield* Ref.modify(state, (current) => {
      const hostCount = current.byHost.get(normalizedHost) ?? 0;
      if (
        current.total >= limits.globalOutstandingLimit ||
        hostCount >= limits.hostOutstandingLimit
      ) {
        return [false, current] as const;
      }
      return [
        true,
        {
          total: current.total + 1,
          byHost: new Map(current.byHost).set(normalizedHost, hostCount + 1),
        },
      ] as const;
    });
    if (!accepted) {
      return yield* new PullRequestBusyError({
        host: normalizedHost,
        retryAfterMs: limits.retryAfterMs,
      });
    }
    return normalizedHost;
  });

  const release = (host: string) =>
    Ref.update(state, (current) => {
      const hostCount = current.byHost.get(host) ?? 0;
      const byHost = new Map(current.byHost);
      if (hostCount <= 1) byHost.delete(host);
      else byHost.set(host, hostCount - 1);
      return { total: Math.max(0, current.total - 1), byHost };
    });

  const runRead: PullRequestWorkBudget["Service"]["runRead"] = (host, effect) =>
    Effect.acquireUseRelease(
      reserve(host),
      (normalizedHost) => globalSlots.withPermit(hostSlots.withPermit(normalizedHost)(effect)),
      release,
    );

  return PullRequestWorkBudget.of({ runRead });
});

export const make = makeWithLimits(DEFAULT_LIMITS);
