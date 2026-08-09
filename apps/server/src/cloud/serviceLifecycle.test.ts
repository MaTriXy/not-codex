import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  clearServiceRestartHandoff,
  markServiceRestartHandoff,
  serviceRestartHandoffExists,
} from "./serviceLifecycle.ts";

it.effect("persists and consumes a service restart handoff", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "notcodex-service-handoff-" });

    assert.isFalse(yield* serviceRestartHandoffExists(baseDir));
    yield* markServiceRestartHandoff(baseDir);
    assert.isTrue(yield* serviceRestartHandoffExists(baseDir));
    yield* clearServiceRestartHandoff(baseDir);
    assert.isFalse(yield* serviceRestartHandoffExists(baseDir));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("clearing an absent handoff is idempotent", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "notcodex-service-handoff-" });
    yield* clearServiceRestartHandoff(baseDir);
    assert.isFalse(yield* serviceRestartHandoffExists(baseDir));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
