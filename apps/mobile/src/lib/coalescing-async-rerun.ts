/**
 * Coalesces overlapping requests while guaranteeing one follow-up run when a
 * request arrives during the active operation.
 */
export class CoalescingAsyncRerun {
  private active: Promise<void> | null = null;
  private rerunRequested = false;

  run(operation: () => Promise<void>): Promise<void> {
    if (this.active) {
      this.rerunRequested = true;
      return this.active;
    }

    const active = (async () => {
      do {
        this.rerunRequested = false;
        await operation();
      } while (this.rerunRequested);
    })().finally(() => {
      this.active = null;
    });
    this.active = active;
    return active;
  }
}
