// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics preferSchemaOverJson:off
import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { HostProcessPlatform } from "@notcodex/shared/hostProcess";

import {
  copyReviewedSnapshot,
  OpenKrittSnapshotError,
  OpenKrittSnapshotService,
  OpenKrittSnapshotServiceLive,
} from "./OpenKrittSnapshotService.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { FULL_COMMIT_SHA } from "../test/openKrittTestFixtures.ts";

const workspaceRoot = NodePath.join(NodeOS.tmpdir(), "notcodex-open-kritt-project-126");

/** Filesystem setup inside a test effect, with a typed failure channel. */
const fsAction = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new OpenKrittSnapshotError({ detail: "filesystem action failed", cause }),
  });

const prepareWorkspace = Effect.tryPromise({
  try: async () => {
    await NodeFSP.rm(workspaceRoot, { recursive: true, force: true });
    await NodeFSP.mkdir(NodePath.join(workspaceRoot, "src"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(workspaceRoot, "src", "main.ts"),
      "export const ok = true;\n",
    );
    await NodeFSP.writeFile(NodePath.join(workspaceRoot, ".env"), "DO_NOT_COPY=secret\n");
  },
  catch: (cause) => new OpenKrittSnapshotError({ detail: "workspace setup failed", cause }),
});

const cleanupWorkspace = Effect.tryPromise({
  try: () => NodeFSP.rm(workspaceRoot, { recursive: true, force: true }),
  catch: (cause) => new OpenKrittSnapshotError({ detail: "workspace cleanup failed", cause }),
}).pipe(Effect.catch(() => Effect.void));

it.layer(
  OpenKrittSnapshotServiceLive.pipe(
    Layer.provide(Layer.succeed(HostProcessPlatform, "darwin")),
    Layer.provide(
      ServerSettingsService.layerTest({
        openKritt: {
          enabled: true,
          snapshotRoot: NodeOS.tmpdir(),
        },
      }),
    ),
  ),
)("OpenKrittSnapshotService", (it) => {
  it.effect(
    "previews included/excluded paths and requires an explicit safe-for-provider confirmation",
    () =>
      Effect.gen(function* () {
        yield* prepareWorkspace;
        const service = yield* OpenKrittSnapshotService;
        const preview = yield* service.previewSnapshot({
          projectId: "project-126",
          workspaceRoot,
          sourceCommitSha: FULL_COMMIT_SHA,
        });

        assert.include(preview.includedPaths, "src/main.ts");
        assert.include(preview.excludedPaths, ".env");
        assert.isFalse(preview.confirmedSafeForProvider);
        assert.isNull(preview.snapshotId);
      }).pipe(Effect.ensuring(cleanupWorkspace)),
  );

  it.effect(
    "copies to a temporary directory, atomically renames, and submits only the opaque folder name",
    () =>
      Effect.gen(function* () {
        yield* prepareWorkspace;
        const service = yield* OpenKrittSnapshotService;
        const preview = yield* service.previewSnapshot({
          projectId: "project-126",
          workspaceRoot,
          sourceCommitSha: FULL_COMMIT_SHA,
        });
        const created = yield* service.createSnapshot({
          projectId: "project-126",
          workspaceRoot,
          sourceCommitSha: FULL_COMMIT_SHA,
          confirmSafeForProvider: true,
          acknowledgedManifestDigest: preview.manifestDigest,
        });

        assert.match(created.snapshotFolderName, /^[A-Za-z0-9_-]+$/);
        assert.isFalse(created.snapshotFolderName.includes("/"));
        assert.isFalse(created.snapshotFolderName.includes("\\"));
        assert.match(created.manifestDigest, /^[a-f0-9]{64}$/);
        assert.notInclude(JSON.stringify(created), workspaceRoot);
        yield* service.cleanupSnapshot({
          snapshotFolderName: created.snapshotFolderName,
          scanState: "succeeded",
          retainSnapshot: false,
        });
      }).pipe(Effect.ensuring(cleanupWorkspace)),
  );

  it.effect("refuses to publish a workspace that changed after the user reviewed it", () =>
    Effect.gen(function* () {
      yield* prepareWorkspace;
      const service = yield* OpenKrittSnapshotService;
      const preview = yield* service.previewSnapshot({
        projectId: "project-126",
        workspaceRoot,
        sourceCommitSha: FULL_COMMIT_SHA,
      });
      // A build step or a careless process drops an unreviewed file into the
      // workspace between preview and confirm. The user never approved
      // sending it to the model provider.
      yield* fsAction(() =>
        NodeFSP.writeFile(
          NodePath.join(workspaceRoot, "src", "unreviewed.ts"),
          "export const leaked = 'unreviewed';\n",
        ),
      );

      const outcome = yield* service
        .createSnapshot({
          projectId: "project-126",
          workspaceRoot,
          sourceCommitSha: FULL_COMMIT_SHA,
          confirmSafeForProvider: true,
          acknowledgedManifestDigest: preview.manifestDigest,
        })
        .pipe(Effect.exit);

      assert.equal(outcome._tag, "Failure");
      if (outcome._tag === "Failure") {
        const error = Cause.squash(outcome.cause);
        assert.match(error instanceof Error ? error.message : "", /changed after/i);
      }
    }).pipe(Effect.ensuring(cleanupWorkspace)),
  );

  it.effect("records the full path of a nested exclusion rather than its first segment", () =>
    Effect.gen(function* () {
      yield* prepareWorkspace;
      yield* fsAction(() =>
        NodeFSP.writeFile(NodePath.join(workspaceRoot, "src", ".env"), "NESTED=secret\n"),
      );
      const service = yield* OpenKrittSnapshotService;
      const preview = yield* service.previewSnapshot({
        projectId: "project-126",
        workspaceRoot,
        sourceCommitSha: FULL_COMMIT_SHA,
      });

      assert.include(preview.excludedPaths, "src/.env");
      assert.notInclude(preview.excludedPaths, "src");
      // The rest of src/ was included, so reporting "src" as excluded would
      // misdescribe what was sent to the model provider.
      assert.include(preview.includedPaths, "src/main.ts");
    }).pipe(Effect.ensuring(cleanupWorkspace)),
  );

  it.effect("fails closed when a reviewed file is swapped for a symlink before the copy", () =>
    Effect.gen(function* () {
      yield* prepareWorkspace;
      const outsideSecret = NodePath.join(NodeOS.tmpdir(), "notcodex-open-kritt-outside-secret");
      yield* fsAction(() => NodeFSP.writeFile(outsideSecret, "PRIVATE KEY MATERIAL\n"));
      const service = yield* OpenKrittSnapshotService;
      const preview = yield* service.previewSnapshot({
        projectId: "project-126",
        workspaceRoot,
        sourceCommitSha: FULL_COMMIT_SHA,
      });
      // Replace the reviewed regular file with a symlink to a file outside the
      // workspace. copyFile would follow it; the O_NOFOLLOW open must not.
      const reviewed = NodePath.join(workspaceRoot, "src", "main.ts");
      yield* fsAction(async () => {
        await NodeFSP.rm(reviewed);
        await NodeFSP.symlink(outsideSecret, reviewed);
      });

      // The rebuilt manifest already rejects the symlink...
      const outcome = yield* service
        .createSnapshot({
          projectId: "project-126",
          workspaceRoot,
          sourceCommitSha: FULL_COMMIT_SHA,
          confirmSafeForProvider: true,
          acknowledgedManifestDigest: preview.manifestDigest,
        })
        .pipe(Effect.exit);
      assert.equal(outcome._tag, "Failure");

      // ...and so does the copy itself, which is the window a concurrent swap
      // during publication would otherwise open.
      const copyTarget = yield* fsAction(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "notcodex-open-kritt-copy-")),
      );
      const copyOutcome = yield* Effect.tryPromise({
        try: () =>
          copyReviewedSnapshot(
            workspaceRoot,
            copyTarget,
            {
              digest: preview.manifestDigest,
              fileCount: preview.fileCount,
              byteCount: preview.byteCount,
              includedPaths: preview.includedPaths,
              excludedPaths: preview.excludedPaths,
            },
            {
              platform: "darwin",
              noFollowOpenFlag: NodeFS.constants.O_NOFOLLOW,
            },
          ),
        catch: (cause) => new OpenKrittSnapshotError({ detail: "copy failed", cause }),
      }).pipe(Effect.exit);
      assert.equal(copyOutcome._tag, "Failure");
      const copied = yield* fsAction(() =>
        NodeFSP.readFile(NodePath.join(copyTarget, "src", "main.ts"), "utf8").catch(() => null),
      );
      assert.isNull(copied);

      yield* fsAction(() => NodeFSP.rm(copyTarget, { recursive: true, force: true }));
      yield* fsAction(() => NodeFSP.rm(outsideSecret, { force: true }));
    }).pipe(Effect.ensuring(cleanupWorkspace)),
  );

  it.effect("fails closed when a reviewed file's ancestor is swapped for a symlink", () =>
    Effect.gen(function* () {
      yield* prepareWorkspace;
      const outside = yield* fsAction(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "notcodex-open-kritt-outside-dir-")),
      );
      yield* fsAction(() =>
        NodeFSP.writeFile(NodePath.join(outside, "main.ts"), "export const secret = true;\n"),
      );
      const originalDirectory = NodePath.join(workspaceRoot, "src-original");
      yield* fsAction(async () => {
        await NodeFSP.rename(NodePath.join(workspaceRoot, "src"), originalDirectory);
        await NodeFSP.symlink(outside, NodePath.join(workspaceRoot, "src"), "dir");
      });
      const copyTarget = yield* fsAction(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "notcodex-open-kritt-copy-")),
      );

      const outcome = yield* Effect.tryPromise({
        try: () =>
          copyReviewedSnapshot(
            workspaceRoot,
            copyTarget,
            {
              digest: "a".repeat(64),
              fileCount: 1,
              byteCount: 24,
              includedPaths: ["src/main.ts"],
              excludedPaths: [],
            },
            { platform: "darwin", noFollowOpenFlag: NodeFS.constants.O_NOFOLLOW },
          ),
        catch: (cause) => new OpenKrittSnapshotError({ detail: "copy failed", cause }),
      }).pipe(Effect.exit);

      assert.equal(outcome._tag, "Failure");
      const copied = yield* fsAction(() =>
        NodeFSP.readFile(NodePath.join(copyTarget, "src", "main.ts"), "utf8").catch(() => null),
      );
      assert.isNull(copied);
      yield* fsAction(() => NodeFSP.rm(copyTarget, { recursive: true, force: true }));
      yield* fsAction(() => NodeFSP.rm(NodePath.join(workspaceRoot, "src"), { force: true }));
      yield* fsAction(() => NodeFSP.rename(originalDirectory, NodePath.join(workspaceRoot, "src")));
      yield* fsAction(() => NodeFSP.rm(outside, { recursive: true, force: true }));
    }).pipe(Effect.ensuring(cleanupWorkspace)),
  );

  it.effect(
    "fails closed when the platform cannot open snapshot files without following links",
    () =>
      Effect.gen(function* () {
        yield* prepareWorkspace;
        const copyTarget = yield* fsAction(() =>
          NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "notcodex-open-kritt-copy-")),
        );
        const outcome = yield* Effect.tryPromise({
          try: () =>
            copyReviewedSnapshot(
              workspaceRoot,
              copyTarget,
              {
                digest: "a".repeat(64),
                fileCount: 1,
                byteCount: 24,
                includedPaths: ["src/main.ts"],
                excludedPaths: [".env"],
              },
              { platform: "win32", noFollowOpenFlag: 0 },
            ),
          catch: (cause) => new OpenKrittSnapshotError({ detail: "copy failed", cause }),
        }).pipe(Effect.exit);

        assert.equal(outcome._tag, "Failure");
        const copied = yield* fsAction(() =>
          NodeFSP.readFile(NodePath.join(copyTarget, "src", "main.ts"), "utf8").catch(() => null),
        );
        assert.isNull(copied);
        yield* fsAction(() => NodeFSP.rm(copyTarget, { recursive: true, force: true }));
      }).pipe(Effect.ensuring(cleanupWorkspace)),
  );

  it.effect(
    "retains debugging snapshots only when explicitly requested and cleans terminal snapshots",
    () =>
      Effect.gen(function* () {
        const service = yield* OpenKrittSnapshotService;
        const retained = yield* service.cleanupSnapshot({
          snapshotFolderName: "snapshot-retained",
          scanState: "succeeded",
          retainSnapshot: true,
        });
        const removed = yield* service.cleanupSnapshot({
          snapshotFolderName: "snapshot-remove",
          scanState: "succeeded",
          retainSnapshot: false,
        });

        assert.equal(retained.action, "retained");
        assert.equal(removed.action, "removed");
      }),
  );

  it.effect("reclaims only owned temporary and unregistered published snapshot folders", () =>
    Effect.gen(function* () {
      const service = yield* OpenKrittSnapshotService;
      const root = NodeOS.tmpdir();
      const registered = `nc126-${"a".repeat(32)}`;
      const orphan = `nc126-${"b".repeat(32)}`;
      const temporary = ".notcodex-open-kritt-snapshot-test-orphan";
      const unrelated = "notcodex-unrelated-folder";
      for (const name of [registered, orphan, temporary, unrelated]) {
        yield* fsAction(() => NodeFSP.mkdir(NodePath.join(root, name), { recursive: true }));
      }
      yield* TestClock.setTime(240_000);
      const nowMillis = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
      const oldSeconds = (nowMillis - 120_000) / 1_000;
      for (const name of [orphan, temporary]) {
        yield* fsAction(() => NodeFSP.utimes(NodePath.join(root, name), oldSeconds, oldSeconds));
      }
      const result = yield* service.reconcileOwnedSnapshots({
        registeredFolderNames: [registered],
      });
      assert.sameMembers([...result.removed], [orphan, temporary]);
      assert.isTrue(
        yield* fsAction(() => NodeFSP.stat(NodePath.join(root, registered)).then(() => true)),
      );
      assert.isTrue(
        yield* fsAction(() => NodeFSP.stat(NodePath.join(root, unrelated)).then(() => true)),
      );
      yield* fsAction(() =>
        NodeFSP.rm(NodePath.join(root, registered), { recursive: true, force: true }),
      );
      yield* fsAction(() =>
        NodeFSP.rm(NodePath.join(root, unrelated), { recursive: true, force: true }),
      );
    }),
  );
});

it.effect("rejects a snapshot root inside the workspace before manifest enumeration", () => {
  const nestedRoot = NodePath.join(workspaceRoot, "snapshots");
  return Effect.gen(function* () {
    yield* prepareWorkspace;
    const service = yield* OpenKrittSnapshotService;
    const outcome = yield* service
      .previewSnapshot({
        projectId: "project-126",
        workspaceRoot,
        sourceCommitSha: FULL_COMMIT_SHA,
      })
      .pipe(Effect.exit);
    assert.equal(outcome._tag, "Failure");
    assert.isFalse(
      yield* fsAction(() =>
        NodeFSP.stat(nestedRoot)
          .then(() => true)
          .catch(() => false),
      ),
    );
  }).pipe(
    Effect.ensuring(cleanupWorkspace),
    Effect.provide(
      OpenKrittSnapshotServiceLive.pipe(
        Layer.provide(Layer.succeed(HostProcessPlatform, "darwin")),
        Layer.provide(
          ServerSettingsService.layerTest({
            openKritt: { enabled: true, snapshotRoot: nestedRoot },
          }),
        ),
      ),
    ),
  );
});
