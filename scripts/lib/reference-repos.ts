export interface PackageVersionReferenceRepoRefSource {
  readonly type: "package-version";
  readonly sourcePath: string;
  readonly valuePath: ReadonlyArray<string>;
  readonly tagPrefix: string;
}

export interface FileReferenceRepoRefSource {
  readonly type: "file";
  readonly sourcePath: string;
  readonly valuePath: ReadonlyArray<string>;
  readonly tagPrefix?: string;
}

export type ReferenceRepoRefSource =
  | PackageVersionReferenceRepoRefSource
  | FileReferenceRepoRefSource;

export interface ReferenceRepo {
  readonly id: string;
  readonly prefix: string;
  readonly repository: string;
  readonly latestRef: string;
  readonly refSource: ReferenceRepoRefSource;
  readonly history: "shallow" | "full";
  readonly includeInDefaultSync: boolean;
}

export const referenceRepos: ReadonlyArray<ReferenceRepo> = [
  {
    id: "effect-smol",
    prefix: ".repos/effect-smol",
    repository: "https://github.com/Effect-TS/effect-smol.git",
    latestRef: "main",
    refSource: {
      type: "package-version",
      sourcePath: "pnpm-workspace.yaml",
      valuePath: ["catalog", "effect"],
      tagPrefix: "effect@",
    },
    history: "shallow",
    includeInDefaultSync: true,
  },
  {
    id: "alchemy-effect",
    prefix: ".repos/alchemy-effect",
    repository: "https://github.com/alchemy-run/alchemy-effect.git",
    latestRef: "main",
    refSource: {
      type: "package-version",
      sourcePath: "infra/relay/package.json",
      valuePath: ["dependencies", "alchemy"],
      tagPrefix: "v",
    },
    history: "shallow",
    includeInDefaultSync: true,
  },
  {
    id: "t3code-upstream",
    prefix: ".repos/t3code-upstream",
    repository: "https://github.com/pingdotgg/t3code.git",
    latestRef: "main",
    refSource: {
      type: "file",
      sourcePath: "docs/upstream/t3code-sync.json",
      valuePath: ["lastAudited", "sha"],
    },
    history: "full",
    includeInDefaultSync: false,
  },
];
