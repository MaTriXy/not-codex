// The Open Kritt transport is deliberately a raw Node HTTP client rather than
// an Effect HttpClient: it pins the request to the exact address it validated,
// which requires the `lookup` hook and socket-level timeouts that only the Node
// APIs expose. The timers and jitter below are part of that socket boundary.
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimers:off
// The wall-clock deadline that bounds one attempt lives at the same socket
// boundary as those timers, so it reads the system clock directly.
// @effect-diagnostics globalDate:off
// @effect-diagnostics globalRandom:off
import {
  buildOpenKrittRequestUrl,
  isOpenKrittLoopbackHostname,
  isOpenKrittResolvedAddressAllowed,
  normalizeOpenKrittServerUrl,
  parseOpenKrittServerBase,
  stripOpenKrittBasePath,
  validateOpenKrittRedirect,
} from "../openKrittUrl.ts";
import * as NodeDnsPromises from "node:dns/promises";
import * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";
import * as NodeNet from "node:net";
import * as NodeStream from "node:stream";

export const OPEN_KRITT_HTTP_LIMITS = {
  requestBodyBytes: 262_144,
  responseBodyBytes: 1_048_576,
  defaultTimeoutMs: 15_000,
  defaultIdleTimeoutMs: 15_000,
  /**
   * Wall-clock ceiling for one attempt, headers plus body. The idle timeout alone
   * cannot bound total duration: a peer that emits one byte just inside every
   * idle window holds a connection open indefinitely while staying under both the
   * header timeout and the response size cap.
   */
  defaultTotalRequestMs: 60_000,
  defaultMaxReadAttempts: 2,
  defaultRetryDelayMs: 250,
  maxRetryDelayMs: 5_000,
} as const;

export type OpenKrittHttpErrorCode =
  | "invalid-url"
  | "resolution-error"
  | "timeout"
  | "network-error"
  | "unauthorized"
  | "unexpected-status"
  | "unexpected-content-type"
  | "response-too-large"
  | "request-too-large"
  | "malformed-response"
  | "unsafe-redirect";

export class OpenKrittHttpClientError extends Error {
  readonly _tag = "OpenKrittHttpClientError" as const;
  readonly code: OpenKrittHttpErrorCode;
  readonly status: number | undefined;

  constructor(code: OpenKrittHttpErrorCode, message: string, status?: number) {
    super(message);
    this.name = "OpenKrittHttpClientError";
    this.code = code;
    this.status = status;
  }
}

export type OpenKrittFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type RetryOptions = {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly jitterMs?: number;
};

export type RequestOpenKrittOptions = {
  readonly fetch?: OpenKrittFetch;
  readonly serverUrl: string;
  readonly token: string | null;
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly body?: unknown;
  readonly expectedContentType: "application/json";
  readonly timeoutMs?: number;
  readonly idleTimeoutMs?: number;
  /** Wall-clock ceiling for one attempt including the body read. */
  readonly totalRequestMs?: number;
  readonly retry?: RetryOptions;
  /** Captures a Location value when an adapter has disabled implicit redirects. */
  readonly redirect?: { readonly location: string };
  /** Optional resolver used by deterministic security tests and operator DNS policy. */
  readonly resolveAddresses?: (hostname: string) => Promise<ReadonlyArray<string>>;
  /**
   * Bounded operator allowlist of private addresses/CIDRs. Without it a private
   * deployment is unreachable; it never opens link-local or metadata ranges.
   */
  readonly allowedPrivateAddresses?: ReadonlyArray<string> | undefined;
};

export type OpenKrittHttpResponse = {
  readonly status: number;
  readonly body: unknown;
  /** Optional only to keep rejected-call narrowing ergonomic for adapters. */
  readonly message?: string;
};

const sleep = (milliseconds: number): Promise<void> =>
  milliseconds <= 0
    ? Promise.resolve()
    : new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
      });

