import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  acquireServerProfileLock,
  SERVER_PROFILE_LOCK_FILE,
  ServerProfileInUseError,
  ServerProfileProcessIdentity,
} from "./serverProfileLock.ts";

const withTempStateDir = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeTempDirectoryScoped({ prefix: "notcodex-profile-lock-" });
});

const TestServerProfileLockJson = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    pid: Schema.Int,
    token: Schema.String,
    startedAt: Schema.String,
  }),
);
const encodeTestServerProfileLock = Schema.encodeSync(TestServerProfileLockJson);
const provideTestProcessIdentity = Effect.provideService(
  ServerProfileProcessIdentity,
  async (platform, pid) => `${platform}:test-start-${pid}`,
);

describe("serverProfileLock", () => {
  it.effect("prevents a second server from using the same profile", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stateDir = yield* withTempStateDir;
        yield* acquireServerProfileLock(stateDir);

        const error = yield* Effect.scoped(acquireServerProfileLock(stateDir)).pipe(Effect.flip);
        assert.instanceOf(error, ServerProfileInUseError);
        assert.equal(error.pid, process.pid);
      }),
    ).pipe(provideTestProcessIdentity, Effect.provide(NodeServices.layer)),
  );

  it.effect("reclaims a stale lock left by a dead process", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* withTempStateDir;
        const lockPath = path.join(stateDir, SERVER_PROFILE_LOCK_FILE);
        yield* fs.writeFileString(
          lockPath,
          `${encodeTestServerProfileLock({
            version: 1,
            pid: 2_147_483_647,
            token: "stale-owner",
            startedAt: "2026-01-01T00:00:00.000Z",
          })}\n`,
        );

        yield* Effect.scoped(acquireServerProfileLock(stateDir));
        assert.isFalse(yield* fs.exists(lockPath));
      }),
    ).pipe(provideTestProcessIdentity, Effect.provide(NodeServices.layer)),
  );

  it.effect("reclaims a tokenless lock after a PID has been reused", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* withTempStateDir;
        const lockPath = path.join(stateDir, SERVER_PROFILE_LOCK_FILE);
        yield* fs.writeFileString(
          lockPath,
          `${encodeTestServerProfileLock({
            version: 1,
            pid: process.pid,
            token: "legacy-owner-with-reused-pid",
            startedAt: "2026-01-01T00:00:00.000Z",
          })}\n`,
        );

        yield* Effect.scoped(acquireServerProfileLock(stateDir));
        assert.isFalse(yield* fs.exists(lockPath));
      }),
    ).pipe(provideTestProcessIdentity, Effect.provide(NodeServices.layer)),
  );

  it.effect("removes its lock when the owning scope closes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* withTempStateDir;
        const lockPath = path.join(stateDir, SERVER_PROFILE_LOCK_FILE);

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* acquireServerProfileLock(stateDir);
            assert.isTrue(yield* fs.exists(lockPath));
          }),
        );
        assert.isFalse(yield* fs.exists(lockPath));
      }),
    ).pipe(provideTestProcessIdentity, Effect.provide(NodeServices.layer)),
  );

  it.effect("does not remove a replacement lock owned by another server", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* withTempStateDir;
        const lockPath = path.join(stateDir, SERVER_PROFILE_LOCK_FILE);
        const replacement = `${encodeTestServerProfileLock({
          version: 1,
          pid: process.pid,
          token: "replacement-owner",
          startedAt: "2026-01-01T00:00:00.000Z",
        })}\n`;

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* acquireServerProfileLock(stateDir);
            yield* fs.writeFileString(lockPath, replacement);
          }),
        );
        assert.equal(yield* fs.readFileString(lockPath), replacement);
      }),
    ).pipe(provideTestProcessIdentity, Effect.provide(NodeServices.layer)),
  );
});
