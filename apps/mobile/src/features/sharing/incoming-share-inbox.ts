import type { SharePayload } from "expo-sharing";

import { SerializedAsyncQueue } from "../../lib/serialized-async-queue";
import {
  hasIncomingShareContent,
  type IncomingShareDestination,
  type IncomingShareDraft,
} from "./incoming-share-model";

export interface IncomingShareInboxDependencies {
  readonly loadDrafts: () => Promise<ReadonlyArray<IncomingShareDraft>>;
  readonly writeDraft: (draft: IncomingShareDraft) => Promise<void>;
  readonly removeDraft: (shareId: string) => Promise<void>;
  readonly getPayloads: () => ReadonlyArray<SharePayload>;
  readonly clearPayloads: () => void;
  readonly buildDraft: (input: {
    readonly payloads: ReadonlyArray<SharePayload>;
    readonly id: string;
    readonly createdAt: string;
  }) => Promise<{
    readonly draft: IncomingShareDraft;
    readonly cleanup: () => Promise<void>;
  }>;
  readonly cleanupReplayedPayloads?: (payloads: ReadonlyArray<SharePayload>) => Promise<void>;
  readonly replayKeyForPayloads: (payloads: ReadonlyArray<SharePayload>) => Promise<string>;
  readonly nextShareId: () => string;
  readonly now: () => string;
  readonly onClearError?: (error: unknown) => void;
  readonly onCleanupError?: (error: unknown) => void;
}

export function sortAndDedupeIncomingShares(
  drafts: ReadonlyArray<IncomingShareDraft>,
): ReadonlyArray<IncomingShareDraft> {
  const ids = new Set<string>();
  return [...drafts]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .filter((draft) => {
      if (ids.has(draft.id)) {
        return false;
      }
      ids.add(draft.id);
      return true;
    });
}

/**
 * Serializes every durable inbox mutation. This prevents a stale storage load
 * or a foreground refresh from restoring an item after it has been consumed.
 */
export class IncomingShareInbox {
  private readonly operations = new SerializedAsyncQueue();

