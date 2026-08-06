// @effect-diagnostics nodeBuiltinImport:off
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import { HostProcessPlatform } from "@notcodex/shared/hostProcess";

import { ServerSettingsService } from "../../serverSettings.ts";
import {
  buildOpenKrittSnapshotManifest,
  openKrittSnapshotDigest,
  type OpenKrittSnapshotManifest,
} from "../openKrittSnapshot.ts";

/**
 * The single failure type of the snapshot service. Every filesystem fault,
 * bound violation, and refused confirmation narrows to it, so a caller can tell
 * a snapshot problem apart from any other error in the same channel.
 */
export class OpenKrittSnapshotError extends Schema.TaggedErrorClass<OpenKrittSnapshotError>()(
  "OpenKrittSnapshotError",
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.detail;
  }
}

function snapshotError(detail: string, cause?: unknown): OpenKrittSnapshotError {
  return new OpenKrittSnapshotError(cause === undefined ? { detail } : { detail, cause });
}

const isSnapshotError = Schema.is(OpenKrittSnapshotError);

export interface OpenKrittSnapshotPreview {
  readonly projectId: string;
  readonly includedPaths: ReadonlyArray<string>;
  readonly excludedPaths: ReadonlyArray<string>;
  readonly manifestDigest: string;
  readonly fileCount: number;
  readonly byteCount: number;
  readonly confirmedSafeForProvider: false;
  readonly snapshotId: null;
}

export interface OpenKrittSnapshotCreated {
  readonly snapshotId: string;
  readonly snapshotFolderName: string;
  readonly manifestDigest: string;
  readonly manifest: OpenKrittSnapshotManifest;
}

export interface OpenKrittSnapshotServiceShape {
  readonly previewSnapshot: (input: {
    readonly projectId: string;
    readonly workspaceRoot: string;
    readonly sourceCommitSha: string | null;
  }) => Effect.Effect<OpenKrittSnapshotPreview, OpenKrittSnapshotError>;
  readonly createSnapshot: (input: {
    readonly projectId: string;
    readonly workspaceRoot: string;
    readonly sourceCommitSha: string | null;
    readonly confirmSafeForProvider: boolean;
    readonly acknowledgedManifestDigest: string;
  }) => Effect.Effect<OpenKrittSnapshotCreated, OpenKrittSnapshotError>;
  readonly cleanupSnapshot: (input: {
    readonly snapshotFolderName: string;
    readonly scanState: "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
    readonly retainSnapshot: boolean;
  }) => Effect.Effect<{ readonly action: "retained" | "removed" }, OpenKrittSnapshotError>;
  /** Removes only Not Codex-owned temporary or unregistered published folders. */
  readonly reconcileOwnedSnapshots: (input: {
    readonly registeredFolderNames: ReadonlyArray<string>;
  }) => Effect.Effect<{ readonly removed: ReadonlyArray<string> }, OpenKrittSnapshotError>;
}

export class OpenKrittSnapshotService extends Context.Service<
  OpenKrittSnapshotService,
  OpenKrittSnapshotServiceShape
>()("notcodex/integrations/Layers/OpenKrittSnapshotService") {}

const MAX_FILES = 50_000;
const MAX_BYTES = 512 * 1024 * 1024;
const ORPHAN_RECONCILIATION_GRACE_MS = 60_000;

function opaqueFolderName(): string {
  return `nc126-${NodeCrypto.randomUUID().replaceAll("-", "")}`;
}

async function buildManifest(input: {
  readonly projectId: string;
  readonly workspaceRoot: string;
  readonly sourceCommitSha: string | null;
  readonly hashContents?: boolean;
}): Promise<OpenKrittSnapshotManifest> {
  return buildOpenKrittSnapshotManifest({
    sourceRoot: input.workspaceRoot,
    maxFiles: MAX_FILES,
    maxBytes: MAX_BYTES,
    hashContents: input.hashContents ?? true,
  }).catch((cause) => {
    throw snapshotError("Snapshot manifest failed.", cause);
  });
}

async function ensureSnapshotRoot(snapshotRoot: string): Promise<string> {
  await NodeFSP.mkdir(snapshotRoot, { recursive: true });
  return snapshotRoot;
}

