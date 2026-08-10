import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { makeWithLimits } from "./PullRequestWorkBudget.ts";

describe("PullRequestWorkBudget", () => {
  it.effect("rejects excess work before it can create an unbounded host queue", () =>
    Effect.gen(function* () {
      const budget = yield* makeWithLimits({
        globalConcurrency: 2,
        hostConcurrency: 2,
        globalOutstandingLimit: 4,
        hostOutstandingLimit: 2,
        retryAfterMs: 250,
      });
      const release = yield* Deferred.make<void>();
      const bothStarted = yield* Deferred.make<void>();
      const started = yield* Ref.make(0);
      const blockedRead = Ref.updateAndGet(started, (count) => count + 1).pipe(
        Effect.tap((count) =>
          count === 2 ? Deferred.succeed(bothStarted, undefined) : Effect.void,
        ),
        Effect.andThen(Deferred.await(release)),
      );

      yield* Effect.all(
        [budget.runRead("GitHub.COM", blockedRead), budget.runRead("github.com", blockedRead)],
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.forkScoped);
      yield* Deferred.await(bothStarted);

      const error = yield* budget.runRead("github.com", Effect.void).pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "PullRequestBusyError",
        host: "github.com",
        retryAfterMs: 250,
      });

      yield* Deferred.succeed(release, undefined);
    }),
  );
});
