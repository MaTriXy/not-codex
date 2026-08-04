// @effect-diagnostics nodeBuiltinImport:off
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";

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
}

export class OpenKrittSnapshotService extends Context.Service<
  OpenKrittSnapshotService,
  OpenKrittSnapshotServiceShape
>()("notcodex/integrations/Layers/OpenKrittSnapshotService") {}

const MAX_FILES = 50_000;
const MAX_BYTES = 512 * 1024 * 1024;

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
): Promise<string> {
  const digestEntries: Array<{ readonly path: string; readonly contentDigest: string }> = [];
  await NodeFSP.mkdir(targetRoot, { recursive: true });
  for (const relativePath of manifest.includedPaths) {
    const source = NodePath.join(sourceRoot, relativePath);
    const target = NodePath.join(targetRoot, relativePath);
    // Open with O_NOFOLLOW and copy from the resulting descriptor. lstat+copyFile
    // would let a concurrent process replace a reviewed regular file with a
    // symlink between the check and the copy, pulling a file from outside the
    // workspace into a snapshot that is forwarded to the model provider.
    let handle: NodeFSP.FileHandle;
    try {
      handle = await NodeFSP.open(source, NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW);
    } catch {
      throw new Error(`Snapshot source changed: ${relativePath}`);
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error(`Snapshot source changed: ${relativePath}`);
      await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
      const contents = await handle.readFile();
      await NodeFSP.writeFile(target, contents, { flag: "wx", mode: 0o600 });
      digestEntries.push({
        path: relativePath,
        contentDigest: NodeCrypto.createHash("sha256").update(contents).digest("hex"),
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
        yield* getSnapshotRoot();
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
          try: () => copyReviewedSnapshot(input.workspaceRoot, temporary, manifest),
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

    return OpenKrittSnapshotService.of({ previewSnapshot, createSnapshot, cleanupSnapshot });
  }),
);
