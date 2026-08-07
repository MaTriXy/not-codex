import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ServerSettingsError,
  type ServerSettings,
} from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { OPEN_KRITT_BEARER_TOKEN_SECRET_NAME } from "../openKrittSecret.ts";
import { OpenKrittConnector, OpenKrittConnectorLive } from "./OpenKrittConnector.ts";

it.effect("restores the prior bearer token when settings persistence fails", () => {
  let token: Uint8Array | null = new TextEncoder().encode("prior-token");
  const settings: ServerSettings = {
    ...DEFAULT_SERVER_SETTINGS,
    integrations: {
      ...DEFAULT_SERVER_SETTINGS.integrations,
      openKritt: {
        ...DEFAULT_SERVER_SETTINGS.integrations.openKritt,
        authMode: "bearer",
      },
    },
  };
  const settingsFailure = new ServerSettingsError({
    settingsPath: "<test>",
    operation: "write-file",
    cause: new Error("simulated persistence failure"),
  });
  const layer = OpenKrittConnectorLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          ServerSettingsService,
          ServerSettingsService.of({
            start: Effect.void,
            ready: Effect.void,
            getSettings: Effect.succeed(settings),
            updateSettings: () => Effect.fail(settingsFailure),
            streamChanges: Stream.empty,
            subscribeChanges: Effect.never,
          }),
        ),
        Layer.succeed(
          ServerSecretStore,
          ServerSecretStore.of({
            get: (name) =>
              Effect.sync(() =>
                name === OPEN_KRITT_BEARER_TOKEN_SECRET_NAME && token !== null
                  ? Option.some(Uint8Array.from(token))
                  : Option.none(),
              ),
            set: (_name, value) => Effect.sync(() => void (token = Uint8Array.from(value))),
            create: (_name, value) => Effect.sync(() => void (token = Uint8Array.from(value))),
            getOrCreateRandom: () => Effect.die("not used"),
            remove: () => Effect.sync(() => void (token = null)),
          }),
        ),
      ),
    ),
  );

  return Effect.gen(function* () {
    const connector = yield* OpenKrittConnector;
    const exit = yield* Effect.exit(
      connector.configure({ settings: { enabled: false }, token: "replacement-token" }),
    );
    assert.equal(exit._tag, "Failure");
    assert.equal(new TextDecoder().decode(token!), "prior-token");
  }).pipe(Effect.provide(layer));
});
