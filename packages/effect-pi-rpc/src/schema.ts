import * as Schema from "effect/Schema";

export const PiRpcUnknownRecord = Schema.Record(Schema.String, Schema.Unknown);

export interface PiRpcCommand {
  readonly id?: string;
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface PiRpcResponse {
  readonly type: "response";
  readonly id?: string;
  readonly command: string;
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: string;
  readonly [key: string]: unknown;
}

export interface PiRpcEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export type PiRpcIncoming = PiRpcResponse | PiRpcEvent;

export interface PiModel {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly reasoning?: boolean;
  readonly input?: ReadonlyArray<string>;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly thinkingLevelMap?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export interface PiSessionState {
  readonly sessionId: string;
  readonly sessionFile?: string;
  readonly model?: PiModel;
  readonly thinkingLevel?: string;
  readonly isStreaming?: boolean;
  readonly [key: string]: unknown;
}
