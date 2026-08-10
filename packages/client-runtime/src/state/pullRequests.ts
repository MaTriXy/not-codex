import { WS_METHODS, type PullRequestDiffInput } from "@notcodex/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/unstable/reactivity";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentQueryAtomFamily,
} from "./runtime.ts";
import { PullRequestDiffLoader } from "./pullRequestDiffHttp.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";

export { PullRequestDiffLoader, pullRequestDiffLoaderLayer } from "./pullRequestDiffHttp.ts";

export class EnvironmentHttpConnectionNotReadyError extends Data.TaggedError(
  "EnvironmentHttpConnectionNotReadyError",
)<{ readonly message: string }> {}

/** Read-only pull request data shared by web and future mobile clients. */
export function createPullRequestEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | PullRequestDiffLoader | R, E>,
) {
  const commandScheduler = createAtomCommandScheduler();
  const serialPerEnvironment = {
    mode: "serial",
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  } as const;

  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pull-requests:list",
      tag: WS_METHODS.pullRequestsList,
      staleTimeMs: 30_000,
    }),
    listStats: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pull-requests:list-stats",
      tag: WS_METHODS.pullRequestsListStats,
      staleTimeMs: 60_000,
    }),
    detail: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pull-requests:detail",
      tag: WS_METHODS.pullRequestsDetail,
      staleTimeMs: 15_000,
    }),
    activity: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pull-requests:activity",
      tag: WS_METHODS.pullRequestsActivity,
      staleTimeMs: 15_000,
    }),
    diff: createEnvironmentQueryAtomFamily(runtime, {
      label: "environment-data:pull-requests:diff",
      staleTimeMs: 60_000,
      execute: (input: PullRequestDiffInput) =>
        Effect.gen(function* () {
          const supervisor = yield* EnvironmentSupervisor;
          const loader = yield* PullRequestDiffLoader;
          const prepared = yield* SubscriptionRef.get(supervisor.prepared);
          if (Option.isNone(prepared)) {
            return yield* new EnvironmentHttpConnectionNotReadyError({
              message: "The environment HTTP connection is not ready.",
            });
          }
          return yield* loader.load(prepared.value, input);
        }),
    }),
    diffFileContents: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-requests:diff-file-contents",
      tag: WS_METHODS.pullRequestsDiffFileContents,
      scheduler: commandScheduler,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) =>
          JSON.stringify([
            environmentId,
            input.projectId,
            input.repository,
            input.number,
            input.commit ?? null,
            input.changeType,
            input.oldPath,
            input.newPath,
          ]),
      },
    }),
    invalidate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pull-requests:invalidate",
      tag: WS_METHODS.pullRequestsInvalidate,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
    }),
  };
}
