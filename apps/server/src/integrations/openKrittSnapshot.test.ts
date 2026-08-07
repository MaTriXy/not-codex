// @effect-diagnostics nodeBuiltinImport:off
import { afterEach, describe, expect, it } from "vite-plus/test";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  buildOpenKrittSnapshotManifest,
  hashOpenKrittSnapshotFile,
  isOpenKrittSnapshotExcluded,
  openKrittSnapshotDigest,
  validateOpenKrittSnapshotPath,
} from "./openKrittSnapshot.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root !== undefined) await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

async function makeFixtureRoot(): Promise<string> {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "notcodex-open-kritt-"));
  temporaryRoots.push(root);
  await NodeFSP.mkdir(NodePath.join(root, "src"), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(root, "src", "safe.ts"), "export const safe = true;\n");
  await NodeFSP.writeFile(NodePath.join(root, ".env"), "SECRET=must-not-cross-boundary\n");
  await NodeFSP.mkdir(NodePath.join(root, ".git"));
  await NodeFSP.writeFile(NodePath.join(root, ".git", "config"), "credential=secret\n");
  await NodeFSP.mkdir(NodePath.join(root, "node_modules"));
  await NodeFSP.writeFile(NodePath.join(root, "node_modules", "ignored.js"), "ignored\n");
  return root;
}

