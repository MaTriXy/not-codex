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
  OPEN_KRITT_RECONCILE_MAX_PAGES,
  OPEN_KRITT_RECONCILE_PAGE_SIZE,
} from "./Services/OpenKrittConnector.ts";
import {
  OPEN_KRITT_REQUEST_ID,
  OPEN_KRITT_SCAN_ID,
  OPEN_KRITT_TEST_URL,
  scanResponse,
} from "./test/openKrittTestFixtures.ts";

/** A full page of scans that never carries the launch marker. */
function fillerPage(page: number) {
  return Array.from({ length: OPEN_KRITT_RECONCILE_PAGE_SIZE }, (_unused, index) => ({
    ...scanResponse,
    id: `scan-filler-${page}-${index}`,
    configuration: { not_codex: { request_id: `unrelated-${page}-${index}` } },
  }));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeConnectorLayer(fetchImpl: (url: string) => Response) {
  return OpenKrittConnectorLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        serverSettingsLayerTest({
          openKritt: { enabled: true, serverUrl: OPEN_KRITT_TEST_URL, authMode: "none" },
        }),
        ServerSecretStore.layer.pipe(
          Layer.provide(
            ServerConfig.layerTest(process.cwd(), { prefix: "notcodex-open-kritt-reconcile-" }),
          ),
        ),
        Layer.succeed(OpenKrittTestFetch, (input) =>
          Promise.resolve(fetchImpl(typeof input === "string" ? input : input.toString())),
        ),
      ),
    ),
  );
}

it.layer(NodeServices.layer)("Open Kritt bounded launch reconciliation", (it) => {
  it.effect("walks bounded scan pages until the preserved request marker is found", () =>
    Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const result = yield* connector.reconcileLaunch({ requestId: OPEN_KRITT_REQUEST_ID });

      assert.deepEqual(result, { externalScanId: OPEN_KRITT_SCAN_ID, exhausted: false });
    }).pipe(
      Effect.provide(
        makeConnectorLayer((url) => {
          const page = Number(new URL(url).searchParams.get("page") ?? "1");
          // The marker only appears on the third page: a single-page search
          // would leave this run unresolved forever on a busy installation.
          if (page < 3)
            return jsonResponse({ items: fillerPage(page), page, pageSize: 100, totalPages: 3 });
          return jsonResponse({
            page,
            pageSize: 100,
            totalPages: 3,
            items: [
              ...fillerPage(page).slice(0, 2),
              {
                ...scanResponse,
                id: OPEN_KRITT_SCAN_ID,
                configuration: { not_codex: { request_id: OPEN_KRITT_REQUEST_ID } },
              },
            ],
          });
        }),
      ),
    ),
  );

  it.effect("reports an exhausted window instead of claiming the scan does not exist", () =>
    Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const result = yield* connector.reconcileLaunch({ requestId: OPEN_KRITT_REQUEST_ID });

      // Failing closed here is deliberate: the caller must leave the run
      // waiting/unknown rather than repeating a paid POST.
      assert.deepEqual(result, { externalScanId: null, exhausted: true });
    }).pipe(
      Effect.provide(
        makeConnectorLayer((url) => {
          const page = Number(new URL(url).searchParams.get("page") ?? "1");
          assert.isAtMost(page, OPEN_KRITT_RECONCILE_MAX_PAGES);
          // `totalPages` beyond the bounded window: the search must stop at the
          // bound and report exhaustion rather than walking forever.
          return jsonResponse({ items: fillerPage(page), page, pageSize: 100, totalPages: 99 });
        }),
      ),
    ),
  );

  it.effect("stops at the last page without consuming the whole bounded window", () =>
    Effect.gen(function* () {
      const connector = yield* OpenKrittConnector;
      const result = yield* connector.reconcileLaunch({ requestId: OPEN_KRITT_REQUEST_ID });

      assert.deepEqual(result, { externalScanId: null, exhausted: false });
    }).pipe(
      Effect.provide(
        makeConnectorLayer(() =>
          jsonResponse({ items: [], page: 1, pageSize: 100, totalPages: 1 }),
        ),
      ),
    ),
  );
});
