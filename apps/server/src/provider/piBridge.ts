import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

const PI_BRIDGE_PROTOCOL = "notcodex-pi-approval-v1";

/**
 * Pi intentionally leaves tool authorization to extensions. This small,
 * generated extension translates Not Codex runtime modes into Pi's
 * `tool_call` hook and uses the RPC extension-UI protocol for decisions.
 */
const PI_BRIDGE_SOURCE = `
const protocol = ${JSON.stringify(PI_BRIDGE_PROTOCOL)};
const sessionApprovals = new Set();

function requestType(toolName) {
  const normalized = String(toolName).toLowerCase();
  if (normalized.includes("bash") || normalized.includes("command")) return "command_execution_approval";
  if (normalized.includes("read") || normalized.includes("view")) return "file_read_approval";
  if (normalized.includes("edit") || normalized.includes("write") || normalized.includes("patch")) return "file_change_approval";
  return "dynamic_tool_call";
}

function shouldApprove(mode, type) {
  if (mode === "full-access") return false;
  if (mode === "auto-accept-edits" && (type === "file_read_approval" || type === "file_change_approval")) return false;
  return true;
}

export default function(pi) {
  pi.on("tool_call", async (event, ctx) => {
    const mode = process.env.NOTCODEX_PI_RUNTIME_MODE || "approval-required";
    const type = requestType(event.toolName);
    if (!shouldApprove(mode, type)) return undefined;

    const key = type + ":" + event.toolName;
    if (sessionApprovals.has(key)) return undefined;
    if (!ctx.hasUI) return { block: true, reason: "Tool approval unavailable in headless mode." };

    const title = JSON.stringify({
      protocol,
      requestType: type,
      toolName: event.toolName,
      args: event.input,
    });
    const choice = await ctx.ui.select(title, ["accept", "acceptForSession", "decline"]);
    if (choice === "acceptForSession") {
      sessionApprovals.add(key);
      return undefined;
    }
    if (choice !== "accept") return { block: true, reason: "Blocked by user." };
    return undefined;
  });
}
`;

export interface PiBridgeDescriptor {
  readonly path: string;
  readonly protocol: typeof PI_BRIDGE_PROTOCOL;
}

export const materializePiBridge = Effect.fn("materializePiBridge")(function* (baseDir: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const bridgeDir = path.join(baseDir, "generated", "pi");
  const bridgePath = path.join(bridgeDir, "notcodex-pi-bridge.mjs");
  yield* fileSystem.makeDirectory(bridgeDir, { recursive: true });
  yield* fileSystem.writeFileString(bridgePath, PI_BRIDGE_SOURCE, { mode: 0o600 });
  return { path: bridgePath, protocol: PI_BRIDGE_PROTOCOL } satisfies PiBridgeDescriptor;
});

export function parsePiBridgeApproval(value: unknown):
  | {
      readonly requestType:
        | "command_execution_approval"
        | "file_read_approval"
        | "file_change_approval"
        | "dynamic_tool_call";
      readonly toolName: string;
      readonly args: unknown;
    }
  | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (record.protocol !== PI_BRIDGE_PROTOCOL || typeof record.toolName !== "string") {
      return undefined;
    }
    switch (record.requestType) {
      case "command_execution_approval":
      case "file_read_approval":
      case "file_change_approval":
      case "dynamic_tool_call":
        return {
          requestType: record.requestType,
          toolName: record.toolName,
          args: record.args,
        };
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}
