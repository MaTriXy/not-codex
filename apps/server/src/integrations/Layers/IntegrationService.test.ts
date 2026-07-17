import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { FetchHttpClient } from "effect/unstable/http";
import { describe, expect, it } from "vite-plus/test";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { IntegrationService } from "../Services/IntegrationService.ts";
import { MonkeyLoopyService } from "../Services/MonkeyLoopyService.ts";
import { IntegrationServiceLive } from "./IntegrationService.ts";

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
    Layer.provide(Layer.succeed(ServerSecretStore, secrets)),
    Layer.provide(ServerSettingsService.layerTest()),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      Layer.succeed(
        MonkeyLoopyService,
        MonkeyLoopyService.of({
          validate: () => Effect.die("unused"),
          run: () => Effect.die("unused"),
        }),
      ),
    ),
  );
}

describe("IntegrationService", () => {
  it("stores the LoopAny token separately and only exposes configured state", async () => {
    const result = await Effect.runPromise(
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
        return { configured, listed: yield* integrations.list };
      }).pipe(Effect.provide(makeTestLayer())),
    );

    expect(result.configured.settings.serverUrl).toBe("https://loop.example");
    expect(result.configured.tokenConfigured).toBe(true);
    expect(JSON.stringify(result)).not.toContain("device-secret");
    const loopAny = result.listed.integrations.find((item) => item.id === "loopany");
    expect(loopAny?.tokenConfigured).toBe(true);
    expect(loopAny?.state).toBe("disconnected");
  });

  it("rejects enabling LoopAny without an allowed root", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const integrations = yield* IntegrationService;
        return yield* integrations
          .configureLoopAny({
            settings: { enabled: true, serverUrl: "https://loop.example" },
            token: "device-secret",
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(makeTestLayer())),
    );

    expect(error.code).toBe("invalid-config");
    expect(error.message).toContain("allowed project root");
  });
});
