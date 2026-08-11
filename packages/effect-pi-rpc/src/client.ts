import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import {
  PiRpcProtocolError,
  PiRpcRequestError,
  PiRpcTransportError,
  type PiRpcError,
} from "./errors.ts";
import type { PiRpcCommand, PiRpcEvent, PiRpcResponse } from "./schema.ts";

const MAX_LINE_BYTES = 16 * 1024 * 1024;
const encoder = new TextEncoder();
const encodeJsonString = Schema.encodeUnknownEffect(Schema.UnknownFromJsonString);
const decodeJsonString = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString);
const isPiRpcProtocolError = Schema.is(PiRpcProtocolError);
const isPiRpcTransportError = Schema.is(PiRpcTransportError);

interface PendingRequest {
  readonly command: string;
  readonly deferred: Deferred.Deferred<PiRpcResponse, PiRpcError>;
}

export interface PiRpcClientShape {
  readonly events: Stream.Stream<PiRpcEvent, PiRpcError>;
  readonly request: (command: PiRpcCommand) => Effect.Effect<PiRpcResponse, PiRpcError>;
  readonly notify: (command: PiRpcCommand) => Effect.Effect<void, PiRpcError>;
}

export interface PiRpcClientOptions {
  readonly stdio: Stdio.Stdio;
  readonly maxLineBytes?: number;
}

function encodeCommand(command: PiRpcCommand): Effect.Effect<string, PiRpcProtocolError> {
  return encodeJsonString(command).pipe(
    Effect.map((encoded) => `${encoded}\n`),
    Effect.mapError(
      (cause) =>
        new PiRpcProtocolError({
          detail: `Failed to encode Pi RPC command '${command.type}'.`,
          cause,
        }),
    ),
  );
}

function decodeIncoming(
  value: unknown,
  line: string,
): Effect.Effect<PiRpcEvent | PiRpcResponse, PiRpcProtocolError> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return Effect.fail(
      new PiRpcProtocolError({ detail: "Pi RPC payload must be an object.", line }),
    );
  }
  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string" || record.type.length === 0) {
    return Effect.fail(
      new PiRpcProtocolError({ detail: "Pi RPC payload is missing a string type.", line }),
    );
  }
  if (record.type !== "response") {
    return Effect.succeed(record as PiRpcEvent);
  }
  if (
    typeof record.command !== "string" ||
    typeof record.success !== "boolean" ||
    (record.id !== undefined && typeof record.id !== "string") ||
    (record.error !== undefined && typeof record.error !== "string")
  ) {
    return Effect.fail(
      new PiRpcProtocolError({ detail: "Pi RPC response has an invalid envelope.", line }),
    );
  }
  return Effect.succeed(record as PiRpcResponse);
}

