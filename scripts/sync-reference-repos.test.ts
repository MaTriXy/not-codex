import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { referenceRepos } from "./lib/reference-repos.ts";
import {
  planReferenceRepoSync,
  resolveReferenceRepoRef,
  syncReferenceRepos,
} from "./sync-reference-repos.ts";

const encoder = new TextEncoder();
const effectSmol = referenceRepos[0]!;
const alchemyEffect = referenceRepos[1]!;
const t3CodeUpstream = referenceRepos[2]!;

function mockHandle(
  options: {
    readonly exitCode?: number;
    readonly stdout?: string;
    readonly stderr?: string;
  } = {},
) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(options.exitCode ?? 0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(options.stdout ?? "done\n")),
    stderr: Stream.make(encoder.encode(options.stderr ?? "")),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function mockSpawnerLayer(
  commands: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }>,
  handle = mockHandle(),
) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const childProcess = command as unknown as {
        readonly command: string;
        readonly args: ReadonlyArray<string>;
      };
      commands.push({
        command: childProcess.command,
        args: childProcess.args,
      });
      return Effect.succeed(handle);
    }),
  );
}

it.layer(NodeServices.layer)("sync-reference-repos", (it) => {
  it.effect("resolves the effect-smol tag from the root catalog", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "sync-reference-repos-version-",
      });
      yield* fs.writeFileString(
        path.join(rootDir, "pnpm-workspace.yaml"),
        "catalog:\n  effect: 4.0.0-beta.73\n",
      );

      assert.equal(
        yield* resolveReferenceRepoRef(effectSmol, rootDir, false),
        "effect@4.0.0-beta.73",
      );
    }),
  );

  it.effect("uses the latest branch without reading package versions", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "sync-reference-repos-latest-",
      });

      assert.equal(yield* resolveReferenceRepoRef(effectSmol, rootDir, true), "main");
    }),
  );

  it.effect("preserves version source read context and the filesystem cause", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "sync-reference-repos-read-error-",
      });
      const sourcePath = path.join(rootDir, effectSmol.refSource.sourcePath);

      const error = yield* resolveReferenceRepoRef(effectSmol, rootDir, false).pipe(Effect.flip);

      if (error._tag !== "ReferenceRepoRefSourceError") {
        assert.fail(`Unexpected error: ${error._tag}`);
      }
      assert.equal(error.operation, "read");
      assert.equal(error.repoId, effectSmol.id);
      assert.equal(error.sourcePath, sourcePath);
      assert.ok(error.cause !== undefined);
      assert.ok(!error.message.includes(String((error.cause as Error).message)));
    }),
  );

  it.effect("preserves version source parse context and the schema cause", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "sync-reference-repos-parse-error-",
      });
      const sourcePath = path.join(rootDir, alchemyEffect.refSource.sourcePath);
      yield* fs.makeDirectory(path.dirname(sourcePath), { recursive: true });
      yield* fs.writeFileString(sourcePath, "{");

      const error = yield* resolveReferenceRepoRef(alchemyEffect, rootDir, false).pipe(Effect.flip);

      if (error._tag !== "ReferenceRepoRefSourceError") {
        assert.fail(`Unexpected error: ${error._tag}`);
      }
      assert.equal(error.operation, "parse");
      assert.equal(error.repoId, alchemyEffect.id);
      assert.equal(error.sourcePath, sourcePath);
      assert.ok(error.cause !== undefined);
      assert.ok(!error.message.includes(String((error.cause as Error).message)));
    }),
  );

  it.effect("reports the unresolved package path without inventing a cause", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "sync-reference-repos-resolution-error-",
      });
      const sourcePath = path.join(rootDir, alchemyEffect.refSource.sourcePath);
      yield* fs.makeDirectory(path.dirname(sourcePath), { recursive: true });
      yield* fs.writeFileString(sourcePath, '{"dependencies":{}}');

      const error = yield* resolveReferenceRepoRef(alchemyEffect, rootDir, false).pipe(Effect.flip);

      if (error._tag !== "ReferenceRepoRefResolutionError") {
        assert.fail(`Unexpected error: ${error._tag}`);
      }
      assert.equal(error.repoId, alchemyEffect.id);
      assert.equal(error.sourcePath, sourcePath);
      assert.deepStrictEqual(error.valuePath, ["dependencies", "alchemy"]);
      assert.ok(!("cause" in error));
    }),
  );

  it.effect("resolves the alchemy-effect tag from the relay package", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "sync-reference-repos-alchemy-version-",
      });
      yield* fs.makeDirectory(path.join(rootDir, "infra", "relay"), { recursive: true });
      yield* fs.writeFileString(
        path.join(rootDir, "infra", "relay", "package.json"),
        '{"dependencies":{"alchemy":"2.0.0-beta.49"}}',
      );

      assert.equal(yield* resolveReferenceRepoRef(alchemyEffect, rootDir, false), "v2.0.0-beta.49");
    }),
  );

  it.effect("resolves the pinned T3 Code ref from the upstream ledger", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "sync-reference-repos-t3code-ref-",
      });
      const sourcePath = path.join(rootDir, t3CodeUpstream.refSource.sourcePath);
      yield* fs.makeDirectory(path.dirname(sourcePath), { recursive: true });
      yield* fs.writeFileString(sourcePath, '{"lastAudited":{"sha":"ecb35f7"}}');

      assert.equal(yield* resolveReferenceRepoRef(t3CodeUpstream, rootDir, false), "ecb35f7");
      assert.equal(yield* resolveReferenceRepoRef(t3CodeUpstream, rootDir, true), "main");
    }),
  );

  it.effect("plans a full-history T3 Code clone for upstream auditing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "sync-reference-repos-t3code-plan-",
      });
      const sourcePath = path.join(rootDir, t3CodeUpstream.refSource.sourcePath);
      yield* fs.makeDirectory(path.dirname(sourcePath), { recursive: true });
      yield* fs.writeFileString(sourcePath, '{"lastAudited":{"sha":"ecb35f7"}}');

      const plan = yield* planReferenceRepoSync(t3CodeUpstream, rootDir, true);
      assert.deepStrictEqual(plan.commands, [
        [
          "clone",
          "--branch",
          "main",
          "https://github.com/pingdotgg/t3code.git",
          ".repos/t3code-upstream",
        ],
      ]);
    }),
  );

  it.effect("checks out a pinned T3 Code commit after cloning full history", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "sync-reference-repos-t3code-pinned-plan-",
      });
      const sourcePath = path.join(rootDir, t3CodeUpstream.refSource.sourcePath);
      yield* fs.makeDirectory(path.dirname(sourcePath), { recursive: true });
      yield* fs.writeFileString(sourcePath, '{"lastAudited":{"sha":"ecb35f7"}}');

      const plan = yield* planReferenceRepoSync(t3CodeUpstream, rootDir, false);
      assert.deepStrictEqual(plan.commands, [
        ["clone", "https://github.com/pingdotgg/t3code.git", ".repos/t3code-upstream"],
        ["-C", ".repos/t3code-upstream", "checkout", "--detach", "ecb35f7"],
      ]);
    }),
  );

  it.effect("plans a clone for a missing reference and an update for an existing clone", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "sync-reference-repos-plan-",
      });
      yield* fs.writeFileString(
        path.join(rootDir, "pnpm-workspace.yaml"),
        "catalog:\n  effect: 4.0.0-beta.73\n",
      );

      const addPlan = yield* planReferenceRepoSync(effectSmol, rootDir, false);
      assert.equal(addPlan.action, "clone");
      assert.deepStrictEqual(addPlan.commands, [
        [
          "clone",
          "--depth=1",
          "--branch",
          "effect@4.0.0-beta.73",
          "https://github.com/Effect-TS/effect-smol.git",
          ".repos/effect-smol",
        ],
      ]);

      yield* fs.makeDirectory(path.join(rootDir, effectSmol.prefix), { recursive: true });
      const updatePlan = yield* planReferenceRepoSync(effectSmol, rootDir, false);
      assert.equal(updatePlan.action, "update");
      assert.deepStrictEqual(updatePlan.commands, [
        ["-C", ".repos/effect-smol", "fetch", "--depth=1", "origin", "effect@4.0.0-beta.73"],
        ["-C", ".repos/effect-smol", "checkout", "--detach", "FETCH_HEAD"],
      ]);
    }),
  );

  it.effect("runs the planned local clone through the process service", () => {
    const commands: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }> = [];

    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "sync-reference-repos-run-",
      });
      yield* fs.writeFileString(
        path.join(rootDir, "pnpm-workspace.yaml"),
        "catalog:\n  effect: 4.0.0-beta.73\n",
      );

      yield* syncReferenceRepos({ rootDir, repoId: "effect-smol" }).pipe(
        Effect.provide(mockSpawnerLayer(commands)),
      );

      assert.deepStrictEqual(commands, [
        {
          command: "git",
          args: [
            "clone",
            "--depth=1",
            "--branch",
            "effect@4.0.0-beta.73",
            "https://github.com/Effect-TS/effect-smol.git",
            ".repos/effect-smol",
          ],
        },
      ]);
    });
  });

  it.effect("keeps the full-history T3 clone out of the default reference sync", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "sync-reference-repos-default-selection-",
      });
      yield* fs.writeFileString(
        path.join(rootDir, "pnpm-workspace.yaml"),
        "catalog:\n  effect: 4.0.0-beta.73\n",
      );
      yield* fs.makeDirectory(path.join(rootDir, "infra", "relay"), { recursive: true });
      yield* fs.writeFileString(
        path.join(rootDir, "infra", "relay", "package.json"),
        '{"dependencies":{"alchemy":"2.0.0-beta.49"}}',
      );

      const plans = yield* syncReferenceRepos({ rootDir, dryRun: true });
      assert.deepStrictEqual(
        plans.map((plan) => plan.repo.id),
        ["effect-smol", "alchemy-effect"],
      );
    }),
  );

  it.effect("rejects unknown repo selectors", () =>
    Effect.gen(function* () {
      const error = yield* syncReferenceRepos({
        repoId: "missing",
        dryRun: true,
      }).pipe(Effect.flip);

      if (error._tag !== "ReferenceRepoSelectionError") {
        assert.fail(`Unexpected error: ${error._tag}`);
      }
      assert.equal(error.repoId, "missing");
      assert.deepStrictEqual(error.expectedRepoIds, [
        "effect-smol",
        "alchemy-effect",
        "t3code-upstream",
      ]);
      assert.ok(!("cause" in error));
    }),
  );

  it.effect("reports non-zero git exits without retaining process output", () => {
    const commands: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }> = [];

    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootDir = yield* fs.makeTempDirectoryScoped({
        prefix: "sync-reference-repos-exit-error-",
      });
      yield* fs.writeFileString(
        path.join(rootDir, "pnpm-workspace.yaml"),
        "catalog:\n  effect: 4.0.0-beta.73\n",
      );

      const error = yield* syncReferenceRepos({ rootDir, repoId: "effect-smol" }).pipe(
        Effect.provide(
          mockSpawnerLayer(
            commands,
            mockHandle({ exitCode: 23, stderr: "clone failed secret-token-value\n" }),
          ),
        ),
        Effect.flip,
      );

      if (error._tag !== "ReferenceRepoGitError") {
        assert.fail(`Unexpected error: ${error._tag}`);
      }
      assert.equal(error.operation, "exit");
      assert.equal(error.repoId, effectSmol.id);
      assert.equal(error.action, "clone");
      assert.equal(error.repository, effectSmol.repository);
      assert.equal(error.ref, "effect@4.0.0-beta.73");
      assert.equal(error.rootDir, rootDir);
      assert.equal(error.argumentCount, commands[0]?.args.length);
      assert.equal(error.exitCode, 23);
      assert.equal(error.stdoutLength, 5);
      assert.equal(error.stderrLength, 32);
      assert.notProperty(error, "args");
      assert.notProperty(error, "stderr");
      assert.notInclude(error.message, "secret-token-value");
      assert.ok(!("cause" in error));
    });
  });
});