function isPathWithin(parent: string, child: string): boolean {
  const relative = NodePath.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${NodePath.sep}`));
}

async function assertSnapshotRootOutsideWorkspace(
  snapshotRoot: string,
  workspaceRoot: string,
): Promise<void> {
  const workspace = NodePath.resolve(workspaceRoot);
  const snapshots = NodePath.resolve(snapshotRoot);
  if (isPathWithin(workspace, snapshots)) {
    throw snapshotError("Open Kritt snapshotRoot must be outside the project workspace.");
  }
  // Existing symlinks can make lexically separate paths alias the workspace.
  // Check their real identities before manifest enumeration follows either.
  try {
    const [realWorkspace, realSnapshots] = await Promise.all([
      NodeFSP.realpath(workspace),
      NodeFSP.realpath(snapshots),
    ]);
    if (isPathWithin(realWorkspace, realSnapshots)) {
      throw snapshotError("Open Kritt snapshotRoot must be outside the project workspace.");
    }
  } catch (cause) {
    if (isSnapshotError(cause)) throw cause;
    // A not-yet-created snapshot root has no real identity; the lexical check
    // above remains authoritative until ensureSnapshotRoot creates it.
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? (cause as { readonly code?: unknown }).code
        : undefined;
    if (code !== "ENOENT") throw cause;
  }
}

interface SnapshotPathIdentity {
  readonly path: string;
  readonly device: number;
  readonly inode: number;
}

async function snapshotAncestorIdentities(
  sourceRoot: string,
  relativePath: string,
): Promise<ReadonlyArray<SnapshotPathIdentity>> {
  const root = NodePath.resolve(sourceRoot);
  const source = NodePath.resolve(root, relativePath);
  const inside = NodePath.relative(root, source);
  if (inside.length === 0 || inside === ".." || inside.startsWith(`..${NodePath.sep}`)) {
    throw new Error(`Snapshot source changed: ${relativePath}`);
  }
  const segments = inside.split(NodePath.sep);
  const directories = [root];
  for (let index = 0; index < segments.length - 1; index += 1) {
    directories.push(NodePath.join(root, ...segments.slice(0, index + 1)));
  }
  return Promise.all(
    directories.map(async (directory) => {
      const stat = await NodeFSP.lstat(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`Snapshot source changed: ${relativePath}`);
      }
      return { path: directory, device: stat.dev, inode: stat.ino };
    }),
  );
}

async function revalidateSnapshotPath(
  source: string,
  relativePath: string,
  expectedAncestors: ReadonlyArray<SnapshotPathIdentity>,
  openedFile: NodeFS.Stats,
): Promise<void> {
  for (const expected of expectedAncestors) {
    const current = await NodeFSP.lstat(expected.path);
    if (
      current.isSymbolicLink() ||
      !current.isDirectory() ||
      current.dev !== expected.device ||
      current.ino !== expected.inode
    ) {
      throw new Error(`Snapshot source changed: ${relativePath}`);
    }
  }
  // O_NOFOLLOW protects the final component, while this identity comparison
  // also catches a parent replaced with a symlink or another directory during
  // open: the path now resolves to a different file than the held descriptor.
  const currentFile = await NodeFSP.lstat(source);
  if (
    currentFile.isSymbolicLink() ||
    !currentFile.isFile() ||
    currentFile.dev !== openedFile.dev ||
    currentFile.ino !== openedFile.ino
  ) {
    throw new Error(`Snapshot source changed: ${relativePath}`);
  }
}

/**
 * Copies the reviewed files and returns the manifest digest of what was actually
 * written. Hashing here rather than in a separate pass removes a full extra read
 * of the tree while keeping the confirmation bound to the copied bytes.
 *
 * Exported for the adversarial replacement-race test.
 */
export async function copyReviewedSnapshot(
  sourceRoot: string,
  targetRoot: string,
  manifest: OpenKrittSnapshotManifest,
  runtime: {
    readonly platform: NodeJS.Platform;
    readonly noFollowOpenFlag: number;
  },
): Promise<string> {
  // Windows does not expose an O_NOFOLLOW equivalent through Node. Opening a
  // reviewed path there would follow a symlink swapped in after preview and
  // make the descriptor stat describe the outside target. Until a Windows-safe
  // handle identity check is available, snapshots must fail closed.
  if (
    runtime.platform === "win32" ||
    !Number.isInteger(runtime.noFollowOpenFlag) ||
    runtime.noFollowOpenFlag <= 0
  ) {
    throw new Error("Snapshot publication requires no-follow file opens.");
  }
  const digestEntries: Array<{ readonly path: string; readonly contentDigest: string }> = [];
  const byteBudget = Math.min(MAX_BYTES, manifest.byteCount);
  let copiedBytes = 0;
  await NodeFSP.mkdir(targetRoot, { recursive: true });
  for (const relativePath of manifest.includedPaths) {
    const source = NodePath.resolve(sourceRoot, relativePath);
    const target = NodePath.join(targetRoot, relativePath);
    // Open with O_NOFOLLOW and copy from the resulting descriptor. lstat+copyFile
    // would let a concurrent process replace a reviewed regular file with a
    // symlink between the check and the copy, pulling a file from outside the
    // workspace into a snapshot that is forwarded to the model provider.
    let handle: NodeFSP.FileHandle;
    let ancestorIdentities: ReadonlyArray<SnapshotPathIdentity>;
    try {
      ancestorIdentities = await snapshotAncestorIdentities(sourceRoot, relativePath);
      handle = await NodeFSP.open(source, NodeFS.constants.O_RDONLY | runtime.noFollowOpenFlag);
    } catch {
      throw new Error(`Snapshot source changed: ${relativePath}`);
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error(`Snapshot source changed: ${relativePath}`);
      await revalidateSnapshotPath(source, relativePath, ancestorIdentities, stat);
      const remainingBytes = byteBudget - copiedBytes;
      if (stat.size > remainingBytes) {
        throw new Error(`Snapshot byte limit exceeded while copying: ${relativePath}`);
      }
      await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
      const targetHandle = await NodeFSP.open(target, "wx", 0o600);
      const digest = NodeCrypto.createHash("sha256");
      let fileBytes = 0;
      try {
        // Read one bounded chunk at a time from the already validated
        // descriptor. The extra byte of allowance detects growth after stat()
        // without allocating or writing an unbounded replacement file.
        while (true) {
          const remaining = remainingBytes - fileBytes;
          const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, remaining + 1)));
          const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
          if (bytesRead === 0) break;
          if (bytesRead > remaining) {
            throw new Error(`Snapshot byte limit exceeded while copying: ${relativePath}`);
          }
          const chunk = buffer.subarray(0, bytesRead);
          let written = 0;
          while (written < chunk.byteLength) {
            const result = await targetHandle.write(
              chunk,
              written,
              chunk.byteLength - written,
              null,
            );
            if (result.bytesWritten === 0)
              throw new Error(`Snapshot copy stalled: ${relativePath}`);
            written += result.bytesWritten;
          }
          digest.update(chunk);
          fileBytes += bytesRead;
        }
      } catch (cause) {
        await targetHandle.close().catch(() => undefined);
        await NodeFSP.rm(target, { force: true }).catch(() => undefined);
        throw cause;
      }
      await targetHandle.close();
      copiedBytes += fileBytes;
      digestEntries.push({
        path: relativePath,
        contentDigest: digest.digest("hex"),
      });
    } finally {
      await handle.close();
    }
  }
  return openKrittSnapshotDigest(digestEntries);
}

export const OpenKrittSnapshotServiceLive = Layer.effect(
  OpenKrittSnapshotService,
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    const hostPlatform = yield* HostProcessPlatform;
    const getSnapshotRoot = Effect.fn("OpenKrittSnapshotService.getSnapshotRoot")(function* () {
      const current = yield* settings.getSettings.pipe(
        Effect.mapError((cause) => snapshotError(cause.message, cause)),
      );
      const root = current.integrations.openKritt.snapshotRoot;
      if (root === null || root.length === 0)
        return yield* snapshotError("Open Kritt snapshotRoot is not configured.");
      return root;
    });

    const previewSnapshot = Effect.fn("OpenKrittSnapshotService.previewSnapshot")(
      function* (input: {
        readonly projectId: string;
        readonly workspaceRoot: string;
        readonly sourceCommitSha: string | null;
      }) {
        const snapshotRoot = yield* getSnapshotRoot();
        yield* Effect.tryPromise({
          try: () => assertSnapshotRootOutsideWorkspace(snapshotRoot, input.workspaceRoot),
          catch: (cause) =>
            isSnapshotError(cause)
              ? cause
              : snapshotError("Snapshot root validation failed.", cause),
        });
        const manifest = yield* Effect.tryPromise({
          try: () => buildManifest(input),
          catch: (cause) => snapshotError("Snapshot manifest failed.", cause),
        });
        return {
          projectId: input.projectId,
          includedPaths: manifest.includedPaths,
          excludedPaths: manifest.excludedPaths,
          manifestDigest: manifest.digest,
          fileCount: manifest.fileCount,
          byteCount: manifest.byteCount,
          confirmedSafeForProvider: false as const,
          snapshotId: null,
        };
      },
    );

    const createSnapshot = Effect.fn("OpenKrittSnapshotService.createSnapshot")(function* (input: {
      readonly projectId: string;
      readonly workspaceRoot: string;
      readonly sourceCommitSha: string | null;
      readonly confirmSafeForProvider: boolean;
      readonly acknowledgedManifestDigest: string;
    }) {
      if (!input.confirmSafeForProvider)
        return yield* snapshotError(
          "Explicit provider-safety confirmation is required for a local snapshot.",
        );
      const snapshotRoot = yield* getSnapshotRoot();
      yield* Effect.tryPromise({
        try: () => assertSnapshotRootOutsideWorkspace(snapshotRoot, input.workspaceRoot),
        catch: (cause) =>
          isSnapshotError(cause) ? cause : snapshotError("Snapshot root validation failed.", cause),
      });
      // Enumerate and bound the tree without reading contents; the copy below
      // produces the digest, so the workspace is read once here instead of twice.
      const manifest = yield* Effect.tryPromise({
        try: () => buildManifest({ ...input, hashContents: false }),
        catch: (cause) => snapshotError("Snapshot manifest failed.", cause),
      });
      const snapshotFolderName = opaqueFolderName();
      const targetRoot = yield* Effect.tryPromise({
        try: () => ensureSnapshotRoot(snapshotRoot),
        catch: (cause) => snapshotError("Snapshot root is unavailable.", cause),
      });
      const temporary = yield* Effect.tryPromise({
        // Keep the temporary directory beside the final destination so the
        // publish rename remains atomic even when snapshotRoot is a separate
        // filesystem from the host's global temporary directory.
        try: () => NodeFSP.mkdtemp(NodePath.join(targetRoot, ".notcodex-open-kritt-snapshot-")),
        catch: (cause) => snapshotError("Snapshot temporary directory failed.", cause),
      });
      const finalPath = NodePath.join(targetRoot, snapshotFolderName);
      const publish = Effect.gen(function* () {
        const copiedDigest = yield* Effect.tryPromise({
          try: () =>
            copyReviewedSnapshot(input.workspaceRoot, temporary, manifest, {
              platform: hostPlatform,
              noFollowOpenFlag: NodeFS.constants.O_NOFOLLOW,
            }),
          catch: (cause) => snapshotError("Snapshot copy failed.", cause),
        });
        // Bind the confirmation to the bytes actually staged. If the workspace
        // changed after review, the user never approved sending these contents to
        // the model provider, so fail closed before the atomic publish.
        if (copiedDigest !== input.acknowledgedManifestDigest) {
          return yield* snapshotError(
            "The workspace changed after the snapshot was reviewed. Preview and confirm the snapshot again before sending it to the model provider.",
          );
        }
        yield* Effect.tryPromise({
          try: async () => {
            await NodeFSP.rename(temporary, finalPath);
          },
          catch: (cause) => snapshotError("Snapshot publish failed.", cause),
        });
        return copiedDigest;
      });
      const manifestDigest = yield* publish.pipe(
        Effect.catch((cause) =>
          Effect.tryPromise({
            try: () => NodeFSP.rm(temporary, { recursive: true, force: true }),
            catch: (cleanupCause) => snapshotError("Snapshot cleanup failed.", cleanupCause),
          }).pipe(
            Effect.catch(() => Effect.void),
            Effect.flatMap(() => Effect.fail(cause)),
          ),
        ),
      );
      return {
        snapshotId: snapshotFolderName,
        snapshotFolderName,
        manifestDigest,
        manifest: { ...manifest, digest: manifestDigest },
      };
    });

    const cleanupSnapshot = Effect.fn("OpenKrittSnapshotService.cleanupSnapshot")(
      function* (input: {
        readonly snapshotFolderName: string;
        readonly scanState: "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
        readonly retainSnapshot: boolean;
      }) {
        if (!/^[A-Za-z0-9_-]+$/.test(input.snapshotFolderName))
          return yield* snapshotError("Invalid snapshot folder name.");
        if (
          input.retainSnapshot ||
          input.scanState === "queued" ||
          input.scanState === "running" ||
          input.scanState === "waiting"
        )
          return { action: "retained" as const };
        const snapshotRoot = yield* getSnapshotRoot();
        yield* Effect.tryPromise({
          try: () =>
            NodeFSP.rm(NodePath.join(snapshotRoot, input.snapshotFolderName), {
              recursive: true,
              force: true,
            }),
          catch: (cause) => snapshotError("Snapshot cleanup failed.", cause),
        });
        return { action: "removed" as const };
      },
    );

    const reconcileOwnedSnapshots = Effect.fn("OpenKrittSnapshotService.reconcileOwnedSnapshots")(
      function* (input: { readonly registeredFolderNames: ReadonlyArray<string> }) {
        const snapshotRoot = yield* getSnapshotRoot();
        const registered = new Set(input.registeredFolderNames);
        const entries = yield* Effect.tryPromise({
          try: async () => {
            try {
              return await NodeFSP.readdir(snapshotRoot, { withFileTypes: true });
            } catch (cause) {
              const code =
                typeof cause === "object" && cause !== null && "code" in cause
                  ? (cause as { readonly code?: unknown }).code
                  : undefined;
              if (code === "ENOENT") return [];
              throw cause;
            }
          },
          catch: (cause) => snapshotError("Snapshot reconciliation failed.", cause),
        });
        const candidateNames = entries.flatMap((entry) => {
          if (entry.name.startsWith(".notcodex-open-kritt-snapshot-")) return [entry.name];
          if (/^nc126-[a-f0-9]{32}$/.test(entry.name) && !registered.has(entry.name))
            return [entry.name];
          return [];
        });
        // The poller may overlap a live create/save sequence. A short grace
        // window prevents it from deleting a just-published folder before SQL
        // records it, while periodic reconciliation still reclaims crash debris.
        const nowMillis = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
        const cutoff = nowMillis - ORPHAN_RECONCILIATION_GRACE_MS;
        const orphanNames = yield* Effect.forEach(
          candidateNames,
          (name) =>
            Effect.tryPromise({
              try: () => NodeFSP.lstat(NodePath.join(snapshotRoot, name)),
              catch: (cause) => snapshotError("Snapshot reconciliation failed.", cause),
            }).pipe(Effect.map((stat) => (stat.mtimeMs <= cutoff ? name : null))),
          { concurrency: 4 },
        ).pipe(Effect.map((names) => names.filter((name): name is string => name !== null)));
        yield* Effect.forEach(
          orphanNames,
          (name) =>
            Effect.tryPromise({
              try: () =>
                NodeFSP.rm(NodePath.join(snapshotRoot, name), { recursive: true, force: true }),
              catch: (cause) => snapshotError("Snapshot reconciliation failed.", cause),
            }),
          { concurrency: 4, discard: true },
        );
        return { removed: orphanNames };
      },
    );

    return OpenKrittSnapshotService.of({
      previewSnapshot,
      createSnapshot,
      cleanupSnapshot,
      reconcileOwnedSnapshots,
    });
  }),
);
