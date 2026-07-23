import * as NodeNet from "node:net";

function isLoopbackHostname(hostname: string): boolean {
  const unwrapped =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (unwrapped === "localhost" || unwrapped === "::1") return true;
  return NodeNet.isIP(unwrapped) === 4 && unwrapped.split(".")[0] === "127";
}

export function normalizeLoopAnyServerUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";

  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("LoopAny server URL must use HTTPS, or HTTP on loopback.");
  }
  if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
    throw new Error("LoopAny server URL must use HTTPS unless it targets loopback.");
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error("LoopAny server URL must not contain embedded credentials.");
  }

  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}
