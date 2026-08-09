import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export const SERVICE_RESTART_HANDOFF_MARKER_FILE = ".service-restart-handoff";

const markerPath = (path: Path.Path, baseDir: string) =>
  path.join(baseDir, "runtime", SERVICE_RESTART_HANDOFF_MARKER_FILE);

/**
 * Mark a deliberate service replacement before signalling the running server.
 * Its shutdown finalizer keeps the provisioned tunnel for the replacement.
 */
export const markServiceRestartHandoff = Effect.fn("cloud.service_lifecycle.mark_handoff")(
  function* (baseDir: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const runtimeDir = path.join(baseDir, "runtime");
    yield* fs.makeDirectory(runtimeDir, { recursive: true });
    yield* fs.writeFileString(markerPath(path, baseDir), "", { mode: 0o600 });
  },
);

/** A replacement server consumes the marker once it owns the profile. */
export const clearServiceRestartHandoff = Effect.fn("cloud.service_lifecycle.clear_handoff")(
  function* (baseDir: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.remove(markerPath(path, baseDir), { force: true });
  },
);

export const serviceRestartHandoffExists = Effect.fn("cloud.service_lifecycle.handoff_exists")(
  function* (baseDir: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs.exists(markerPath(path, baseDir)).pipe(Effect.orElseSucceed(() => false));
  },
);
