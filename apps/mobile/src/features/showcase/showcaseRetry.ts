export interface ShowcaseRetryOptions {
  readonly isCancelled: () => boolean;
  readonly attemptTimeoutMs?: number;
  readonly retryDelayMs?: number;
}

const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAttempt(
  operation: () => Promise<boolean>,
  timeoutMs: number,
  isCancelled: () => boolean,
): Promise<boolean> {
  const pollingIntervalMs = Math.max(1, timeoutMs);
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (succeeded: boolean) => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      resolve(succeeded);
    };
    const pollCancellation = () => {
      if (isCancelled()) {
        finish(false);
        return;
      }
      timeout = setTimeout(pollCancellation, pollingIntervalMs);
    };

    void operation()
      .then(finish)
      .catch(() => finish(false));
    pollCancellation();
  });
}

/** Retry transient showcase setup work until it succeeds or the owning effect unmounts. */
export async function retryShowcaseOperation(
  operation: () => Promise<boolean>,
  options: ShowcaseRetryOptions,
): Promise<boolean> {
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  while (!options.isCancelled()) {
    // A timeout window only lets us observe cancellation. It must not start a
    // second operation while the first can still complete and mutate state.
    if (await waitForAttempt(operation, attemptTimeoutMs, options.isCancelled)) return true;
    if (!options.isCancelled()) await delay(retryDelayMs);
  }
  return false;
}
