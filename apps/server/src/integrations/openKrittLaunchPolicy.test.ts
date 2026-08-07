/**
 * A `409 scan_launch_policy_required` and a `422` are answers, not transport
 * failures. Both must reach the caller as typed outcomes against the original
 * request id, because collapsing either into an opaque error strands the launch
 * with no way forward — and because the elected retry has to reuse the marker so
 * Open Kritt reconciles it instead of starting a second paid scan.
 *
 * These cover the connector transport. Reusing the request id on the elected
 * retry is safe because the marker round trip has been observed on a live
 * v1.2.0 deployment; see `openKrittRequestIdReuseRefusal`.
 */
// @effect-diagnostics preferSchemaOverJson:off
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { layerTest as serverSettingsLayerTest } from "../serverSettings.ts";
import {
  OpenKrittConnector,
  OpenKrittConnectorLive,
  OpenKrittTestFetch,
} from "./Services/OpenKrittConnector.ts";
import {
  FULL_COMMIT_SHA,
  launchConfiguration,
  OPEN_KRITT_REQUEST_ID,
  OPEN_KRITT_SCAN_ID,
  OPEN_KRITT_TEST_URL,
  scanResponse,
} from "./test/openKrittTestFixtures.ts";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Builds a connector whose transport records every POST body, so a test can
 * assert what was actually sent upstream rather than only what came back.
 */
function makeLayer(respond: (call: number) => Response, recorded: Array<Record<string, unknown>>) {
  return OpenKrittConnectorLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        serverSettingsLayerTest({
          openKritt: { enabled: true, serverUrl: OPEN_KRITT_TEST_URL, authMode: "none" },
        }),
        ServerSecretStore.layer.pipe(
          Layer.provide(
            ServerConfig.layerTest(process.cwd(), { prefix: "notcodex-open-kritt-policy-" }),
          ),
        ),
        Layer.succeed(OpenKrittTestFetch, (_input, init) => {
          recorded.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
          return Promise.resolve(respond(recorded.length));
        }),
      ),
    ),
  );
}

const launchInput = {
  projectId: "project-1",
  requestId: OPEN_KRITT_REQUEST_ID,
  source: { kind: "remote", repoFull: "Kritt-ai/open-kritt", commitSha: FULL_COMMIT_SHA },
  configuration: launchConfiguration,
} as never;

function requestMarker(body: Record<string, unknown>): unknown {
  return (body["configuration"] as Record<string, unknown> | undefined)?.["not_codex"];
}

it.layer(NodeServices.layer)("Open Kritt launch-policy and validation outcomes", (it) => {
  it.effect("returns the offered launch-policy choices instead of an opaque error", () =>
    Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const result = yield* connector.launchScan(launchInput);

      assert.equal(result.launchResolution, "policy-required");
      // v1.2.0 states the requirement without enumerating options, so the
      // documented `SCAN_LAUNCH_POLICIES` set is what the user chooses from.
      assert.deepEqual([...result.policyChoices], ["immediate", "queue"]);
      assert.equal(result.externalScanId, null);
      assert.deepEqual([...result.fieldErrors], []);
    }).pipe(
      Effect.provide(
        makeLayer(
          () =>
            json(409, {
              error: "Another scan is running. Choose whether to start immediately or queue.",
              code: "scan_launch_policy_required",
              errors: [{ field: "launchPolicy", message: "Choose immediate or queue." }],
            }),
          [],
        ),
      ),
    ),
  );

  it.effect("sends the elected policy with the original request marker on retry", () => {
    const recorded: Array<Record<string, unknown>> = [];
    const layer = makeLayer(
      (call) =>
        call === 1
          ? json(409, {
              error: "Another scan is running.",
              code: "scan_launch_policy_required",
              errors: [{ field: "launchPolicy", message: "Choose immediate or queue." }],
            })
          : json(201, scanResponse),
      recorded,
    );
    return Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const first = yield* connector.launchScan(launchInput);
      assert.equal(first.launchResolution, "policy-required");

      const second = yield* connector.launchScan({
        ...(launchInput as object),
        launchPolicy: "immediate",
      } as never);
      assert.equal(second.launchResolution, "accepted");
      assert.equal(second.externalScanId, OPEN_KRITT_SCAN_ID);

      assert.lengthOf(recorded, 2);
      assert.isUndefined(recorded[0]?.["launchPolicy"]);
      // Verified against v1.2.0 `scanLaunchDecision`: the election is read from
      // the request root only.
      assert.equal(recorded[1]?.["launchPolicy"], "immediate");
      // Identical marker on both attempts: the elected retry reconciles to the
      // original launch and cannot become a second paid scan.
      assert.deepEqual(requestMarker(recorded[1]!), requestMarker(recorded[0]!));
      assert.deepEqual(requestMarker(recorded[0]!), { request_id: OPEN_KRITT_REQUEST_ID });
      // The election must not leak into `configuration`, which upstream stores
      // verbatim and the reconciliation search reads back.
      const secondConfiguration = recorded[1]?.["configuration"] as Record<string, unknown>;
      assert.isUndefined(secondConfiguration["launchPolicy"]);
      assert.notDeepEqual(recorded[1], recorded[0]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects a launch-policy value Open Kritt never offered", () => {
    const recorded: Array<Record<string, unknown>> = [];
    return Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const exit = yield* Effect.exit(
        connector.launchScan({
          ...(launchInput as object),
          launchPolicy: "not a policy id",
        } as never),
      );

      assert.equal(exit._tag, "Failure");
      assert.lengthOf(recorded, 0);
    }).pipe(Effect.provide(makeLayer(() => json(201, scanResponse), recorded)));
  });

  it.effect("returns bounded per-field errors rather than one flattened string", () =>
    Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const result = yield* connector.launchScan(launchInput);

      assert.equal(result.launchResolution, "rejected");
      assert.deepEqual(
        result.fieldErrors.map((error) => error.field),
        ["target.repo_full", "workflowId"],
      );
      assert.equal(result.fieldErrors[0]?.message, "A repository is required.");
    }).pipe(
      Effect.provide(
        makeLayer(
          () =>
            json(422, {
              error: "Validation failed.",
              errors: [
                { field: "target.repo_full", message: "A repository is required." },
                { field: "workflowId", message: "Workflow does not exist." },
              ],
            }),
          [],
        ),
      ),
    ),
  );
});