function jitteredDelay(base: number, jitter: number): number {
  if (jitter <= 0) return base;
  return base + Math.floor(Math.random() * (jitter + 1));
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  idleTimeoutMs: number,
  deadlineAt: number,
): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const readWithIdleTimeout = async () => {
    // Bound each read by whichever expires first: the per-chunk idle window or
    // what is left of the attempt's total wall-clock budget.
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0)
      throw new OpenKrittHttpClientError("timeout", "Open Kritt request timed out.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new OpenKrittHttpClientError("timeout", "Open Kritt response idle timeout.")),
            Math.min(idleTimeoutMs, remaining),
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  try {
    while (true) {
      const result = await readWithIdleTimeout();
      if (result.done) break;
      const chunk = result.value;
      total += chunk.byteLength;
      if (total > maxBytes) {
        throw new OpenKrittHttpClientError(
          "response-too-large",
          "Open Kritt response exceeds the configured size limit.",
        );
      }
      chunks.push(chunk);
    }
  } catch (cause) {
    // Any abandonment path — idle timeout, total budget, size limit — must
    // release the socket instead of leaving a half-read body attached to it.
    await reader.cancel().catch(() => undefined);
    throw cause;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

function responseContentType(response: Response): string {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function parseBody(text: string): unknown {
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new OpenKrittHttpClientError("malformed-response", "Open Kritt returned malformed JSON.");
  }
}

/**
 * Resolves the host once and returns the approved addresses. The caller must
 * connect to one of these exact addresses; re-resolving at connect time would
 * reopen the DNS-rebinding window this check exists to close.
 */
async function validateResolvedOrigin(
  url: URL,
  options: RequestOpenKrittOptions,
  deadlineAt: number,
): Promise<ReadonlyArray<string> | null> {
  // Fixture transports are deliberately not resolved. Production calls use
  // the system resolver unless a deterministic resolver was supplied.
  if (options.resolveAddresses === undefined && options.fetch !== undefined) return null;
  const resolve =
    options.resolveAddresses ??
    (async (hostname: string) =>
      (await NodeDnsPromises.lookup(hostname, { all: true })).map((entry) => entry.address));
  let addresses: ReadonlyArray<string>;
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    throw new OpenKrittHttpClientError(
      "resolution-error",
      "Open Kritt host resolution exceeded the request deadline.",
    );
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = await Promise.race([
      resolve(url.hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new OpenKrittHttpClientError(
                "resolution-error",
                "Open Kritt host resolution exceeded the request deadline.",
              ),
            ),
          remaining,
        );
      }),
    ]);
  } catch (cause) {
    if (cause instanceof OpenKrittHttpClientError) throw cause;
    throw new OpenKrittHttpClientError("resolution-error", "Open Kritt host resolution failed.");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  // Keep only the approved addresses and connect exclusively to those. Requiring
  // every resolved address to pass would reject ordinary dual-stack hosts whose
  // A record is public while some AAAA form is not; failing only when nothing is
  // approved preserves the SSRF guarantee without breaking HTTPS deployments.
  const approved = addresses.filter((address) =>
    isOpenKrittResolvedAddressAllowed(address, {
      allowLoopback: isOpenKrittLoopbackHostname(url.hostname),
      allowedPrivateAddresses: options.allowedPrivateAddresses,
    }),
  );
  if (approved.length === 0) {
    throw new OpenKrittHttpClientError(
      "invalid-url",
      "Open Kritt host resolves to a disallowed address.",
    );
  }
  return approved;
}

type LookupEntry = { readonly address: string; readonly family: number };

type NodeLookup = (
  hostname: string,
  options: unknown,
  callback: (
    error: Error | null,
    address?: string | ReadonlyArray<LookupEntry>,
    family?: number,
  ) => void,
) => void;

/**
 * A `lookup` implementation that ignores the hostname and always yields the
 * address already approved by {@link isOpenKrittResolvedAddressAllowed}. This is
 * what closes the DNS-rebinding window: the socket connects to the checked
 * address, never to a second, independent resolution of the same name.
 */
