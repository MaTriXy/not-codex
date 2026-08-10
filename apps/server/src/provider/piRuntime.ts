import { resolveSpawnCommand } from "@notcodex/shared/shell";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { makeChildStdio, makePiRpcClient, type PiRpcClientShape } from "effect-pi-rpc/client";
import { collectStreamAsString } from "./providerSnapshot.ts";

export class PiRuntimeError extends Schema.TaggedErrorClass<PiRuntimeError>()("PiRuntimeError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface PiRuntimeProcess {
  readonly client: PiRpcClientShape;
  readonly pid: number;
  readonly exitCode: Effect.Effect<number, PiRuntimeError>;
  readonly kill: Effect.Effect<void>;
}

export interface StartPiProcessInput {
  readonly binaryPath: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface PiRuntimeShape {
  readonly start: (
    input: StartPiProcessInput,
  ) => Effect.Effect<PiRuntimeProcess, PiRuntimeError, Scope.Scope>;
  readonly runCommand: (input: StartPiProcessInput) => Effect.Effect<
    {
      readonly stdout: string;
      readonly stderr: string;
      readonly code: number;
    },
    PiRuntimeError
  >;
}

const makePiRuntime = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const runCommand: PiRuntimeShape["runCommand"] = (input) =>
    Effect.gen(function* () {
      const spawn = yield* resolveSpawnCommand(
        input.binaryPath,
        input.args,
        input.environment ? { env: input.environment, extendEnv: true } : {},
      );
      const child = yield* spawner.spawn(
        ChildProcess.make(spawn.command, spawn.args, {
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.environment ? { env: input.environment, extendEnv: true } : {}),
          shell: spawn.shell,
        }),
      );
      const [stdout, stderr, code] = yield* Effect.all(
        [collectStreamAsString(child.stdout), collectStreamAsString(child.stderr), child.exitCode],
        { concurrency: "unbounded" },
      );
      return { stdout, stderr, code: Number(code) };
    }).pipe(
      Effect.scoped,
      Effect.mapError(
        (cause) =>
          new PiRuntimeError({
            operation: "run-command",
            detail: `Failed to execute '${input.binaryPath} ${input.args.join(" ")}'.`,
            cause,
          }),
      ),
    );

  const start: PiRuntimeShape["start"] = Effect.fn("PiRuntime.start")(function* (input) {
    const scope = yield* Scope.Scope;
    const spawn = yield* resolveSpawnCommand(
      input.binaryPath,
      input.args,
      input.environment ? { env: input.environment, extendEnv: true } : {},
    ).pipe(
      Effect.mapError(
        (cause) =>
          new PiRuntimeError({
            operation: "resolve-command",
            detail: `Failed to resolve Pi command '${input.binaryPath}'.`,
            cause,
          }),
      ),
    );
    const child = yield* spawner
      .spawn(
        ChildProcess.make(spawn.command, spawn.args, {
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.environment ? { env: input.environment, extendEnv: true } : {}),
          shell: spawn.shell,
        }),
      )
      .pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.mapError(
          (cause) =>
            new PiRuntimeError({
              operation: "spawn",
              detail: `Failed to start Pi binary '${input.binaryPath}'.`,
              cause,
            }),
        ),
      );

    const client = yield* makePiRpcClient({ stdio: makeChildStdio(child) }).pipe(
      Effect.provideService(Scope.Scope, scope),
    );
    yield* child.stderr.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        chunk.trim().length > 0
          ? Effect.logDebug("Pi RPC stderr").pipe(
              Effect.annotateLogs({ pid: child.pid, detail: chunk.trim().slice(0, 4_000) }),
            )
          : Effect.void,
      ),
      Effect.ignore,
      Effect.forkIn(scope),
    );

    const exitCode = child.exitCode.pipe(
      Effect.map(Number),
      Effect.mapError(
        (cause) =>
          new PiRuntimeError({
            operation: "exit-code",
            detail: "Failed to read Pi process exit code.",
            cause,
          }),
      ),
    );
    const kill = child
      .kill({ killSignal: "SIGTERM", forceKillAfter: "2 seconds" })
      .pipe(Effect.asVoid, Effect.ignore);
    yield* Scope.addFinalizer(scope, kill);

    return {
      client,
      pid: Number(child.pid),
      exitCode,
      kill,
    } satisfies PiRuntimeProcess;
  });

  return { start, runCommand } satisfies PiRuntimeShape;
});

export class PiRuntime extends Context.Service<PiRuntime, PiRuntimeShape>()(
  "notcodex/provider/piRuntime",
) {}

export const PiRuntimeLive = Layer.effect(PiRuntime, makePiRuntime);
