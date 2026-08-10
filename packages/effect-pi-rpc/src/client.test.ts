import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { makePiRpcClient } from "./client.ts";
import { PiRpcProtocolError, PiRpcRequestError } from "./errors.ts";
import { makeInMemoryStdio } from "./testUtils.ts";

const encodeUnknownJson = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);
const decodeUnknownJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);
const encoder = new TextEncoder();
const isPiRpcProtocolError = Schema.is(PiRpcProtocolError);
const isPiRpcRequestError = Schema.is(PiRpcRequestError);

const encodeLine = (value: unknown) => encoder.encode(`${encodeUnknownJson(value)}\n`);

it.layer(NodeServices.layer)("PiRpcClient", (it) => {
  it.effect("correlates responses and preserves Unicode line separators", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const client = yield* makePiRpcClient({ stdio });
      const pending = yield* client.request({ type: "get_state" }).pipe(Effect.forkScoped);
      const request = decodeUnknownJson(yield* Queue.take(output)) as { id: string };
      const value = "before\u2028middle\u2029after";
      yield* Queue.offer(
        input,
        encodeLine({
          type: "response",
          id: request.id,
          command: "get_state",
          success: true,
          data: { value },
        }),
      );
      assert.deepEqual((yield* Fiber.join(pending)).data, { value });
    }),
  );

  it.effect("handles records split across arbitrary chunks", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const client = yield* makePiRpcClient({ stdio });
      const pending = yield* client.request({ type: "get_state" }).pipe(Effect.forkScoped);
      const request = decodeUnknownJson(yield* Queue.take(output)) as { id: string };
      const encoded = encodeUnknownJson({
        type: "response",
        id: request.id,
        command: "get_state",
        success: true,
        data: { ok: true },
      });
      yield* Queue.offer(input, encoder.encode(encoded.slice(0, 12)));
      yield* Queue.offer(input, encoder.encode(`${encoded.slice(12)}\n`));
      assert.deepEqual((yield* Fiber.join(pending)).data, { ok: true });
    }),
  );

  it.effect("streams unsolicited events", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const client = yield* makePiRpcClient({ stdio });
      const event = yield* client.events.pipe(Stream.runHead, Effect.forkScoped);
      yield* Queue.offer(input, encodeLine({ type: "agent_start" }));
      assert.deepEqual(yield* Fiber.join(event), Option.some({ type: "agent_start" }));
    }),
  );

  it.effect("fails unsuccessful responses with command context", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const client = yield* makePiRpcClient({ stdio });
      const pending = yield* Effect.exit(client.request({ type: "set_model" })).pipe(
        Effect.forkScoped,
      );
      const request = decodeUnknownJson(yield* Queue.take(output)) as { id: string };
      yield* Queue.offer(
        input,
        encodeLine({
          type: "response",
          id: request.id,
          command: "set_model",
          success: false,
          error: "missing model",
        }),
      );
      const exit = yield* Fiber.join(pending);
      assert.strictEqual(exit._tag, "Failure");
      if (exit._tag === "Failure") {
        const reason = exit.cause.reasons[0];
        assert.ok(reason?._tag === "Fail" && isPiRpcRequestError(reason.error));
      }
    }),
  );

  it.effect("rejects records over the configured bound", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const client = yield* makePiRpcClient({ stdio, maxLineBytes: 24 });
      const drained = yield* Effect.exit(client.events.pipe(Stream.runDrain)).pipe(
        Effect.forkScoped,
      );
      yield* Queue.offer(input, encodeLine({ type: "agent_start", padding: "too-large" }));
      const exit = yield* Fiber.join(drained);
      assert.strictEqual(exit._tag, "Failure");
      if (exit._tag === "Failure") {
        const reason = exit.cause.reasons[0];
        assert.ok(reason?._tag === "Fail" && isPiRpcProtocolError(reason.error));
      }
    }),
  );

  it.effect("rejects an unterminated record when stdout closes", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const client = yield* makePiRpcClient({ stdio });
      const drained = yield* Effect.exit(client.events.pipe(Stream.runDrain)).pipe(
        Effect.forkScoped,
      );
      yield* Queue.offer(input, encoder.encode('{"type":"agent_start"}'));
      yield* Queue.end(input);
      const exit = yield* Fiber.join(drained);
      assert.strictEqual(exit._tag, "Failure");
      if (exit._tag === "Failure") {
        const reason = exit.cause.reasons[0];
        assert.ok(reason?._tag === "Fail" && isPiRpcProtocolError(reason.error));
      }
    }),
  );
});
