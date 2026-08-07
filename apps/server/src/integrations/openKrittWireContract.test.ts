/**
 * Regression coverage for the v1.2.0 wire contract as it was actually observed,
 * rather than as the public documentation reads. Each case pins one shape that
 * differs from the documented/assumed form and would otherwise fail only on
 * first contact with a real installation:
 *
 * - health reports `open-kritt-backend`, not `open-kritt`;
 * - catalogs are bare arrays, providers are `{ providers: [id] }`, and models
 *   come from a separate `/api/model-catalog`;
 * - `GET /api/scans/:id/vulnerabilities` is unpaginated and returns a bare array;
 * - a finding carries no revision, so it is attributed from its scan;
 * - `PATCH /api/scans/:id` takes `{ status }`, not `{ action }`.
 */
// @effect-diagnostics preferSchemaOverJson:off
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { layerTest as serverSettingsLayerTest } from "../serverSettings.ts";
import compatibilityFixture from "./fixtures/open-kritt-v1.2.0.json" with { type: "json" };
import {
  OpenKrittConnector,
  OpenKrittConnectorLive,
  OpenKrittTestFetch,
} from "./Services/OpenKrittConnector.ts";
import {
  findingResponse,
  FULL_COMMIT_SHA,
  launchConfiguration,
  OPEN_KRITT_REQUEST_ID,
  OPEN_KRITT_TEST_URL,
  scanResponse,
} from "./test/openKrittTestFixtures.ts";

const responses = compatibilityFixture.responses;

interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Routes by `METHOD /path`, ignoring the query string. */
function makeLayer(
  routes: Readonly<Record<string, (call: RecordedCall) => Response>>,
  recorded: Array<RecordedCall>,
) {
  return OpenKrittConnectorLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        serverSettingsLayerTest({
          openKritt: { enabled: true, serverUrl: OPEN_KRITT_TEST_URL, authMode: "none" },
        }),
        ServerSecretStore.layer.pipe(
          Layer.provide(
            ServerConfig.layerTest(process.cwd(), { prefix: "notcodex-open-kritt-wire-" }),
          ),
        ),
        Layer.succeed(OpenKrittTestFetch, (input, init) => {
          const url = new URL(String(input));
          const call: RecordedCall = {
            method: (init?.method ?? "GET").toUpperCase(),
            path: url.pathname,
            search: url.search,
            body: init?.body === undefined ? null : JSON.parse(String(init.body)),
          };
          recorded.push(call);
          const route = routes[`${call.method} ${call.path}`];
          return Promise.resolve(
            route === undefined ? json({ error: "unregistered route" }, 500) : route(call),
          );
        }),
      ),
    ),
  );
}

const CATALOG_ROUTES = {
  "GET /api/health": () => json(responses.health),
  "GET /api/workflows": () => json(responses.workflows),
  "GET /api/post-scripts": () => json(responses.postScripts),
  "GET /api/agent-skills": () => json(responses.agentSkills),
  "GET /api/severity-rankers": () => json(responses.severityRankers),
  "GET /api/model-providers": () => json(responses.modelProviders),
  "GET /api/model-catalog": () => json(responses.modelCatalog),
} as const;