export const makePiRpcClient = Effect.fn("makePiRpcClient")(function* (
  options: PiRpcClientOptions,
): Effect.fn.Return<PiRpcClientShape, never, Scope.Scope> {
  const scope = yield* Scope.Scope;
  const events = yield* Queue.unbounded<PiRpcEvent, PiRpcError | Cause.Done<void>>();
  const outgoing = yield* Queue.unbounded<string, Cause.Done<void>>();
  const pending = yield* Ref.make(new Map<string, PendingRequest>());
  const nextId = yield* Ref.make(0);
  const carry = yield* Ref.make("");
  const maxLineBytes = options.maxLineBytes ?? MAX_LINE_BYTES;

  const failAll = (error: PiRpcError) =>
    Ref.getAndSet(pending, new Map()).pipe(
      Effect.flatMap((requests) =>
        Effect.forEach(requests.values(), ({ deferred }) => Deferred.fail(deferred, error), {
          discard: true,
        }),
      ),
    );

  const dispatchLine = Effect.fn("PiRpcClient.dispatchLine")(function* (line: string) {
    if (encoder.encode(line).byteLength > maxLineBytes) {
      return yield* new PiRpcProtocolError({
        detail: `Pi RPC record exceeded the ${maxLineBytes}-byte limit.`,
      });
    }
    const parsed = yield* decodeJsonString(line).pipe(
      Effect.mapError(
        (cause) => new PiRpcProtocolError({ detail: "Pi RPC emitted invalid JSON.", line, cause }),
      ),
    );
    const incoming = yield* decodeIncoming(parsed, line);
    if (incoming.type === "response" && incoming.id) {
      const response = incoming as PiRpcResponse;
      const request = yield* Ref.modify(pending, (requests) => {
        const found = requests.get(response.id!);
        if (!found) return [undefined, requests] as const;
        const next = new Map(requests);
        next.delete(response.id!);
        return [found, next] as const;
      });
      if (request) {
        yield* Deferred.succeed(request.deferred, response);
        return;
      }
    }
    yield* Queue.offer(events, incoming as PiRpcEvent);
  });

  const consumeChunk = Effect.fn("PiRpcClient.consumeChunk")(function* (chunk: string) {
    const combined = `${yield* Ref.get(carry)}${chunk}`;
    let start = 0;
    for (;;) {
      const newline = combined.indexOf("\n", start);
      if (newline === -1) break;
      const line = combined.slice(start, newline);
      start = newline + 1;
      if (line.length > 0) yield* dispatchLine(line);
    }
    const remainder = combined.slice(start);
    if (encoder.encode(remainder).byteLength > maxLineBytes) {
      return yield* new PiRpcProtocolError({
        detail: `Pi RPC partial record exceeded the ${maxLineBytes}-byte limit.`,
      });
    }
    yield* Ref.set(carry, remainder);
  });

  const writer = yield* Stream.fromQueue(outgoing).pipe(
    Stream.encodeText,
    Stream.run(options.stdio.stdout()),
    Effect.mapError(
      (cause) =>
        new PiRpcTransportError({
          operation: "write-stdin",
          detail: "Failed to write to Pi RPC stdin.",
          cause,
        }),
    ),
    Effect.onError((cause) =>
      failAll(
        new PiRpcTransportError({
          operation: "write-stdin",
          detail: "Pi RPC stdin writer terminated.",
          cause,
        }),
      ),
    ),
    Effect.forkIn(scope),
  );

  const readerEffect = options.stdio.stdin.pipe(
    Stream.decodeText(),
    Stream.runForEach(consumeChunk),
    Effect.mapError((cause) =>
      isPiRpcProtocolError(cause)
        ? cause
        : new PiRpcTransportError({
            operation: "read-stdout",
            detail: "Failed to read Pi RPC stdout.",
            cause,
          }),
    ),
  );
  const reader = yield* readerEffect.pipe(
    Effect.matchCauseEffect({
      onFailure: (cause) => {
        const squashed = Cause.squash(cause);
        const error =
          isPiRpcProtocolError(squashed) || isPiRpcTransportError(squashed)
            ? squashed
            : new PiRpcTransportError({
                operation: "read-stdout",
                detail: "Pi RPC stdout reader terminated.",
                cause: squashed,
              });
        return Queue.fail(events, error).pipe(Effect.andThen(failAll(error)));
      },
      onSuccess: () => {
        return Effect.gen(function* () {
          const remainder = yield* Ref.get(carry);
          if (remainder.length > 0) {
            const error = new PiRpcProtocolError({
              detail: "Pi RPC stdout closed with an unterminated JSONL record.",
              line: remainder,
            });
            yield* Queue.fail(events, error);
            yield* failAll(error);
            return;
          }
          const error = new PiRpcTransportError({
            operation: "read-stdout",
            detail: "Pi RPC stdout closed.",
          });
          yield* failAll(error);
          yield* Queue.end(events);
        });
      },
    }),
    Effect.forkIn(scope),
  );

  yield* Scope.addFinalizer(
    scope,
    Effect.all(
      [Fiber.interrupt(writer), Fiber.interrupt(reader), Queue.end(outgoing), Queue.end(events)],
      {
        discard: true,
      },
    ).pipe(
      Effect.andThen(
        failAll(
          new PiRpcTransportError({
            operation: "shutdown",
            detail: "Pi RPC client scope closed.",
          }),
        ),
      ),
      Effect.ignore,
    ),
  );

  const notify: PiRpcClientShape["notify"] = Effect.fn("PiRpcClient.notify")(function* (command) {
    const encoded = yield* encodeCommand(command);
    yield* Queue.offer(outgoing, encoded).pipe(
      Effect.mapError(
        (cause) =>
          new PiRpcTransportError({
            operation: "queue-command",
            detail: `Failed to queue Pi RPC command '${command.type}'.`,
            cause,
          }),
      ),
    );
  });

  const request: PiRpcClientShape["request"] = Effect.fn("PiRpcClient.request")(
    function* (command) {
      const id = command.id ?? `notcodex-${yield* Ref.updateAndGet(nextId, (value) => value + 1)}`;
      const deferred = yield* Deferred.make<PiRpcResponse, PiRpcError>();
      yield* Ref.update(pending, (requests) => {
        const next = new Map(requests);
        next.set(id, { command: command.type, deferred });
        return next;
      });
      yield* notify({ ...command, id }).pipe(
        Effect.onError(() =>
          Ref.update(pending, (requests) => {
            const next = new Map(requests);
            next.delete(id);
            return next;
          }),
        ),
      );
      const response = yield* Deferred.await(deferred).pipe(
        Effect.onInterrupt(() =>
          Ref.update(pending, (requests) => {
            const next = new Map(requests);
            next.delete(id);
            return next;
          }),
        ),
      );
      if (!response.success) {
        return yield* new PiRpcRequestError({
          command: response.command,
          detail: response.error ?? `Pi RPC command '${response.command}' failed.`,
          response,
        });
      }
      return response;
    },
  );

  return { events: Stream.fromQueue(events), request, notify };
});

export function makeChildStdio(handle: ChildProcessSpawner.ChildProcessHandle): Stdio.Stdio {
  return Stdio.make({
    args: Effect.succeed([]),
    stdin: handle.stdout,
    stdout: () =>
      Sink.mapInput(handle.stdin, (chunk: string | Uint8Array) =>
        typeof chunk === "string" ? encoder.encode(chunk) : chunk,
      ),
    stderr: () => Sink.drain,
  });
}
