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
  collectCommitPaths,
  countPathOverlap,
  findMissingCommitDispositions,
  parseNameStatusPaths,
  parseUpstreamGitLog,
  renderT3CodeUpstreamAudit,
  translateUpstreamPath,
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
      "NC-COMMIT",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "fix: preserve sessions",
      "",
      "\nM",
      "apps/server/src/session.ts",
      "A",
      "packages/contracts/src/session.ts",
      "A",
      "@@legal-path.ts",
      "NC-COMMIT",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "feat(web): add control",
      "",
      "\nM",
      "apps/web/src/control.tsx",
      "",
    ].join("\0"),
  );

  assert.deepStrictEqual(commits, [
    {
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      subject: "fix: preserve sessions",
      paths: ["apps/server/src/session.ts", "packages/contracts/src/session.ts", "@@legal-path.ts"],
      areas: ["contracts", "root-and-tooling", "server"],
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

it("translates renamed upstream paths before calculating overlap", () => {
  const mappings = [
    {
      upstreamPrefix: "oxlint-plugin-t3code/",
      localPrefix: "oxlint-plugin-notcodex/",
    },
    {
      upstreamPrefix: "oxlint-plugin-t3code/rules/",
      localPrefix: "oxlint-plugin-notcodex/custom-rules/",
    },
  ];

  assert.equal(
    translateUpstreamPath("oxlint-plugin-t3code/rules/session.ts", mappings),
    "oxlint-plugin-notcodex/custom-rules/session.ts",
  );
  assert.equal(
    countPathOverlap(
      ["oxlint-plugin-t3code/rules/session.ts", "README.md"],
      [
        "oxlint-plugin-t3code/rules/session.ts",
        "oxlint-plugin-notcodex/custom-rules/session.ts",
        "README.md",
      ],
      mappings,
    ),
    2,
  );
});

it("preserves both sides of upstream renames and copies", () => {
  assert.deepStrictEqual(
    parseNameStatusPaths(
      [
        "M",
        "apps/server/src/session.ts",
        "R100",
        "assets/logo\nlegacy.png",
        "packages/shared/logo.png",
        "C087",
        "docs/guide.md",
        "docs/copied\tguide.md",
        "D",
        "apps/web/src/removed.tsx",
        "",
      ].join("\0"),
    ),
    [
      "apps/server/src/session.ts",
      "apps/web/src/removed.tsx",
      "assets/logo\nlegacy.png",
      "docs/copied\tguide.md",
      "docs/guide.md",
      "packages/shared/logo.png",
    ],
  );
});

it("finds audited commits missing from the disposition ledger", () => {
  assert.deepStrictEqual(
    findMissingCommitDispositions(
      ["classified", "missing-two", "missing-one", "missing-one"],
      [{ sha: "classified" }],
    ),
    ["missing-one", "missing-two"],
  );
});

it("collects paths touched anywhere in the audit window", () => {
  assert.deepStrictEqual(
    collectCommitPaths([
      { paths: ["assets/restored.png", "apps/server/src/session.ts"] },
      { paths: ["assets/restored.png", "assets/copied.png"] },
    ]),
    ["apps/server/src/session.ts", "assets/copied.png", "assets/restored.png"],
  );
});

it.layer(NodeServices.layer)("audit-t3code-upstream", (it) => {
  it.effect("builds a report from the pinned range without changing the ledger", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-audit-" });
      const upstreamDir = path.join(rootDir, ".repos", "t3code-upstream");
      const statePath = path.join(rootDir, "docs", "upstream", "t3code-sync.json");
      const unclassifiedCommitSha = "1111111111111111111111111111111111111111";
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
        pathMappings: [
          {
            upstreamPrefix: "oxlint-plugin-t3code/",
            localPrefix: "oxlint-plugin-notcodex/",
          },
        ],
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
          if (joined === "rev-parse --verify refs/remotes/origin/main^{commit}") {
            return Effect.succeed(mockHandle({ stdout: "upstream-head\n" }));
          }
          if (joined === "rev-parse HEAD") {
            return Effect.succeed(
              mockHandle({
                stdout: child.options.cwd === upstreamDir ? "unrelated-head\n" : "local-head\n",
              }),
            );
          }
          if (joined.startsWith("log ")) {
            return Effect.succeed(
              mockHandle({
                stdout: [
                  "NC-COMMIT",
                  unclassifiedCommitSha,
                  "fix(server): preserve sessions",
                  "",
                  "\nM",
                  "apps/server/src/session.ts",
                  "R100",
                  "assets/old-logo.png",
                  "packages/shared/logo.png",
                  "R100",
                  "oxlint-plugin-t3code/old-rule.ts",
                  "oxlint-plugin-t3code/rule.ts",
                  "C100",
                  "assets/copy-source.png",
                  "packages/shared/copied-logo.png",
                  "M",
                  "assets/restored.png",
                  "NC-COMMIT",
                  "commit-two",
                  "chore: update icon",
                  "A",
                  "assets/icon.png",
                  "M",
                  "assets/restored.png",
                  "",
                ].join("\0"),
              }),
            );
          }
          if (
            joined === "diff --name-status --find-renames --find-copies-harder -z baseline..HEAD"
          ) {
            return Effect.succeed(
              mockHandle({
                stdout: [
                  "M",
                  "apps/server/src/session.ts",
                  "M",
                  "README.md",
                  "R100",
                  "oxlint-plugin-notcodex/old-rule.ts",
                  "oxlint-plugin-notcodex/rule.ts",
                  "",
                ].join("\0"),
              }),
            );
          }
          if (
            joined ===
            "diff --name-status --find-renames --find-copies-harder -z local-import..HEAD"
          ) {
            return Effect.succeed(
              mockHandle({
                stdout: [
                  "M",
                  "apps/server/src/session.ts",
                  "R100",
                  "oxlint-plugin-notcodex/old-rule.ts",
                  "oxlint-plugin-notcodex/rule.ts",
                  "",
                ].join("\0"),
              }),
            );
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
      assert.equal(report.changedPathCount, 9);
      assert.equal(report.baselinePathOverlapCount, 3);
      assert.equal(report.postImportPathOverlapCount, 3);
      assert.equal(report.mergeConflictCount, 2);
      assert.deepStrictEqual(report.protectedPathChanges, [
        "assets/copy-source.png",
        "assets/icon.png",
        "assets/old-logo.png",
        "assets/restored.png",
      ]);
      assert.deepStrictEqual(report.areaCommitCounts, {
        assets: 2,
        "root-and-tooling": 1,
        server: 1,
        shared: 1,
      });
      assert.equal(report.commits[1]?.disposition, "reject");
      const renderedReport = renderT3CodeUpstreamAudit(report);
      assert.include(renderedReport, "Unclassified commits: 1");
      assert.include(renderedReport, `\`${unclassifiedCommitSha}\``);
      assert.equal(yield* fs.readFileString(statePath), serializedState);
      assert.ok(
        commands.some(({ args }) =>
          args.includes("refs/remotes/origin/main:refs/notcodex/upstream/t3code/audit"),
        ),
      );
      assert.isFalse(
        commands.some(
          ({ cwd, args }) => cwd === upstreamDir && args.join(" ") === "rev-parse HEAD",
        ),
      );
      assert.ok(
        commands.some(
          ({ cwd, args }) =>
            cwd === upstreamDir &&
            args.includes("--diff-merges=first-parent") &&
            args.includes("--find-copies-harder"),
        ),
      );
    }),
  );
});
