import { MonkeyLoopyRunInput } from "@notcodex/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import {
  MONKEY_D_LOOPY_EXECUTION_VERSION,
  MONKEY_D_LOOPY_FACTORY_VERSION,
} from "./monkeyLoopyVersions.ts";

const RECOVERY_CAPSULE_VERSION = 1 as const;
const RECOVERY_SECRET_PREFIX = "integration-monkey-loopy-recovery";

const MonkeyLoopyRecoveryCapsule = Schema.Struct({
  version: Schema.Literal(RECOVERY_CAPSULE_VERSION),
  factoryVersion: Schema.String,
  executionVersion: Schema.String,
  input: MonkeyLoopyRunInput,
});

export type MonkeyLoopyRecoveryCapsule = typeof MonkeyLoopyRecoveryCapsule.Type;

const RecoveryCapsuleJson = Schema.fromJsonString(MonkeyLoopyRecoveryCapsule);
const encodeRecoveryCapsule = Schema.encodeUnknownEffect(RecoveryCapsuleJson);
const decodeRecoveryCapsule = Schema.decodeUnknownEffect(RecoveryCapsuleJson);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function monkeyLoopyRecoverySecretName(runId: string): string {
  return `${RECOVERY_SECRET_PREFIX}-${runId}`;
}

export function makeMonkeyLoopyRecoveryCapsule(
  input: MonkeyLoopyRunInput,
): MonkeyLoopyRecoveryCapsule {
  return {
    version: RECOVERY_CAPSULE_VERSION,
    factoryVersion: MONKEY_D_LOOPY_FACTORY_VERSION,
    executionVersion: MONKEY_D_LOOPY_EXECUTION_VERSION,
    input,
  };
}

export function encodeMonkeyLoopyRecoveryCapsule(
  capsule: MonkeyLoopyRecoveryCapsule,
): Effect.Effect<Uint8Array, Schema.SchemaError> {
  return encodeRecoveryCapsule(capsule).pipe(Effect.map((json) => textEncoder.encode(json)));
}

export function decodeMonkeyLoopyRecoveryCapsule(
  bytes: Uint8Array,
): Effect.Effect<MonkeyLoopyRecoveryCapsule, Schema.SchemaError> {
  return decodeRecoveryCapsule(textDecoder.decode(bytes));
}

export function isCurrentMonkeyLoopyRecoveryCapsule(capsule: MonkeyLoopyRecoveryCapsule): boolean {
  return (
    capsule.factoryVersion === MONKEY_D_LOOPY_FACTORY_VERSION &&
    capsule.executionVersion === MONKEY_D_LOOPY_EXECUTION_VERSION
  );
}

export function pruneMonkeyLoopyRecoveryCapsules(
  secrets: ServerSecretStore["Service"],
  runIds: ReadonlyArray<string>,
) {
  return Effect.forEach(
    runIds.filter((runId) => runId.startsWith("monkey-")),
    (runId) => secrets.remove(monkeyLoopyRecoverySecretName(runId)),
    { discard: true },
  );
}
