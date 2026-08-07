export const OPEN_KRITT_PROTOCOL_COMPATIBILITY = {
  version: "open-kritt-v1.2.0",
  source: {
    repository: "https://github.com/Kritt-ai/open-kritt",
    revision: "dabd3d5f82e759bf783955ecc245fea3a984cd38",
  },
  license: "AGPL-3.0",
  /**
   * How this baseline was established. `partially-live-verified` means the
   * request and response shapes below were captured from a running Open Kritt
   * v1.2.0 deployment at the pinned revision and cross-read against that
   * revision's `backend/src` route, validation, and serialization code — but
   * the coverage is deliberately partial. No provider credential was configured
   * and the engine service was not running, so the `running`/`post_processing`/
   * `completed` lifecycle and the real vulnerability payload shape were NOT
   * observed; finding serialization came from a seeded acceptance record. The
   * claim is intentionally weaker than `live-verified` so no operator infers
   * that findings were proven to decode from real model output. See
   * `docs/integrations/open-kritt.md` for exactly what the acceptance run did
   * and did not exercise.
   */
  verification: "partially-live-verified",
  /**
   * Whether a live v1.2.0 deployment has been observed to preserve the reserved
   * `configuration.not_codex.request_id` marker through `GET /api/scans`.
   *
   * The marker is the only mechanism that lets a timed-out `POST /api/scans` be
   * reconciled instead of repeated, and upstream documents no idempotency key.
   * Observed true: `POST /api/scans` persists unknown `configuration` keys
   * verbatim (it spreads the submitted object and only adds `post_script_ids` /
   * `agent_skill_ids`), and both the create response and the paginated list
   * return the marker unchanged.
   */
  markerRoundTripVerified: true,
  /**
   * Whether a model-backed vulnerability scan has been observed end to end.
   *
   * Still false: the acceptance run had no provider credential and the engine
   * service was not running, so finding decode/normalization/fingerprinting were
   * exercised against a seeded acceptance record rather than real model output.
   * Flipping this to true requires re-running opt-in live acceptance against a
   * disposable repository with one known vulnerability and re-capturing the
   * `GET /api/scans/:id/vulnerabilities` and `GET /api/vulnerabilities/:id`
   * bodies into the fixture. It is deliberately machine-checkable so the gap
   * cannot be lost in prose.
   */
  modelBackedScanVerified: false,
  /** `GET /api/health` reports this exact `service` value in v1.2.0. */
  serviceIdentity: "open-kritt-backend",
  endpoints: {
    health: { method: "GET", path: "/api/health" },
    workflows: { method: "GET", path: "/api/workflows" },
    postScripts: { method: "GET", path: "/api/post-scripts" },
    agentSkills: { method: "GET", path: "/api/agent-skills" },
    severityRankers: { method: "GET", path: "/api/severity-rankers" },
    modelProviders: { method: "GET", path: "/api/model-providers" },
    modelCatalog: { method: "GET", path: "/api/model-catalog" },
    scansCreate: { method: "POST", path: "/api/scans" },
    scansList: { method: "GET", path: "/api/scans" },
    scanDetail: { method: "GET", path: "/api/scans/:id" },
    findingsList: { method: "GET", path: "/api/scans/:id/vulnerabilities" },
    findingDetail: { method: "GET", path: "/api/vulnerabilities/:id" },
    scanMutation: { method: "PATCH", path: "/api/scans/:id" },
  },
  statuses: {
    scan: [
      "pending",
      "prewarming_cache",
      "queued",
      "running",
      "post_processing",
      "paused",
      "rate_limited",
      "completed",
      "stopped",
      "failed",
    ],
    triage: ["interesting", "uninteresting", "untriaged"],
  },
  limits: {
    serverUrlChars: 4_096,
    requestBodyBytes: 262_144,
    responseBodyBytes: 1_048_576,
    collectionItems: 200,
    catalogItems: 100,
    findingsItems: 200,
    fieldChars: 16_000,
    pathChars: 4_096,
    recentDiagnosticEvents: 50,
    scanListPages: 8,
    scanPageSize: 100,
    pollConcurrency: 4,
  },
} as const;

/**
 * Whether re-POSTing an already-sent request id is permitted.
 *
 * Answering a `409 scan_launch_policy_required` is the only flow that wants to
 * reuse a request id, and it is only safe if the reserved marker is known to
 * survive upstream, because that is what makes the retry reconcile to the same
 * scan rather than start a second paid one. Returns a user-facing refusal while
 * that round trip is unverified, or `null` once it is.
 */
export function openKrittRequestIdReuseRefusal(): string | null {
  return OPEN_KRITT_PROTOCOL_COMPATIBILITY.markerRoundTripVerified
    ? null
    : "Retrying a launch-policy choice reuses the original request id, which is only safe once the reserved Open Kritt request marker is verified to survive upstream. Resubmit the scan with a new request id.";
}

