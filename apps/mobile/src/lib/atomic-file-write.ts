export interface AtomicFileWriteOperations {
  readonly createTemporary: () => void;
  readonly writeTemporary: (encoded: string) => void;
  readonly replaceDestination: () => void;
  readonly temporaryExists: () => boolean;
  readonly removeTemporary: () => void;
}

/**
 * Installs a complete file with a same-directory temporary write followed by
 * an atomic rename. A failed write never truncates the last durable value.
 */
export function writeFileAtomically(encoded: string, operations: AtomicFileWriteOperations): void {
  let replaced = false;
  try {
    operations.createTemporary();
    operations.writeTemporary(encoded);
    operations.replaceDestination();
    replaced = true;
  } finally {
    // expo-file-system updates a File's URI after moveSync. Never inspect or
    // delete that object after a successful move, or we would delete the
    // destination that was just installed.
    if (!replaced && operations.temporaryExists()) {
      operations.removeTemporary();
    }
  }
}
