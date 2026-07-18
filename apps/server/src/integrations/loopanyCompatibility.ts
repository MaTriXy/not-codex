export const LOOPANY_PROTOCOL_COMPATIBILITY = {
  version: "2026-07",
  source: {
    repository: "https://github.com/MaTriXy/loopany-platform",
    revision: "8c0abd2f8d254add2d6e2b6a15084ab317552285",
  },
  endpoints: {
    status: "/api/machine/status",
    poll: "/api/machine/poll",
    report: "/machine/report",
  },
  limits: {
    deliveries: 8,
    deliveryRoots: 64,
    taskChars: 500_000,
    workflowChars: 250_000,
    pollBodyBytes: 2 * 1024 * 1024,
    reportTextChars: 200_000,
  },
} as const;

type Fixture = {
  readonly metadata?: {
    readonly protocolVersion?: unknown;
    readonly source?: { readonly repository?: unknown; readonly revision?: unknown };
  };
  readonly endpoints?: Record<
    string,
    { readonly path?: unknown; readonly authorization?: unknown }
  >;
  readonly limits?: Record<string, unknown>;
};

function incompatible(path: string, expected: unknown, actual: unknown): never {
  throw new Error(
    `LoopAny compatibility fixture is incompatible at ${path}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}. ` +
      "Review the public protocol change, bump the protocol version and source revision together, update fixtures, then rerun live acceptance issue #14.",
  );
}

/** Validates fixture pins before behavior assertions so drift has an actionable failure. */
export function assertLoopAnyCompatibilityFixture(fixture: Fixture): void {
  const expected = LOOPANY_PROTOCOL_COMPATIBILITY;
  if (fixture.metadata?.protocolVersion !== expected.version) {
    incompatible("metadata.protocolVersion", expected.version, fixture.metadata?.protocolVersion);
  }
  if (fixture.metadata?.source?.repository !== expected.source.repository) {
    incompatible(
      "metadata.source.repository",
      expected.source.repository,
      fixture.metadata?.source?.repository,
    );
  }
  if (fixture.metadata?.source?.revision !== expected.source.revision) {
    incompatible(
      "metadata.source.revision",
      expected.source.revision,
      fixture.metadata?.source?.revision,
    );
  }
  for (const [name, path] of Object.entries(expected.endpoints)) {
    if (fixture.endpoints?.[name]?.path !== path) {
      incompatible(`endpoints.${name}.path`, path, fixture.endpoints?.[name]?.path);
    }
    if (fixture.endpoints?.[name]?.authorization !== "redacted") {
      incompatible(
        `endpoints.${name}.authorization`,
        "redacted",
        fixture.endpoints?.[name]?.authorization,
      );
    }
  }
  for (const [name, limit] of Object.entries(expected.limits)) {
    if (fixture.limits?.[name] !== limit) {
      incompatible(`limits.${name}`, limit, fixture.limits?.[name]);
    }
  }
}
