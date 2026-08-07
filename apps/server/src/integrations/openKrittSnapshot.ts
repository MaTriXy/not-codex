// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".notcodex",
  "node_modules",
  ".turbo",
  "dist",
  "build",
  ".vite",
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  ".docker",
]);
const EXCLUDED_FILE_NAMES = new Set([
  "id_rsa",
  "id_dsa",
  "id_ed25519",
  "id_ed25519_sk",
  "id_ecdsa",
  "id_ecdsa_sk",
  "credentials",
  "credentials.json",
  "credentials.yml",
  "credentials.yaml",
  ".npmrc",
  ".yarnrc.yml",
  ".git-credentials",
  ".netrc",
  "_netrc",
  ".pgpass",
  ".htpasswd",
]);
const EXCLUDED_FILE_SUFFIXES = [
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
  ".p8",
  ".asc",
  ".gpg",
  ".kdbx",
];

export function validateOpenKrittSnapshotPath(
  sourceRoot: string,
  relativePath: string,
): { readonly relativePath: string } {
  if (sourceRoot.trim().length === 0 || !NodePath.isAbsolute(sourceRoot))
    throw new Error("Snapshot source root must be absolute.");
  if (
    relativePath.length === 0 ||
    NodePath.isAbsolute(relativePath) ||
    /^[A-Za-z]:[\\/]/.test(relativePath) ||
    relativePath.startsWith("\\\\")
  ) {
    throw new Error("Snapshot path must be a relative path.");
  }
  const normalized = relativePath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".."))
    throw new Error("Snapshot path escapes the source root.");
  const clean = parts.filter((part) => part !== "" && part !== ".").join("/");
  if (clean.length === 0 || clean.startsWith("/") || clean.includes("\u0000"))
    throw new Error("Invalid snapshot path.");
  const resolved = NodePath.resolve(sourceRoot, ...clean.split("/"));
  const root = NodePath.resolve(sourceRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${NodePath.sep}`))
    throw new Error("Snapshot path escapes the source root.");
  return { relativePath: clean };
}

export function isOpenKrittSnapshotExcluded(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => EXCLUDED_DIRECTORY_NAMES.has(part))) return true;
  const basename = parts.at(-1) ?? "";
  // Every dotenv variant carries live credentials, so match by prefix rather
  // than enumerating environment names such as .env.development or .env.staging.
  if (basename === ".env" || basename.startsWith(".env.")) return true;
  return (
    EXCLUDED_FILE_NAMES.has(basename) ||
    EXCLUDED_FILE_SUFFIXES.some((suffix) => basename.endsWith(suffix))
  );
}

export interface OpenKrittSnapshotManifest {
  readonly digest: string;
  readonly fileCount: number;
  readonly byteCount: number;
  readonly includedPaths: ReadonlyArray<string>;
  readonly excludedPaths: ReadonlyArray<string>;
}

interface SnapshotPathIdentity {
  readonly path: string;
  readonly device: number;
  readonly inode: number;
}

export interface OpenKrittOpenedSnapshotFile {
  readonly handle: NodeFSP.FileHandle;
  readonly stat: NodeFS.Stats;
  readonly revalidate: () => Promise<void>;
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

/** Opens one workspace file without following replacements and preserves its path identity. */
export async function openVerifiedSnapshotFile(
  sourceRoot: string,
  relativePath: string,
  noFollowOpenFlag: number,
): Promise<OpenKrittOpenedSnapshotFile> {
  if (!Number.isInteger(noFollowOpenFlag) || noFollowOpenFlag <= 0) {
    throw new Error("Snapshot reads require no-follow file opens.");
  }
  const validated = validateOpenKrittSnapshotPath(sourceRoot, relativePath);
  const source = NodePath.resolve(sourceRoot, validated.relativePath);
  const expectedAncestors = await snapshotAncestorIdentities(sourceRoot, validated.relativePath);
  const handle = await NodeFSP.open(source, NodeFS.constants.O_RDONLY | noFollowOpenFlag);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`Snapshot source changed: ${relativePath}`);
    const revalidate = async () => {
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
      const currentFile = await NodeFSP.lstat(source);
      if (
        currentFile.isSymbolicLink() ||
        !currentFile.isFile() ||
        currentFile.dev !== stat.dev ||
        currentFile.ino !== stat.ino
      ) {
        throw new Error(`Snapshot source changed: ${relativePath}`);
      }
    };
    await revalidate();
    return { handle, stat, revalidate };
  } catch (cause) {
    await handle.close().catch(() => undefined);
    throw cause;
  }
}

/** Hashes a reviewed file in bounded chunks and rejects growth/replacement races. */
export async function hashOpenKrittSnapshotFile(input: {
  readonly sourceRoot: string;
  readonly relativePath: string;
  readonly expectedSize: number;
  readonly maxBytes: number;
  readonly noFollowOpenFlag: number;
}): Promise<{ readonly contentDigest: string; readonly byteCount: number }> {
  const opened = await openVerifiedSnapshotFile(
    input.sourceRoot,
    input.relativePath,
    input.noFollowOpenFlag,
  );
  try {
    if (opened.stat.size !== input.expectedSize) {
      throw new Error(`Snapshot file changed during review: ${input.relativePath}`);
    }
    const digest = NodeCrypto.createHash("sha256");
    let byteCount = 0;
    while (true) {
      const remaining = input.maxBytes - byteCount;
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, remaining + 1)));
      const { bytesRead } = await opened.handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      if (bytesRead > remaining) throw new Error("Snapshot byte limit exceeded.");
      digest.update(buffer.subarray(0, bytesRead));
      byteCount += bytesRead;
    }
    const finalStat = await opened.handle.stat();
    await opened.revalidate();
    if (finalStat.size !== input.expectedSize || byteCount !== input.expectedSize) {
      throw new Error(`Snapshot file changed during review: ${input.relativePath}`);
    }
    return { contentDigest: digest.digest("hex"), byteCount };
  } finally {
    await opened.handle.close();
  }
}

/**
 * Combines per-file content digests into the manifest digest. Both the review
 * pass and the copy pass build it from a sorted path list so the copy can verify
 * the reviewed content without a third full read of the tree.
 */
export function openKrittSnapshotDigest(
  entries: ReadonlyArray<{ readonly path: string; readonly contentDigest: string }>,
): string {
  const hash = NodeCrypto.createHash("sha256");
  for (const entry of [...entries].sort((left, right) => (left.path < right.path ? -1 : 1))) {
    hash.update(entry.path);
    hash.update("\u0000");
    hash.update(entry.contentDigest);
    hash.update("\n");
  }
  return hash.digest("hex");
}

export async function buildOpenKrittSnapshotManifest(input: {
  readonly sourceRoot: string;
  readonly maxFiles: number;
  readonly maxBytes: number;
  /**
   * When false the tree is enumerated and bounded without reading file contents.
   * The digest is then produced by the copy pass instead.
   */
  readonly hashContents?: boolean;
}): Promise<OpenKrittSnapshotManifest> {
  if (
    !Number.isInteger(input.maxFiles) ||
    input.maxFiles < 1 ||
    !Number.isInteger(input.maxBytes) ||
    input.maxBytes < 1
  ) {
    throw new Error("Snapshot file and byte limits must be positive integers.");
  }
  const root = NodePath.resolve(input.sourceRoot);
  const hashContents = input.hashContents ?? true;
  const includedPaths: string[] = [];
  const excludedPaths = new Set<string>();
  const digestEntries: Array<{ readonly path: string; readonly contentDigest: string }> = [];
  let byteCount = 0;
  let traversedEntryCount = 0;

  const visit = async (relativeDirectory: string): Promise<void> => {
    const absoluteDirectory =
      relativeDirectory.length === 0 ? root : NodePath.join(root, relativeDirectory);
    const entries: NodeFS.Dirent[] = [];
    const directory = await NodeFSP.opendir(absoluteDirectory);
    for await (const entry of directory) {
      traversedEntryCount += 1;
      if (traversedEntryCount > input.maxFiles) {
        throw new Error("Snapshot entry limit exceeded.");
      }
      entries.push(entry);
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath =
        relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
      validateOpenKrittSnapshotPath(root, relativePath);
      if (isOpenKrittSnapshotExcluded(relativePath)) {
        // Record the full path so the confirmation surface reports exactly what
        // was withheld. Collapsing to the first segment previously claimed a
        // whole top-level directory was excluded when only one nested file was.
        excludedPaths.add(relativePath);
        continue;
      }
      const absolutePath = NodePath.join(root, relativePath);
      const stat = await NodeFSP.lstat(absolutePath);
      // Symlinks, sockets, FIFOs and devices are excluded by default and
      // reported, not fatal: a single dev-server socket or docs alias must not
      // make the whole workspace unscannable.
      if (stat.isSymbolicLink() || !(stat.isDirectory() || stat.isFile())) {
        excludedPaths.add(relativePath);
        continue;
      }
      if (stat.isDirectory()) {
        await visit(relativePath);
        continue;
      }
      if (includedPaths.length >= input.maxFiles) throw new Error("Snapshot file limit exceeded.");
      if (byteCount + stat.size > input.maxBytes) throw new Error("Snapshot byte limit exceeded.");
      if (!hashContents) {
        byteCount += stat.size;
        includedPaths.push(relativePath);
        continue;
      }
      const hashed = await hashOpenKrittSnapshotFile({
        sourceRoot: root,
        relativePath,
        expectedSize: stat.size,
        maxBytes: input.maxBytes - byteCount,
        noFollowOpenFlag: NodeFS.constants.O_NOFOLLOW,
      });
      byteCount += hashed.byteCount;
      includedPaths.push(relativePath);
      digestEntries.push({
        path: relativePath,
        contentDigest: hashed.contentDigest,
      });
    }
  };

  await visit("");
  includedPaths.sort();
  return {
    digest: hashContents ? openKrittSnapshotDigest(digestEntries) : "",
    fileCount: includedPaths.length,
    byteCount,
    includedPaths,
    excludedPaths: [...excludedPaths].sort(),
  };
}