  constructor(private readonly dependencies: IncomingShareInboxDependencies) {}

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.operations.run(operation);
  }

  private clearNativePayloads(): boolean {
    try {
      this.dependencies.clearPayloads();
      return true;
    } catch (error) {
      this.dependencies.onClearError?.(error);
      return false;
    }
  }

  private async acknowledgeNativeHandoff(draft: IncomingShareDraft): Promise<IncomingShareDraft> {
    if (draft.nativeReplayKey === undefined) {
      return draft;
    }
    const { nativeReplayKey: _nativeReplayKey, ...acknowledged } = draft;
    await this.dependencies.writeDraft(acknowledged);
    return acknowledged;
  }

  private async cleanup(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      this.dependencies.onCleanupError?.(error);
    }
  }

  refresh(options: { readonly ingestNative: boolean }): Promise<ReadonlyArray<IncomingShareDraft>> {
    return this.runExclusive(async () => {
      const loaded = await this.dependencies.loadDrafts();
      const persisted = sortAndDedupeIncomingShares(loaded);
      if (!options.ingestNative) {
        return persisted;
      }

      const payloads = this.dependencies.getPayloads();
      if (payloads.length === 0) {
        const acknowledged = await Promise.all(
          persisted.map((draft) => this.acknowledgeNativeHandoff(draft)),
        );
        return sortAndDedupeIncomingShares(acknowledged);
      }

      // A share extension payload remains available until the containing app
      // acknowledges it. Keep a stable content-derived replay key only during
      // that write-before-ack window, while every handoff gets its own id.
      const replayKey = await this.dependencies.replayKeyForPayloads(payloads);
      const replayedDraft = loaded.find((draft) => draft.nativeReplayKey === replayKey);
      if (replayedDraft) {
        if (this.dependencies.cleanupReplayedPayloads) {
          await this.cleanup(() => this.dependencies.cleanupReplayedPayloads!(payloads));
        }
        if (!this.clearNativePayloads()) {
          return persisted;
        }
        const acknowledged = await this.acknowledgeNativeHandoff(replayedDraft);
        return sortAndDedupeIncomingShares(
          persisted.map((draft) => (draft.id === acknowledged.id ? acknowledged : draft)),
        );
      }

      const shareId = this.dependencies.nextShareId();
      const built = await this.dependencies.buildDraft({
        payloads,
        id: shareId,
        createdAt: this.dependencies.now(),
      });
      const { draft } = built;
      if (!hasIncomingShareContent(draft)) {
        // Unsupported native payloads cannot become actionable on retry and
        // would otherwise reopen the project picker on every foreground.
        await this.cleanup(built.cleanup);
        this.clearNativePayloads();
        throw new Error(
          draft.warnings[0] ?? "The shared content is not supported by the composer.",
        );
      }

      // The durable inbox write is the transaction boundary. Never clear the
      // native handoff first: a process termination must leave one recoverable
      // copy on one side of the boundary.
      const pendingAcknowledgement = { ...draft, nativeReplayKey: replayKey };
      await this.dependencies.writeDraft(pendingAcknowledgement);
      await this.cleanup(built.cleanup);
      if (!this.clearNativePayloads()) {
        return sortAndDedupeIncomingShares([pendingAcknowledgement, ...persisted]);
      }
      const acknowledged = await this.acknowledgeNativeHandoff(pendingAcknowledgement);
      return sortAndDedupeIncomingShares([acknowledged, ...persisted]);
    });
  }

  consume(shareId: string): Promise<ReadonlyArray<IncomingShareDraft>> {
    return this.runExclusive(async () => {
      // Derive the post-consumption snapshot while the durable item still
      // exists. Once removal succeeds there must be no fallible refresh that
      // can turn a committed consumption into an apparent failure and cause
      // the composer to restore its pre-import state.
      const persisted = await this.dependencies.loadDrafts();
      const remaining = sortAndDedupeIncomingShares(
        persisted.filter((draft) => draft.id !== shareId),
      );
      await this.dependencies.removeDraft(shareId);
      return remaining;
    });
  }

  reserve(
    shareId: string,
    destination: IncomingShareDestination,
  ): Promise<ReadonlyArray<IncomingShareDraft>> {
    return this.runExclusive(async () => {
      const persisted = await this.dependencies.loadDrafts();
      const target = persisted.find((draft) => draft.id === shareId);
      if (!target) {
        throw new Error("The shared content is no longer available.");
      }
      if (target.destination) {
        if (
          target.destination.environmentId !== destination.environmentId ||
          target.destination.projectId !== destination.projectId
        ) {
          throw new Error("The shared content is already reserved for another project draft.");
        }
        return sortAndDedupeIncomingShares(persisted);
      }

      const reserved = { ...target, destination };
      await this.dependencies.writeDraft(reserved);
      return sortAndDedupeIncomingShares(
        persisted.map((draft) => (draft.id === shareId ? reserved : draft)),
      );
    });
  }

  releaseReservation(
    shareId: string,
    expectedDestination: IncomingShareDestination,
  ): Promise<ReadonlyArray<IncomingShareDraft>> {
    return this.runExclusive(async () => {
      const persisted = await this.dependencies.loadDrafts();
      const target = persisted.find((draft) => draft.id === shareId);
      if (!target) {
        // Conditional release is idempotent: if another operation already
        // consumed the share, no reservation remains to clean up.
        return sortAndDedupeIncomingShares(persisted);
      }
      if (!target.destination) {
        return sortAndDedupeIncomingShares(persisted);
      }
      if (
        target.destination.environmentId !== expectedDestination.environmentId ||
        target.destination.projectId !== expectedDestination.projectId
      ) {
        throw new Error("The shared content reservation changed before it could be released.");
      }

      const { destination: _destination, ...unreserved } = target;
      await this.dependencies.writeDraft(unreserved);
      return sortAndDedupeIncomingShares(
        persisted.map((draft) => (draft.id === shareId ? unreserved : draft)),
      );
    });
  }
}