describe("Open Kritt immutable local snapshots", () => {
  it("rejects traversal, absolute paths, symlinks, special files, and paths outside the source root", () => {
    const root = "/srv/notcodex/project";
    expect(validateOpenKrittSnapshotPath(root, "src/file.ts")).toEqual({
      relativePath: "src/file.ts",
    });
    for (const value of [
      "../outside.txt",
      "src/../../outside.txt",
      "/etc/passwd",
      "\\\\server\\share\\file",
      "src/link/../../outside",
    ]) {
      expect(() => validateOpenKrittSnapshotPath(root, value)).toThrow();
    }
  });

  it.each([
    ".git/config",
    ".notcodex/state.sqlite",
    "node_modules/package/index.js",
    ".turbo/cache.json",
    "dist/bundle.js",
    ".env",
    ".env.local",
    "id_rsa",
    "credentials.json",
    "src/.npmrc",
    ".env.development",
    ".env.staging",
    "apps/server/.env.test.local",
    ".git-credentials",
    ".netrc",
    "_netrc",
    ".pgpass",
    ".htpasswd",
    "config/id_ecdsa",
    "config/id_ecdsa_sk",
    "config/id_ed25519_sk",
    ".yarnrc.yml",
    "deploy/credentials",
    "deploy/credentials.yaml",
    "certs/server.pfx",
    "certs/release.jks",
    "certs/debug.keystore",
    "certs/AuthKey.p8",
    "keys/pubring.asc",
    "keys/secret.gpg",
    "vault/passwords.kdbx",
    ".ssh/known_hosts",
    ".aws/config",
    ".gnupg/pubring.kbx",
    ".kube/config",
    ".docker/config.json",
  ])("excludes sensitive or generated path %s", (relativePath) => {
    expect(isOpenKrittSnapshotExcluded(relativePath)).toBe(true);
  });

  it.each(["src/environment.ts", "docs/netrc.md", "src/keystore.ts", "README.md"])(
    "keeps ordinary source path %s",
    (relativePath) => {
      expect(isOpenKrittSnapshotExcluded(relativePath)).toBe(false);
    },
  );

  it("copies only regular reviewed files and records bounded manifest metadata", async () => {
    const root = await makeFixtureRoot();
    const manifest = await buildOpenKrittSnapshotManifest({
      sourceRoot: root,
      maxFiles: 100,
      maxBytes: 100_000,
    });

    expect(manifest.fileCount).toBe(1);
    expect(manifest.byteCount).toBeGreaterThan(0);
    expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.includedPaths).toEqual(["src/safe.ts"]);
    expect(manifest.excludedPaths).toEqual(
      expect.arrayContaining([".git", ".env", "node_modules"]),
    );
    expect(JSON.stringify(manifest)).not.toContain("SECRET=");
  });

  it("fails closed on file-count and byte limits before a partial snapshot is accepted", async () => {
    const root = await makeFixtureRoot();
    await NodeFSP.writeFile(NodePath.join(root, "src", "large.txt"), "x".repeat(101));

    await expect(
      buildOpenKrittSnapshotManifest({ sourceRoot: root, maxFiles: 1, maxBytes: 100_000 }),
    ).rejects.toThrow(/file|limit/i);
    await expect(
      buildOpenKrittSnapshotManifest({ sourceRoot: root, maxFiles: 100, maxBytes: 100 }),
    ).rejects.toThrow(/byte|limit/i);
  });

  it("bounds excluded entries before accumulating their manifest paths", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "notcodex-kritt-excluded-"));
    temporaryRoots.push(root);
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        NodeFSP.writeFile(NodePath.join(root, `.env.${index}`), "SECRET=value\n"),
      ),
    );

    await expect(
      buildOpenKrittSnapshotManifest({ sourceRoot: root, maxFiles: 3, maxBytes: 100_000 }),
    ).rejects.toThrow(/entry|limit/i);
  });

  it("hashes through a bounded no-follow descriptor when a reviewed file changes", async () => {
    const root = await makeFixtureRoot();
    const relativePath = "src/growing.ts";
    const contents = "x".repeat(1024 * 1024);
    await NodeFSP.writeFile(NodePath.join(root, relativePath), contents);

    // A replacement between enumeration and open is rejected from descriptor
    // metadata before its body is read.
    await expect(
      hashOpenKrittSnapshotFile({
        sourceRoot: root,
        relativePath,
        expectedSize: 1,
        maxBytes: 16,
        noFollowOpenFlag: NodeFS.constants.O_NOFOLLOW,
      }),
    ).rejects.toThrow(/changed/i);
    // Growth after descriptor stat is detected with one bounded extra byte,
    // never a whole-file allocation.
    await expect(
      hashOpenKrittSnapshotFile({
        sourceRoot: root,
        relativePath,
        expectedSize: contents.length,
        maxBytes: 16,
        noFollowOpenFlag: NodeFS.constants.O_NOFOLLOW,
      }),
    ).rejects.toThrow(/byte limit/i);
  });

  it("excludes symlinks and special files instead of aborting the whole snapshot", async () => {
    const root = await makeFixtureRoot();
    await NodeFSP.symlink("/etc/passwd", NodePath.join(root, "src", "race.ts"));

    const manifest = await buildOpenKrittSnapshotManifest({
      sourceRoot: root,
      maxFiles: 100,
      maxBytes: 100_000,
    });

    expect(manifest.includedPaths).toEqual(["src/safe.ts"]);
    expect(manifest.excludedPaths).toContain("src/race.ts");
    expect(JSON.stringify(manifest)).not.toContain("/etc/passwd");
  });

  it("enumerates without hashing when the copy pass produces the digest", async () => {
    const root = await makeFixtureRoot();
    const hashed = await buildOpenKrittSnapshotManifest({
      sourceRoot: root,
      maxFiles: 100,
      maxBytes: 100_000,
    });
    const planned = await buildOpenKrittSnapshotManifest({
      sourceRoot: root,
      maxFiles: 100,
      maxBytes: 100_000,
      hashContents: false,
    });

    expect(planned.includedPaths).toEqual(hashed.includedPaths);
    expect(planned.byteCount).toBe(hashed.byteCount);
    expect(planned.digest).toBe("");
  });

  it("derives the manifest digest from sorted path and content digests", async () => {
    const root = await makeFixtureRoot();
    const manifest = await buildOpenKrittSnapshotManifest({
      sourceRoot: root,
      maxFiles: 100,
      maxBytes: 100_000,
    });
    const contents = await NodeFSP.readFile(NodePath.join(root, "src", "safe.ts"));

    expect(manifest.digest).toBe(
      openKrittSnapshotDigest([
        {
          path: "src/safe.ts",
          contentDigest: NodeCrypto.createHash("sha256").update(contents).digest("hex"),
        },
      ]),
    );
  });
});