it.layer(NodeServices.layer)("Open Kritt v1.2.0 wire contract", (it) => {
  it.effect("accepts the live health identity and rejects a look-alike service", () =>
    Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const ok = yield* connector.testConnection;
      assert.isTrue(ok.ok);
      assert.equal(ok.diagnostics.health, "healthy");
    }).pipe(Effect.provide(makeLayer(CATALOG_ROUTES, []))),
  );

  it.effect("fails the connection test when the endpoint is not an Open Kritt backend", () =>
    Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const exit = yield* Effect.exit(connector.testConnection);
      assert.equal(exit._tag, "Failure");
    }).pipe(
      Effect.provide(
        makeLayer({ "GET /api/health": () => json({ status: "ok", service: "open-kritt" }) }, []),
      ),
    ),
  );

  it.effect("assembles the catalog from the six discovery endpoints", () => {
    const recorded: Array<RecordedCall> = [];
    return Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const catalog = yield* connector.refreshCatalog;

      assert.deepEqual(recorded.map((call) => call.path).sort(), [
        "/api/agent-skills",
        "/api/model-catalog",
        "/api/model-providers",
        "/api/post-scripts",
        "/api/severity-rankers",
        "/api/workflows",
      ]);
      assert.equal(catalog.workflows[0]?.id, responses.workflows[0]!.id);
      // Models come from the catalog endpoint; the providers endpoint is only ids.
      assert.deepEqual(
        catalog.modelProviders.map((provider) => provider.id),
        [...responses.modelProviders.providers],
      );
      // A launch needs the ranker body, so discovery must carry it.
      assert.isString(catalog.severityRankers[0]?.content);
    }).pipe(Effect.provide(makeLayer(CATALOG_ROUTES, recorded)));
  });

  it.effect("controls a scan with the upstream status transition, never an action verb", () => {
    const recorded: Array<RecordedCall> = [];
    return Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const result = yield* connector.controlScan({ scanId: scanResponse.id, action: "pause" });

      assert.equal(result.upstreamStatus, "paused");
      const patch = recorded.find((call) => call.method === "PATCH");
      assert.deepEqual(patch?.body, { status: "paused" });
    }).pipe(
      Effect.provide(
        makeLayer(
          {
            [`GET /api/scans/${scanResponse.id}`]: () => json(scanResponse),
            [`PATCH /api/scans/${scanResponse.id}`]: () =>
              json({ ...scanResponse, status: "paused" }),
          },
          recorded,
        ),
      ),
    );
  });

  it.effect("refuses a control transition upstream would answer with a 500", () => {
    const recorded: Array<RecordedCall> = [];
    return Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const exit = yield* Effect.exit(
        connector.controlScan({ scanId: scanResponse.id, action: "pause" }),
      );

      assert.equal(exit._tag, "Failure");
      // Nothing was sent: the refusal happens before the request.
      assert.isUndefined(recorded.find((call) => call.method === "PATCH"));
    }).pipe(
      Effect.provide(
        makeLayer(
          {
            [`GET /api/scans/${scanResponse.id}`]: () =>
              json({ ...scanResponse, status: "queued" }),
          },
          recorded,
        ),
      ),
    );
  });

  it.effect(
    "reads the unpaginated findings array and attributes it to the scanned revision",
    () => {
      const recorded: Array<RecordedCall> = [];
      return Effect.gen(function* () {
        const connector = yield* OpenKrittConnector;
        const result = yield* connector.listFindings({
          scanId: scanResponse.id,
          limit: 100,
          cursor: null,
          includeDuplicates: false,
        });

        assert.lengthOf(result.items, 1);
        // Upstream returns everything at once, so a cursor would loop forever.
        assert.equal(result.nextCursor, null);
        assert.equal(result.items[0]?.source.commitSha, scanResponse.commitSha);
        assert.equal(result.items[0]?.severity, "high");
        const findings = recorded.find((call) => call.path.endsWith("/vulnerabilities"));
        assert.equal(findings?.search, "");
      }).pipe(
        Effect.provide(
          makeLayer(
            {
              [`GET /api/scans/${scanResponse.id}`]: () => json(scanResponse),
              [`GET /api/scans/${scanResponse.id}/vulnerabilities`]: () => json([findingResponse]),
            },
            recorded,
          ),
        ),
      );
    },
  );

  it.effect("pages a caller-truncated unpaginated findings array without losing findings", () => {
    const recorded: Array<RecordedCall> = [];
    return Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const result = yield* connector.listFindings({
        scanId: scanResponse.id,
        limit: 1,
        cursor: null,
        includeDuplicates: false,
      });

      assert.lengthOf(result.items, 1);
      assert.equal(result.nextCursor, "offset:1");
      assert.isFalse(result.stale);

      const second = yield* connector.listFindings({
        scanId: scanResponse.id,
        limit: 1,
        cursor: result.nextCursor,
        includeDuplicates: false,
      });
      assert.equal(second.items[0]?.id, "finding-open-kritt-second");
      assert.equal(second.nextCursor, null);
      assert.isFalse(second.stale);
    }).pipe(
      Effect.provide(
        makeLayer(
          {
            [`GET /api/scans/${scanResponse.id}`]: () => json(scanResponse),
            [`GET /api/scans/${scanResponse.id}/vulnerabilities`]: () =>
              json([findingResponse, { ...findingResponse, id: "finding-open-kritt-second" }]),
          },
          recorded,
        ),
      ),
    );
  });

  it.effect("asks upstream for duplicates only when the user opted in", () => {
    const recorded: Array<RecordedCall> = [];
    return Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      yield* connector.listFindings({
        scanId: scanResponse.id,
        limit: 100,
        cursor: null,
        includeDuplicates: true,
      });

      const findings = recorded.find((call) => call.path.endsWith("/vulnerabilities"));
      assert.equal(findings?.search, "?includeDuplicates=1");
    }).pipe(
      Effect.provide(
        makeLayer(
          {
            [`GET /api/scans/${scanResponse.id}`]: () => json(scanResponse),
            [`GET /api/scans/${scanResponse.id}/vulnerabilities`]: () => json([findingResponse]),
          },
          recorded,
        ),
      ),
    );
  });

  it.effect("rejects a malformed local finding cursor", () =>
    Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const exit = yield* Effect.exit(
        connector.listFindings({
          scanId: scanResponse.id,
          limit: 100,
          cursor: "page:2",
          includeDuplicates: false,
        }),
      );
      assert.equal(exit._tag, "Failure");
    }).pipe(Effect.provide(makeLayer({}, []))),
  );

  it.effect("resolves the severity ranker body from the catalog before launching", () => {
    const recorded: Array<RecordedCall> = [];
    return Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const { severityRankerContent: _omitted, ...withoutContent } = launchConfiguration;
      yield* connector.launchScan({
        projectId: "project-1",
        requestId: OPEN_KRITT_REQUEST_ID,
        source: { kind: "remote", repoFull: "Kritt-ai/open-kritt", commitSha: FULL_COMMIT_SHA },
        configuration: { ...withoutContent, severityRankerId: responses.severityRankers[0]!.id },
      } as never);

      const post = recorded.find((call) => call.method === "POST");
      const body = post?.body as Record<string, unknown>;
      // Upstream stores the ruleset body on the scan; an id alone is a 422.
      assert.equal(body["severity_ranker"], responses.severityRankers[0]!.content);
      // The harness defaults from the pinned provider/harness compatibility table.
      assert.equal(body["harness"], "codex");
    }).pipe(
      Effect.provide(
        makeLayer(
          { ...CATALOG_ROUTES, "POST /api/scans": () => json(scanResponse, 201) },
          recorded,
        ),
      ),
    );
  });

  it.effect("refuses to launch when the selected ranker is gone instead of guessing", () =>
    Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const { severityRankerContent: _omitted, ...withoutContent } = launchConfiguration;
      const exit = yield* Effect.exit(
        connector.launchScan({
          projectId: "project-1",
          requestId: OPEN_KRITT_REQUEST_ID,
          source: { kind: "remote", repoFull: "Kritt-ai/open-kritt", commitSha: FULL_COMMIT_SHA },
          configuration: { ...withoutContent, severityRankerId: "does-not-exist" },
        } as never),
      );
      assert.equal(exit._tag, "Failure");
    }).pipe(
      Effect.provide(
        makeLayer({ ...CATALOG_ROUTES, "POST /api/scans": () => json(scanResponse, 201) }, []),
      ),
    ),
  );

  it.effect("refuses a finding detail that belongs to a different scan", () =>
    Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const exit = yield* Effect.exit(
        connector.getFinding({ scanId: scanResponse.id, findingId: findingResponse.id }),
      );
      assert.equal(exit._tag, "Failure");
    }).pipe(
      Effect.provide(
        makeLayer(
          {
            [`GET /api/scans/${scanResponse.id}`]: () => json(scanResponse),
            [`GET /api/vulnerabilities/${findingResponse.id}`]: () =>
              json({ ...findingResponse, scanId: "999" }),
          },
          [],
        ),
      ),
    ),
  );
});
