import * as Schema from "effect/Schema";

export class PiRpcTransportError extends Schema.TaggedErrorClass<PiRpcTransportError>()(
  "PiRpcTransportError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class PiRpcProtocolError extends Schema.TaggedErrorClass<PiRpcProtocolError>()(
  "PiRpcProtocolError",
  {
    detail: Schema.String,
    line: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class PiRpcRequestError extends Schema.TaggedErrorClass<PiRpcRequestError>()(
  "PiRpcRequestError",
  {
    command: Schema.String,
    detail: Schema.String,
    response: Schema.optional(Schema.Unknown),
  },
) {}

export type PiRpcError = PiRpcTransportError | PiRpcProtocolError | PiRpcRequestError;
