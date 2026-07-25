import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  auditT3CodeUpstream,
  classifyUpstreamPath,
  parseUpstreamGitLog,
  renderT3CodeUpstreamAudit,
} from "./audit-t3code-upstream.ts";

const encoder = new TextEncoder();
const encodeUnknownJson = Schema.encodeEffect(Schema.UnknownFromJsonString);

function mockHandle(options: {
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(options.exitCode ?? 0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(options.stdout ?? "")),
    stderr: Stream.make(encoder.encode(options.stderr ?? "")),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

it("classifies paths into stable audit areas", () => {
  assert.equal(classifyUpstreamPath("apps/server/src/index.ts"), "server");
  assert.equal(classifyUpstreamPath("packages/contracts/src/index.ts"), "contracts");
  assert.equal(classifyUpstreamPath("pnpm-lock.yaml"), "root-and-tooling");
});

it("parses upstream commits, paths, and overlapping areas", () => {
  const commits = parseUpstreamGitLog(
    [
      "@@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tfix: preserve sessions",
      "",
      "apps/server/src/session.ts",
      "packages/contracts/src/session.ts",
      "@@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\tfeat(web): add control",
      "",
      "apps/web/src/control.tsx",
      "",
    ].join("\n"),
  );

  assert.deepStrictEqual(commits, [
    {
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      subject: "fix: preserve sessions",
      paths: ["apps/server/src/session.ts", "packages/contracts/src/session.ts"],
      areas: ["contracts", "server"],
      disposition: "unclassified",
    },
    {
      sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      subject: "feat(web): add control",
      paths: ["apps/web/src/control.tsx"],
      areas: ["web"],
      disposition: "unclassified",
    },
  ]);
});

it.layer(NodeServices.layer)("audit-t3code-upstream", (it) => {
  it.effect("builds a report from the pinned range without changing the ledger", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-audit-" });
      const upstreamDir = path.join(rootDir, ".repos", "t3code-upstream");
      const statePath = path.join(rootDir, "docs", "upstream", "t3code-sync.json");
      yield* fs.makeDirectory(path.dirname(statePath), { recursive: true });
      const state = {
        schemaVersion: 1,
        source: {
          repository: "https://github.com/pingdotgg/t3code.git",
          branch: "main",
        },
        importBaseline: { sha: "baseline", tag: "baseline-tag" },
        localImport: { sha: "local-import" },
        lastAudited: { sha: "baseline", tag: "baseline-tag" },
        lastIntegrated: { sha: "baseline", tag: "baseline-tag" },
        pathMappings: [],
        protectedPathPrefixes: ["assets/"],
        commitDispositions: [
          {
            sha: "commit-two",
            disposition: "reject",
            notes: "Protected upstream branding",
          },
        ],
      };
      const encodedState = yield* encodeUnknownJson(state);
      const serializedState = `${encodedState}\n`;
      yield* fs.writeFileString(statePath, serializedState);

      const commands: Array<{
        readonly cwd?: string | undefined;
        readonly args: ReadonlyArray<string>;
      }> = [];
      const spawner = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make((command) => {
          const child = command as unknown as {
            readonly args: ReadonlyArray<string>;
            readonly options: { readonly cwd?: string | undefined };
          };
          commands.push({ cwd: child.options.cwd, args: child.args });
          const joined = child.args.join(" ");
          if (joined === "remote get-url origin") {
            return Effect.succeed(
              mockHandle({ stdout: "https://github.com/pingdotgg/t3code.git\n" }),
            );
          }
          if (joined === "rev-parse HEAD") {
            return Effect.succeed(
              mockHandle({
                stdout: child.options.cwd === upstreamDir ? "upstream-head\n" : "local-head\n",
              }),
            );
          }
          if (joined.startsWith("log ")) {
            return Effect.succeed(
              mockHandle({
                stdout: [
                  "@@commit-one\tfix(server): preserve sessions",
                  "",
                  "apps/server/src/session.ts",
                  "@@commit-two\tchore: update icon",
                  "",
                  "assets/icon.png",
                  "",
                ].join("\n"),
              }),
            );
          }
          if (joined === "diff --name-only baseline..upstream-head") {
            return Effect.succeed(
              mockHandle({ stdout: "apps/server/src/session.ts\nassets/icon.png\n" }),
            );
          }
          if (joined === "diff --name-only baseline..HEAD") {
            return Effect.succeed(
              mockHandle({ stdout: "apps/server/src/session.ts\nREADME.md\n" }),
            );
          }
          if (joined === "diff --name-only local-import..HEAD") {
            return Effect.succeed(mockHandle({ stdout: "apps/server/src/session.ts\n" }));
          }
          if (joined.startsWith("merge-tree ")) {
            return Effect.succeed(
              mockHandle({
                exitCode: 1,
                stdout: "tree-id\nCONFLICT (content): first\nCONFLICT (content): second\n",
              }),
            );
          }
          return Effect.succeed(mockHandle({}));
        }),
      );

      const report = yield* auditT3CodeUpstream({ rootDir, upstreamDir, statePath }).pipe(
        Effect.provide(spawner),
      );

      assert.equal(report.commitCount, 2);
      assert.equal(report.unclassifiedCommitCount, 1);
      assert.equal(report.changedPathCount, 2);
      assert.equal(report.exactBaselinePathOverlapCount, 1);
      assert.equal(report.postImportPathOverlapCount, 1);
      assert.equal(report.mergeConflictCount, 2);
      assert.deepStrictEqual(report.protectedPathChanges, ["assets/icon.png"]);
      assert.deepStrictEqual(report.areaCommitCounts, { assets: 1, server: 1 });
      assert.equal(report.commits[1]?.disposition, "reject");
      assert.include(renderT3CodeUpstreamAudit(report), "Unclassified commits: 1");
      assert.equal(yield* fs.readFileString(statePath), serializedState);
      assert.ok(
        commands.some(({ args }) => args.includes("HEAD:refs/notcodex/upstream/t3code/audit")),
      );
    }),
  );
});
