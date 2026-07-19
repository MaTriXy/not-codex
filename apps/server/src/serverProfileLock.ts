// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - Lock acquisition is a low-level Node filesystem boundary and must also work before the Effect runtime layers start.
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { HostProcessPlatform } from "@notcodex/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const SERVER_PROFILE_LOCK_FILE = "server-profile.lock";

const LOCK_WRITE_GRACE_MS = 1_000;
const LOCK_WRITE_RETRY_MS = 25;
const SUPPORTED_PROCESS_IDENTITY_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set([
  "linux",
  "darwin",
  "win32",
]);

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

const PersistedServerProfileLock = Schema.Struct({
  version: Schema.Literal(1),
  pid: Schema.Int,
  token: Schema.String,
  startedAt: Schema.String,
  processStartToken: Schema.optional(Schema.String),
});
type PersistedServerProfileLock = typeof PersistedServerProfileLock.Type;

const PersistedServerProfileLockJson = Schema.fromJsonString(PersistedServerProfileLock);
const decodeServerProfileLock = Schema.decodeUnknownOption(PersistedServerProfileLockJson);
const encodeServerProfileLock = Schema.encodeSync(PersistedServerProfileLockJson);

export class ServerProfileInUseError extends Schema.TaggedErrorClass<ServerProfileInUseError>()(
  "ServerProfileInUseError",
  { lockPath: Schema.String, pid: Schema.Int },
) {
  override get message(): string {
    return `Not Codex is already running for this data directory (pid ${this.pid}). Stop that process or connect to it instead of starting another server.`;
  }
}

