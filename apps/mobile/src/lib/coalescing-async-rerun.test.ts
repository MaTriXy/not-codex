import { describe, expect, it, vi } from "@effect/vitest";

import { CoalescingAsyncRerun } from "./coalescing-async-rerun";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("CoalescingAsyncRerun", () => {
  it("runs once more when a request arrives during the active operation", async () => {
    const coordinator = new CoalescingAsyncRerun();
    const firstGate = deferred();
    const operation = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstGate.promise)
      .mockResolvedValue(undefined);

    const first = coordinator.run(operation);
    const overlapping = coordinator.run(operation);
    expect(overlapping).toBe(first);
    expect(operation).toHaveBeenCalledOnce();

    firstGate.resolve();
    await first;
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("coalesces several overlapping requests into one follow-up run", async () => {
    const coordinator = new CoalescingAsyncRerun();
    const firstGate = deferred();
    const operation = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstGate.promise)
      .mockResolvedValue(undefined);

    const active = coordinator.run(operation);
    coordinator.run(operation);
    coordinator.run(operation);
    firstGate.resolve();

    await active;
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
