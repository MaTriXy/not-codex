import * as Schema from "effect/Schema";

import { cleanupAtomicWriteTemporaries, writeFileAtomically } from "../../lib/atomic-file-write";
import { decodeIncomingShareDraft, type IncomingShareDraft } from "./incoming-share-model";

const INCOMING_SHARE_DIRECTORY = "incoming-shares";
export const INCOMING_SHARE_MAX_STORED_DRAFTS = 2;
export const INCOMING_SHARE_MAX_STORED_BYTES = 24 * 1024 * 1024;

interface IncomingShareStorageFile {
  readonly name: string;
  readonly size: number;
  readonly lastModified: number | null;
}

export function partitionIncomingShareStorageFiles<T extends IncomingShareStorageFile>(
  files: ReadonlyArray<T>,
): { readonly retained: ReadonlyArray<T>; readonly overflow: ReadonlyArray<T> } {
  const retained: T[] = [];
  const overflow: T[] = [];
  let retainedBytes = 0;

  const newestFirst = [...files].sort(
    (left, right) =>
      (right.lastModified ?? 0) - (left.lastModified ?? 0) || right.name.localeCompare(left.name),
  );
  for (const file of newestFirst) {
    const size = Math.max(0, file.size);
    if (
      retained.length < INCOMING_SHARE_MAX_STORED_DRAFTS &&
      retainedBytes + size <= INCOMING_SHARE_MAX_STORED_BYTES
    ) {
      retained.push(file);
      retainedBytes += size;
    } else {
      overflow.push(file);
    }
  }
  return { retained, overflow };
}

export class IncomingShareStorageError extends Schema.TaggedErrorClass<IncomingShareStorageError>()(
  "IncomingShareStorageError",
  {
    operation: Schema.Literals(["load", "write", "remove"]),
    shareId: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Incoming share storage operation ${this.operation} failed for ${this.shareId ?? "unknown"}.`;
  }
}

function fileName(shareId: string): string {
  return `${encodeURIComponent(shareId)}.json`;
}

async function getDirectory() {
  const { Directory, Paths } = await import("expo-file-system");
  const directory = new Directory(Paths.document, INCOMING_SHARE_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

async function getFile(shareId: string) {
  const { File } = await import("expo-file-system");
  return new File(await getDirectory(), fileName(shareId));
}

export async function loadIncomingShareDrafts(): Promise<ReadonlyArray<IncomingShareDraft>> {
  try {
    const { File } = await import("expo-file-system");
    const drafts: IncomingShareDraft[] = [];
    const entries = (await getDirectory()).list();
    const files = entries.filter((entry) => entry instanceof File);
    cleanupAtomicWriteTemporaries({
      entries: files.map((entry) => ({ name: entry.name, remove: () => entry.delete() })),
      isTemporaryName: (name) => /\.json\.[^.]+\.tmp$/.test(name),
      onError: (cause) =>
        console.warn(
          "[incoming-share] could not remove interrupted temporary",
          new IncomingShareStorageError({ operation: "remove", shareId: null, cause }),
        ),
    });
    const persistedFiles = files.filter((entry) => entry.name.endsWith(".json"));
    const boundedFiles = partitionIncomingShareStorageFiles(persistedFiles);
    for (const entry of boundedFiles.overflow) {
      try {
        entry.delete();
      } catch (cause) {
        console.warn(
          "[incoming-share] could not prune an overflowing persisted share",
          new IncomingShareStorageError({ operation: "remove", shareId: null, cause }),
        );
      }
    }
    // Select by filesystem metadata before reading any JSON. This bounds both
    // disk use and the base64 strings retained or parsed during hydration.
    for (const entry of boundedFiles.retained) {
      try {
        drafts.push(decodeIncomingShareDraft(JSON.parse(await entry.text()) as unknown));
      } catch (cause) {
        console.warn(
          "[incoming-share] ignored invalid persisted share",
          new IncomingShareStorageError({ operation: "load", shareId: null, cause }),
        );
      }
    }
    return drafts.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch (cause) {
    throw new IncomingShareStorageError({ operation: "load", shareId: null, cause });
  }
}

export async function writeIncomingShareDraft(draft: IncomingShareDraft): Promise<void> {
  try {
    const { File } = await import("expo-file-system");
    const { uuidv4 } = await import("../../lib/uuid");
    const directory = await getDirectory();
    const destination = new File(directory, fileName(draft.id));
    const temporary = new File(directory, `${fileName(draft.id)}.${uuidv4()}.tmp`);
    writeFileAtomically(JSON.stringify(draft), {
      createTemporary: () => temporary.create({ intermediates: true, overwrite: false }),
      writeTemporary: (encoded) => temporary.write(encoded),
      replaceDestination: () => temporary.moveSync(destination, { overwrite: true }),
      temporaryExists: () => temporary.exists,
      removeTemporary: () => temporary.delete(),
    });
  } catch (cause) {
    throw new IncomingShareStorageError({ operation: "write", shareId: draft.id, cause });
  }
}

export async function removeIncomingShareDraft(shareId: string): Promise<void> {
  try {
    const file = await getFile(shareId);
    if (file.exists) {
      file.delete();
    }
  } catch (cause) {
    throw new IncomingShareStorageError({ operation: "remove", shareId, cause });
  }
}