type CompatibilityFixture = {
  readonly metadata?: {
    readonly connectorCompatibilityVersion?: unknown;
    readonly release?: unknown;
    readonly source?: { readonly repository?: unknown; readonly revision?: unknown };
    readonly license?: unknown;
    readonly verification?: unknown;
    readonly markerRoundTripVerified?: unknown;
    readonly modelBackedScanVerified?: unknown;
    readonly authData?: unknown;
    readonly serverVersion?: unknown;
    readonly serviceIdentity?: unknown;
  };
  readonly endpoints?: Record<
    string,
    { readonly method?: unknown; readonly path?: unknown; readonly authorization?: unknown }
  >;
  readonly statuses?: { readonly scan?: unknown; readonly triage?: unknown };
  readonly limits?: Record<string, unknown>;
};

function incompatible(path: string, expected: unknown, actual: unknown): never {
  throw new Error(
    `Open Kritt compatibility fixture is incompatible at ${path}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}. ` +
      "Review the pinned upstream revision, update the fixture and compatibility version, then rerun live acceptance.",
  );
}

/** Fail closed when a fixture is copied from a different upstream revision. */
export function assertOpenKrittCompatibilityFixture(fixture: CompatibilityFixture): void {
  const expected = OPEN_KRITT_PROTOCOL_COMPATIBILITY;
  if (fixture.metadata?.connectorCompatibilityVersion !== expected.version) {
    incompatible(
      "metadata.connectorCompatibilityVersion",
      expected.version,
      fixture.metadata?.connectorCompatibilityVersion,
    );
  }
  if (fixture.metadata?.release !== "v1.2.0") {
    incompatible("metadata.release", "v1.2.0", fixture.metadata?.release);
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
  if (fixture.metadata?.license !== expected.license) {
    incompatible("metadata.license", expected.license, fixture.metadata?.license);
  }
  if (fixture.metadata?.verification !== expected.verification) {
    incompatible("metadata.verification", expected.verification, fixture.metadata?.verification);
  }
  if (fixture.metadata?.markerRoundTripVerified !== expected.markerRoundTripVerified) {
    incompatible(
      "metadata.markerRoundTripVerified",
      expected.markerRoundTripVerified,
      fixture.metadata?.markerRoundTripVerified,
    );
  }
  if (fixture.metadata?.modelBackedScanVerified !== expected.modelBackedScanVerified) {
    incompatible(
      "metadata.modelBackedScanVerified",
      expected.modelBackedScanVerified,
      fixture.metadata?.modelBackedScanVerified,
    );
  }
  if (fixture.metadata?.authData !== "synthetic-and-redacted") {
    incompatible("metadata.authData", "synthetic-and-redacted", fixture.metadata?.authData);
  }
  if (fixture.metadata?.serviceIdentity !== expected.serviceIdentity) {
    incompatible(
      "metadata.serviceIdentity",
      expected.serviceIdentity,
      fixture.metadata?.serviceIdentity,
    );
  }
  if (fixture.metadata?.serverVersion !== null) {
    incompatible("metadata.serverVersion", null, fixture.metadata?.serverVersion);
  }

  for (const [name, endpoint] of Object.entries(expected.endpoints)) {
    const actual = fixture.endpoints?.[name];
    if (actual?.method !== endpoint.method)
      incompatible(`endpoints.${name}.method`, endpoint.method, actual?.method);
    if (actual?.path !== endpoint.path)
      incompatible(`endpoints.${name}.path`, endpoint.path, actual?.path);
    if (actual?.authorization !== "redacted") {
      incompatible(`endpoints.${name}.authorization`, "redacted", actual?.authorization);
    }
  }
  if (
    Object.keys(fixture.endpoints ?? {}).join(",") !== Object.keys(expected.endpoints).join(",")
  ) {
    incompatible(
      "endpoints",
      Object.keys(expected.endpoints),
      Object.keys(fixture.endpoints ?? {}),
    );
  }
  if (JSON.stringify(fixture.statuses?.scan) !== JSON.stringify(expected.statuses.scan)) {
    incompatible("statuses.scan", expected.statuses.scan, fixture.statuses?.scan);
  }
  if (JSON.stringify(fixture.statuses?.triage) !== JSON.stringify(expected.statuses.triage)) {
    incompatible("statuses.triage", expected.statuses.triage, fixture.statuses?.triage);
  }
  for (const [name, limit] of Object.entries(expected.limits)) {
    if (fixture.limits?.[name] !== limit)
      incompatible(`limits.${name}`, limit, fixture.limits?.[name]);
  }
}
