import { assert, it } from "@effect/vitest";

import { retryShowcaseOperation } from "./showcaseRetry";

it("retries a failed showcase operation until it succeeds", async () => {
  let attempts = 0;
  const succeeded = await retryShowcaseOperation(
    async () => {
      attempts += 1;
      return attempts === 3;
    },
    { isCancelled: () => false, retryDelayMs: 0 },
  );

  assert.equal(succeeded, true);
  assert.equal(attempts, 3);
});

it("does not overlap a slow showcase operation after its timeout window", async () => {
  let attempts = 0;
  let activeAttempts = 0;
  let maximumActiveAttempts = 0;
  const succeeded = await retryShowcaseOperation(
    async () => {
      attempts += 1;
      activeAttempts += 1;
      maximumActiveAttempts = Math.max(maximumActiveAttempts, activeAttempts);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeAttempts -= 1;
      return attempts === 2;
    },
    { isCancelled: () => false, attemptTimeoutMs: 1, retryDelayMs: 0 },
  );

  assert.equal(succeeded, true);
  assert.equal(attempts, 2);
  assert.equal(maximumActiveAttempts, 1);
});

it("stops waiting for a hung showcase operation after cancellation", async () => {
  let cancelled = false;
  const succeeded = await retryShowcaseOperation(
    () => {
      cancelled = true;
      return new Promise<boolean>(() => undefined);
    },
    { isCancelled: () => cancelled, attemptTimeoutMs: 1, retryDelayMs: 0 },
  );

  assert.equal(succeeded, false);
});

it("stops retrying when the owning showcase effect is cancelled", async () => {
  let cancelled = false;
  const succeeded = await retryShowcaseOperation(
    async () => {
      cancelled = true;
      return false;
    },
    { isCancelled: () => cancelled, retryDelayMs: 0 },
  );

  assert.equal(succeeded, false);
});
