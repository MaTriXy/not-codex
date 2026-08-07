// @effect-diagnostics preferSchemaOverJson:off
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import { OPEN_KRITT_BEARER_TOKEN_SECRET_NAME } from "../integrations/openKrittSecret.ts";

const layer = ServerSecretStore.layer.pipe(
  Layer.provide(
    ServerConfig.layerTest(process.cwd(), { prefix: "notcodex-open-kritt-secret-test-" }),
  ),
);

it.layer(NodeServices.layer)("Open Kritt bearer token secret", (it) => {
  it.effect(
    "uses a dedicated hard-coded secret name and round-trips only through ServerSecretStore",
    () =>
      Effect.gen(function* () {
        const store = yield* ServerSecretStore.ServerSecretStore;
        const secret = Uint8Array.from([115, 121, 110, 116, 104, 101, 116, 105, 99]);
        yield* store.set(OPEN_KRITT_BEARER_TOKEN_SECRET_NAME, secret);
        const loaded = yield* store.get(OPEN_KRITT_BEARER_TOKEN_SECRET_NAME);

        assert.isTrue(Option.isSome(loaded));
        if (Option.isSome(loaded)) assert.deepEqual(Array.from(loaded.value), Array.from(secret));
        assert.match(OPEN_KRITT_BEARER_TOKEN_SECRET_NAME, /^open-kritt-bearer-token$/);
      }).pipe(Effect.provide(layer)),
  );

  it.effect("does not use settings/diagnostics as a token transport", () =>
    Effect.gen(function* () {
      const store = yield* ServerSecretStore.ServerSecretStore;
      const settings = { enabled: true, serverUrl: "https://kritt.example", tokenConfigured: true };
      const diagnostics = { health: "healthy", lastError: null };
      yield* store.set(OPEN_KRITT_BEARER_TOKEN_SECRET_NAME, Uint8Array.from([1, 2, 3]));
      assert.notInclude(JSON.stringify(settings), "1,2,3");
      assert.notInclude(JSON.stringify(diagnostics), "1,2,3");
      assert.notProperty(settings, "token");
    }).pipe(Effect.provide(layer)),
  );
});