export class ServerProfileLockError extends Schema.TaggedErrorClass<ServerProfileLockError>()(
  "ServerProfileLockError",
  { operation: Schema.String, lockPath: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not ${this.operation} the Not Codex server profile lock at ${this.lockPath}.`;
  }
}

export type ServerProfileLockFailure = ServerProfileInUseError | ServerProfileLockError;

const isServerProfileInUseError = Schema.is(ServerProfileInUseError);

interface AcquiredServerProfileLock {
  readonly lockPath: string;
  readonly owner: PersistedServerProfileLock;
}

const errnoCode = (cause: unknown): string | undefined =>
  typeof cause === "object" && cause !== null && "code" in cause
    ? String((cause as { readonly code?: unknown }).code)
    : undefined;

const readProcessStartToken = async (
  platform: NodeJS.Platform,
  pid: number,
): Promise<string | undefined> => {
  try {
    if (platform === "linux") {
      const stat = await NodeFSP.readFile(`/proc/${pid}/stat`, "utf8");
      const commandEnd = stat.lastIndexOf(")");
      if (commandEnd < 0) return undefined;
      // The suffix starts at proc field 3 (state); starttime is field 22.
      const startTime = stat
        .slice(commandEnd + 2)
        .trim()
        .split(/\s+/)[19];
      return startTime === undefined ? undefined : `linux:${startTime}`;
    }
    if (platform === "darwin") {
      const { stdout } = await execFile("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
        encoding: "utf8",
      });
      const startTime = stdout.trim();
      return startTime.length === 0 ? undefined : `darwin:${startTime}`;
    }
    if (platform === "win32") {
      const { stdout } = await execFile(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
        ],
        { encoding: "utf8", windowsHide: true },
      );
      const startTime = stdout.trim();
      return /^\d+$/.test(startTime) ? `win32:${startTime}` : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

const requireProcessStartToken = async (
  platform: NodeJS.Platform,
  pid: number,
  readIdentity: ServerProfileProcessIdentityReader,
): Promise<string | undefined> => {
  const token = await readIdentity(platform, pid);
  if (token === undefined && SUPPORTED_PROCESS_IDENTITY_PLATFORMS.has(platform)) {
    throw new Error(`Could not determine the ${platform} start identity for process ${pid}.`);
  }
  return token;
};

export type ServerProfileProcessIdentityReader = (
  platform: NodeJS.Platform,
  pid: number,
) => Promise<string | undefined>;

export const ServerProfileProcessIdentity = Context.Reference<ServerProfileProcessIdentityReader>(
  "notcodex/serverProfileLock/ServerProfileProcessIdentity",
  { defaultValue: () => readProcessStartToken },
);

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return errnoCode(cause) !== "ESRCH";
  }
};

const readLockOwner = async (lockPath: string): Promise<PersistedServerProfileLock | undefined> => {
  try {
    const raw = await NodeFSP.readFile(lockPath, "utf8");
    return decodeServerProfileLock(raw).pipe((option) =>
      option._tag === "Some" ? option.value : undefined,
    );
  } catch {
    return undefined;
  }
};

const ownerStillRunning = async (
  platform: NodeJS.Platform,
  owner: PersistedServerProfileLock,
  readIdentity: ServerProfileProcessIdentityReader,
): Promise<boolean> => {
  if (!isProcessRunning(owner.pid)) return false;
  const currentStartToken = await requireProcessStartToken(platform, owner.pid, readIdentity);
  return currentStartToken === owner.processStartToken;
};

/**
 * Removes a stale lock without ever unlinking a replacement created by a
 * concurrent contender. The hard link pins the stale inode; the inode check
 * is the compare-and-swap before unlinking the public lock path.
 */
const removeStaleLockIfUnchanged = async (lockPath: string, claimToken: string): Promise<void> => {
  const claimPath = `${lockPath}.stale-${claimToken}`;
  try {
    await NodeFSP.link(lockPath, claimPath);
  } catch (cause) {
    if (errnoCode(cause) === "ENOENT") return;
    throw cause;
  }

  try {
    const [current, claimed] = await Promise.all([NodeFSP.stat(lockPath), NodeFSP.stat(claimPath)]);
    if (current.dev === claimed.dev && current.ino === claimed.ino) {
      await NodeFSP.unlink(lockPath).catch((cause) => {
        if (errnoCode(cause) !== "ENOENT") throw cause;
      });
    }
  } finally {
    await NodeFSP.unlink(claimPath).catch(() => undefined);
  }
};

const acquireLock = async (
  platform: NodeJS.Platform,
  stateDir: string,
  readIdentity: ServerProfileProcessIdentityReader,
): Promise<AcquiredServerProfileLock> => {
  const lockPath = NodePath.join(stateDir, SERVER_PROFILE_LOCK_FILE);
  const processStartToken = await requireProcessStartToken(platform, process.pid, readIdentity);
  const owner: PersistedServerProfileLock = {
    version: 1,
    pid: process.pid,
    token: NodeCrypto.randomUUID(),
    startedAt: new Date().toISOString(),
    ...(processStartToken !== undefined ? { processStartToken } : {}),
  };

  while (true) {
    try {
      await NodeFSP.writeFile(lockPath, `${encodeServerProfileLock(owner)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return { lockPath, owner };
    } catch (cause) {
      if (errnoCode(cause) !== "EEXIST") throw cause;
    }

    const existing = await readLockOwner(lockPath);
    if (existing !== undefined) {
      if (await ownerStillRunning(platform, existing, readIdentity)) {
        throw new ServerProfileInUseError({ lockPath, pid: existing.pid });
      }
      await removeStaleLockIfUnchanged(lockPath, owner.token);
      continue;
    }

    // Another process may have created the file but not completed its single
    // write yet. Only reclaim malformed locks after a short grace period.
    try {
      const details = await NodeFSP.stat(lockPath);
      if (Date.now() - details.mtimeMs < LOCK_WRITE_GRACE_MS) {
        await new Promise((resolve) => setTimeout(resolve, LOCK_WRITE_RETRY_MS));
        continue;
      }
    } catch (cause) {
      if (errnoCode(cause) === "ENOENT") continue;
      throw cause;
    }
    await removeStaleLockIfUnchanged(lockPath, owner.token);
  }
};

const releaseLock = async (lock: AcquiredServerProfileLock): Promise<void> => {
  const current = await readLockOwner(lock.lockPath);
  if (current?.token !== lock.owner.token) return;
  await NodeFSP.unlink(lock.lockPath).catch((cause) => {
    if (errnoCode(cause) !== "ENOENT") throw cause;
  });
};

/**
 * Holds an exclusive, process-wide lease for one server data profile until
 * the surrounding Effect scope closes. This must be acquired before any
 * database, scheduler, or HTTP runtime layers are started.
 */
export const acquireServerProfileLock = Effect.fn("server.profile_lock.acquire")(function* (
  stateDir: string,
) {
  const platform = yield* HostProcessPlatform;
  const readProcessIdentity = yield* ServerProfileProcessIdentity;
  const lockPath = NodePath.join(stateDir, SERVER_PROFILE_LOCK_FILE);
  return yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => acquireLock(platform, stateDir, readProcessIdentity),
      catch: (cause) =>
        isServerProfileInUseError(cause)
          ? cause
          : new ServerProfileLockError({ operation: "acquire", lockPath, cause }),
    }),
    (lock) =>
      Effect.tryPromise({
        try: () => releaseLock(lock),
        catch: (cause) => new ServerProfileLockError({ operation: "release", lockPath, cause }),
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning(error.message).pipe(Effect.annotateLogs({ lockPath, cause: error })),
        ),
      ),
  );
});