export function pinnedOpenKrittLookup(addresses: ReadonlyArray<string>): NodeLookup {
  const entries = addresses.map((address) => ({
    address,
    family: NodeNet.isIP(address) === 6 ? 6 : 4,
  }));
  return (_hostname, options, callback) => {
    const first = entries[0];
    if (first === undefined) {
      callback(new Error("No approved Open Kritt address is available."));
      return;
    }
    // Honour `all` so the transport can fail over across the approved set only;
    // returning a single address left an unreachable first entry fatal.
    if (typeof options === "object" && options !== null && (options as { all?: boolean }).all) {
      callback(null, entries);
      return;
    }
    callback(null, first.address, first.family);
  };
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Minimal `fetch`-shaped transport over `node:http`/`node:https` so the socket
 * connects to a pre-approved address. `globalThis.fetch` cannot express a pinned
 * lookup, so it is only used for injected fixture transports.
 */
function createPinnedFetch(addresses: ReadonlyArray<string>): OpenKrittFetch {
  const lookup = pinnedOpenKrittLookup(addresses);
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const transport = url.protocol === "https:" ? NodeHttps : NodeHttp;
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value;
      });
      // Send a framed body rather than falling back to chunked transfer
      // encoding: the recommended deployment shape puts an authenticating
      // reverse proxy in front of Open Kritt, and a proxy that rejects or
      // rebuffers a chunked POST lands the launch in the expensive
      // `unknown` resolution path.
      const body = typeof init?.body === "string" ? init.body : null;
      if (body !== null) headers["content-length"] = String(Buffer.byteLength(body));
      const request = transport.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port),
          path: `${url.pathname}${url.search}`,
          method: init?.method ?? "GET",
          headers,
          // Preserve certificate/SNI validation against the configured hostname
          // while the socket connects to the approved address.
          ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
          lookup: lookup as never,
        },
        (response) => {
          const status = response.statusCode ?? 502;
          const body = NULL_BODY_STATUSES.has(status)
            ? null
            : (NodeStream.Readable.toWeb(response) as ReadableStream<Uint8Array>);
          resolve(
            new Response(body, {
              status,
              headers: Object.entries(response.headers).flatMap(([key, value]) =>
                value === undefined
                  ? []
                  : [[key, Array.isArray(value) ? value.join(", ") : value] as [string, string]],
              ),
            }),
          );
        },
      );
      request.on("error", reject);
      const signal = init?.signal;
      if (signal != null) {
        if (signal.aborted) request.destroy(new Error("aborted"));
        else signal.addEventListener("abort", () => request.destroy(new Error("aborted")));
      }
      if (body !== null) request.write(body);
      else if (init?.body != null) request.write(init.body);
      request.end();
    });
}

/** A redirect is only ever followed within the already-approved origin, once. */
const MAX_OPEN_KRITT_REDIRECT_HOPS = 1;

