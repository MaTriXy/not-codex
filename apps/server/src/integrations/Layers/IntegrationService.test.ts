import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { FetchHttpClient } from "effect/unstable/http";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { IntegrationService } from "../Services/IntegrationService.ts";
import { LoopAnyConnector } from "../Services/LoopAnyConnector.ts";
import { MonkeyLoopyService } from "../Services/MonkeyLoopyService.ts";
import { IntegrationServiceLive } from "./IntegrationService.ts";
import { IntegrationRunRepository } from "../../persistence/Services/IntegrationRunRepository.ts";

function makeTestLayer() {
  const stored = new Map<string, Uint8Array>();
  const secrets = ServerSecretStore.of({
    get: (name) => Effect.sync(() => Option.fromNullishOr(stored.get(name))),
    set: (name, value) => Effect.sync(() => void stored.set(name, value)),
    create: (name, value) => Effect.sync(() => void stored.set(name, value)),
    getOrCreateRandom: (name, bytes) =>
      Effect.sync(() => {
        const existing = stored.get(name);
        if (existing) return existing;
        const created = new Uint8Array(bytes);
        stored.set(name, created);
        return created;
      }),
    remove: (name) => Effect.sync(() => void stored.delete(name)),
  });
  return IntegrationServiceLive.pipe(
    Layer.provide(
      Layer.succeed(
        IntegrationRunRepository,
        IntegrationRunRepository.of({
          insert: () => Effect.void,
          get: () => Effect.succeed(Option.none()),
          list: () => Effect.succeed([]),
          transition: () => Effect.succeed(true),
          pruneCompletedBefore: () => Effect.succeed(0),
        }),
      ),
    ),
    Layer.provide(Layer.succeed(ServerSecretStore, secrets)),
    Layer.provide(ServerSettingsService.layerTest()),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      Layer.succeed(
        LoopAnyConnector,
        LoopAnyConnector.of({
          pollOnce: Effect.succeed(0),
          status: Effect.succeed({
            state: "disconnected",
            lastActivityAt: null,
            error: null,
            inFlight: 0,
          }),
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        MonkeyLoopyService,
        MonkeyLoopyService.of({
          getAuthoringContext: Effect.die("unused"),
          scaffold: () => Effect.die("unused"),
          infer: () => Effect.die("unused"),
          validate: () => Effect.die("unused"),
          run: () => Effect.die("unused"),
        }),
      ),
    ),
  );
}

describe("IntegrationService", () => {
  it.effect("stores the LoopAny token separately and only exposes configured state", () =>
    Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const configured = yield* integrations.configureLoopAny({
        settings: {
          enabled: true,
          serverUrl: "https://loop.example/",
          allowedRoots: ["/workspace"],
        },
        token: "device-secret",
      });
      const result = { configured, listed: yield* integrations.list };

      expect(result.configured.settings.serverUrl).toBe("https://loop.example");
      expect(result.configured.tokenConfigured).toBe(true);
      expect(result.configured).not.toHaveProperty("token");
      expect(result.configured.settings).not.toHaveProperty("token");
      const loopAny = result.listed.integrations.find((item) => item.id === "loopany");
      const monkey = result.listed.integrations.find((item) => item.id === "monkey-d-loopy");
      expect(loopAny?.tokenConfigured).toBe(true);
      expect(loopAny?.state).toBe("disconnected");
      expect(monkey?.version).toBe("0.5.0");
      expect(monkey?.capabilities).toEqual(
        expect.arrayContaining(["author", "recipes", "infer", "validate", "verify", "run"]),
      );
    }).pipe(Effect.provide(makeTestLayer())),
  );

  it.effect("rejects enabling LoopAny without an allowed root", () =>
    Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const error = yield* integrations
        .configureLoopAny({
          settings: { enabled: true, serverUrl: "https://loop.example" },
          token: "device-secret",
        })
        .pipe(Effect.flip);

      expect(error.code).toBe("invalid-config");
      expect(error.message).toContain("allowed project root");
    }).pipe(Effect.provide(makeTestLayer())),
  );

  it.effect("rejects LoopAny server URLs with embedded credentials", () =>
    Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      const error = yield* integrations
        .configureLoopAny({
          settings: { serverUrl: "https://user:password@loop.example" },
        })
        .pipe(Effect.flip);

      expect(error.code).toBe("invalid-config");
      expect(error.message).toContain("embedded credentials");
    }).pipe(Effect.provide(makeTestLayer())),
  );

  it.effect(
    "does not remove the token when an invalid enabled configuration tries to clear it",
    () =>
      Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        yield* integrations.configureLoopAny({
          settings: {
            enabled: true,
            serverUrl: "https://loop.example",
            allowedRoots: ["/workspace"],
          },
          token: "device-secret",
        });
        const error = yield* integrations
          .configureLoopAny({ settings: {}, clearToken: true })
          .pipe(Effect.flip);
        const result = { error, listed: yield* integrations.list };

        expect(result.error.code).toBe("not-configured");
        const loopAny = result.listed.integrations.find((item) => item.id === "loopany");
        expect(loopAny?.tokenConfigured).toBe(true);
      }).pipe(Effect.provide(makeTestLayer())),
  );

  it.effect("disables LoopAny before removing its saved token", () =>
    Effect.gen(function* () {
      const integrations = yield* IntegrationService;
      yield* integrations.configureLoopAny({
        settings: {
          enabled: true,
          serverUrl: "https://loop.example",
          allowedRoots: ["/workspace"],
        },
        token: "device-secret",
      });
      const cleared = yield* integrations.configureLoopAny({
        settings: { enabled: false },
        clearToken: true,
      });
      const listed = yield* integrations.list;
      const loopAny = listed.integrations.find((item) => item.id === "loopany");

      expect(cleared.settings.enabled).toBe(false);
      expect(cleared.tokenConfigured).toBe(false);
      expect(loopAny?.state).toBe("disabled");
      expect(loopAny?.tokenConfigured).toBe(false);
    }).pipe(Effect.provide(makeTestLayer())),
  );
});