async function requestOnce(
  options: RequestOpenKrittOptions,
  defaultFetch: OpenKrittFetch,
  hop = 0,
  deadlineAt = Date.now() +
    (options.totalRequestMs ?? OPEN_KRITT_HTTP_LIMITS.defaultTotalRequestMs),
  /**
   * Addresses already approved on the previous hop. A same-origin redirect
   * cannot change the host, so re-resolving would only duplicate DNS work.
   */
  preApproved: ReadonlyArray<string> | null | undefined = undefined,
): Promise<OpenKrittHttpResponse> {
  let base: string;
  let basePath: string;
  try {
    const parsed = parseOpenKrittServerBase(options.serverUrl);
    base = normalizeOpenKrittServerUrl(options.serverUrl);
    basePath = parsed.basePath;
  } catch {
    throw new OpenKrittHttpClientError("invalid-url", "Invalid Open Kritt server URL.");
  }
  let url: URL;
  try {
    url = buildOpenKrittRequestUrl(base, options.path);
  } catch {
    throw new OpenKrittHttpClientError("invalid-url", "Invalid Open Kritt API path.");
  }
  const approvedAddresses =
    preApproved === undefined
      ? await validateResolvedOrigin(url, options, deadlineAt)
      : preApproved;
  // Connect to the address that was just approved rather than letting the
  // transport resolve the name a second time.
  const fetchImpl =
    options.fetch ??
    (approvedAddresses === null ? defaultFetch : createPinnedFetch(approvedAddresses));
  if (options.redirect !== undefined) {
    try {
      validateOpenKrittRedirect(base, options.redirect.location);
    } catch {
      throw new OpenKrittHttpClientError(
        "unsafe-redirect",
        "Open Kritt redirect changed the approved origin.",
      );
    }
  }
  let requestBody: string | undefined;
  if (options.body !== undefined) {
    try {
      requestBody = JSON.stringify(options.body);
    } catch {
      throw new OpenKrittHttpClientError(
        "request-too-large",
        "Open Kritt request could not be serialized.",
      );
    }
    if (
      new TextEncoder().encode(requestBody).byteLength > OPEN_KRITT_HTTP_LIMITS.requestBodyBytes
    ) {
      throw new OpenKrittHttpClientError(
        "request-too-large",
        "Open Kritt request exceeds the configured size limit.",
      );
    }
  }
  const headers = new Headers({ accept: "application/json" });
  if (requestBody !== undefined) headers.set("content-type", "application/json");
  if (options.token !== null && options.token.length > 0)
    headers.set("authorization", `Bearer ${options.token}`);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? OPEN_KRITT_HTTP_LIMITS.defaultTimeoutMs;
  const remainingRequestMs = deadlineAt - Date.now();
  if (remainingRequestMs <= 0)
    throw new OpenKrittHttpClientError("timeout", "Open Kritt request timed out.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        controller.abort();
        reject(new OpenKrittHttpClientError("timeout", "Open Kritt request timed out."));
      },
      Math.min(timeoutMs, remainingRequestMs),
    );
  });
  let response: Response;
  try {
    response = await Promise.race([
      fetchImpl(url.toString(), {
        method: options.method,
        headers,
        body: requestBody,
        redirect: "manual",
        signal: controller.signal,
      }),
      timeout,
    ]);
  } catch (cause) {
    if (cause instanceof OpenKrittHttpClientError) throw cause;
    throw new OpenKrittHttpClientError("network-error", "Open Kritt request failed.");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (response.status >= 300 && response.status < 400) {
    // Only a GET is ever replayed. Re-sending a POST/PATCH/DELETE at a redirect
    // target would repeat a mutation the upstream may already have applied —
    // for `POST /api/scans` that is a second, separately billed scan, and no
    // reconciliation runs because the original call did not fail or time out.
    if (options.method !== "GET") {
      await response.body?.cancel();
      throw new OpenKrittHttpClientError(
        "unsafe-redirect",
        "Open Kritt redirected a non-GET request.",
        response.status,
      );
    }
    const location = response.headers.get("location");
    if (location === null)
      throw new OpenKrittHttpClientError(
        "unsafe-redirect",
        "Open Kritt returned an invalid redirect.",
        response.status,
      );
    let target: URL;
    let followPath: string;
    try {
      target = new URL(validateOpenKrittRedirect(base, location));
      // The recursive call re-applies the approved prefix, so hand it the path
      // relative to that prefix rather than the already-prefixed pathname.
      followPath = stripOpenKrittBasePath(target.pathname, basePath);
    } catch {
      throw new OpenKrittHttpClientError(
        "unsafe-redirect",
        "Open Kritt redirect changed the approved origin.",
        response.status,
      );
    }
    // The redirect is same-origin and credential-free, so following it once is
    // safe and covers the common reverse-proxy trailing-slash case. Anything
    // beyond one hop is reported rather than chased.
    if (hop >= MAX_OPEN_KRITT_REDIRECT_HOPS) {
      throw new OpenKrittHttpClientError(
        "unsafe-redirect",
        "Open Kritt returned too many redirects.",
        response.status,
      );
    }
    await response.body?.cancel();
    return requestOnce(
      { ...options, path: followPath },
      defaultFetch,
      hop + 1,
      deadlineAt,
      approvedAddresses,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new OpenKrittHttpClientError(
      "unauthorized",
      "Open Kritt authorization was rejected.",
      response.status,
    );
  }
  if (response.status >= 500) {
    throw new OpenKrittHttpClientError(
      "unexpected-status",
      "Open Kritt is temporarily unavailable.",
      response.status,
    );
  }
  // Validate the declared content type *before* reading the body: a misconfigured
  // reverse proxy answering every poll with HTML would otherwise stream up to the
  // full body cap on each tick only to be rejected.
  if (response.status !== 204 && responseContentType(response) !== options.expectedContentType) {
    await response.body?.cancel();
    throw new OpenKrittHttpClientError(
      "unexpected-content-type",
      "Open Kritt returned an unexpected content type.",
      response.status,
    );
  }
  const bodyText = await readBoundedText(
    response,
    OPEN_KRITT_HTTP_LIMITS.responseBodyBytes,
    options.idleTimeoutMs ?? OPEN_KRITT_HTTP_LIMITS.defaultIdleTimeoutMs,
    deadlineAt,
  );
  return { status: response.status, body: parseBody(bodyText) };
}

export async function requestOpenKritt(
  options: RequestOpenKrittOptions,
): Promise<OpenKrittHttpResponse> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function")
    throw new OpenKrittHttpClientError("network-error", "Server fetch is unavailable.");
  const attempts =
    options.method === "GET" ? Math.max(1, Math.min(options.retry?.maxAttempts ?? 2, 3)) : 1;
  const baseDelay = Math.min(
    options.retry?.baseDelayMs ?? OPEN_KRITT_HTTP_LIMITS.defaultRetryDelayMs,
    OPEN_KRITT_HTTP_LIMITS.maxRetryDelayMs,
  );
  const jitter = Math.min(options.retry?.jitterMs ?? 100, OPEN_KRITT_HTTP_LIMITS.maxRetryDelayMs);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestOnce(options, fetchImpl);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof OpenKrittHttpClientError &&
        (error.code === "network-error" ||
          error.code === "timeout" ||
          (error.code === "unexpected-status" && (error.status ?? 0) >= 500));
      if (!retryable || attempt === attempts) throw error;
      await sleep(jitteredDelay(baseDelay * 2 ** (attempt - 1), jitter));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new OpenKrittHttpClientError("network-error", "Open Kritt request failed.");
}
