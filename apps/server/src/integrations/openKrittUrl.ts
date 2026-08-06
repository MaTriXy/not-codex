import * as NodeNet from "node:net";

export function isOpenKrittLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  // The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1: operators
  // binding a second local instance to 127.0.0.2 to avoid a port clash are
  // exactly as local as the canonical address.
  const parts = ipv4Parts(normalized);
  return parts !== null && parts[0] === 127;
}

export function isOpenKrittLoopbackUrl(value: string): boolean {
  try {
    return isOpenKrittLoopbackHostname(new URL(value.trim()).hostname);
  } catch {
    return false;
  }
}

export function normalizeOpenKrittServerUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 4_096)
    throw new Error("Invalid Open Kritt server URL.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Invalid Open Kritt server URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Open Kritt server URL must use HTTP or HTTPS.");
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "" || url.search !== "") {
    throw new Error("Open Kritt server URL cannot contain credentials, queries, or fragments.");
  }
  // Loopback is loopback in either address family: `http://[::1]:PORT` is exactly
  // as private as `http://127.0.0.1:PORT`, and the post-DNS allowlist classifies
  // both identically. Rejecting the IPv6 literal only blocked IPv6-only local
  // deployments; it bought no additional safety.
  if (url.protocol === "http:" && !isOpenKrittLoopbackHostname(url.hostname)) {
    throw new Error("Plain HTTP is allowed only for loopback Open Kritt endpoints.");
  }
  if (url.port === "0") throw new Error("Invalid Open Kritt server port.");
  return url.origin + normalizeOpenKrittBasePath(url.pathname);
}

/** Longest supported reverse-proxy prefix depth; anything deeper is a misconfiguration. */
const MAX_BASE_PATH_SEGMENTS = 8;
/**
 * Deliberately excludes `%`: a percent-encoded separator would make the prefix
 * check below and the upstream server disagree about where the prefix ends.
 */
const BASE_PATH_SEGMENT = /^[A-Za-z0-9._~-]{1,64}$/;

/**
 * Normalizes an operator-provided reverse-proxy base path to either `""` or
 * `/seg[/seg...]` with no trailing slash. A base path is supported because the
 * documented way to authenticate an upstream that ships unauthenticated is an
 * operator-run reverse proxy, and those commonly terminate at a subpath. It is
 * still validated strictly: the prefix is re-applied to every request path and
 * every redirect must stay inside it, so traversal or encoded separators would
 * send requests somewhere the operator never approved.
 */
export function normalizeOpenKrittBasePath(pathname: string): string {
  if (pathname === "" || pathname === "/") return "";
  if (pathname.includes("%")) {
    throw new Error("Open Kritt base path cannot contain percent-encoded characters.");
  }
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return "";
  if (segments.length > MAX_BASE_PATH_SEGMENTS) {
    throw new Error("Open Kritt base path is too deep.");
  }
  for (const segment of segments) {
    if (segment === "." || segment === ".." || !BASE_PATH_SEGMENT.test(segment)) {
      throw new Error("Open Kritt base path contains an unsupported path segment.");
    }
  }
  return `/${segments.join("/")}`;
}

/** Splits a normalized base into its origin and (possibly empty) path prefix. */
export function parseOpenKrittServerBase(value: string): {
  readonly origin: string;
  readonly basePath: string;
} {
  const base = normalizeOpenKrittServerUrl(value);
  const url = new URL(base);
  return { origin: url.origin, basePath: normalizeOpenKrittBasePath(url.pathname) };
}

/** Builds an absolute request URL, re-applying the approved base path prefix. */
export function buildOpenKrittRequestUrl(base: string, path: string): URL {
  const { origin, basePath } = parseOpenKrittServerBase(base);
  if (!path.startsWith("/") || path.includes("#")) {
    throw new Error("Invalid Open Kritt API path.");
  }
  const url = new URL(`${basePath}${path}`, origin);
  if (url.origin !== origin || url.username !== "" || url.password !== "") {
    throw new Error("Invalid Open Kritt API path.");
  }
  if (!isWithinOpenKrittBasePath(url.pathname, basePath)) {
    throw new Error("Invalid Open Kritt API path.");
  }
  return url;
}

function isWithinOpenKrittBasePath(pathname: string, basePath: string): boolean {
  if (basePath === "") return true;
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

export function validateOpenKrittRedirect(base: string, location: string): string {
  const { origin, basePath } = parseOpenKrittServerBase(base);
  let target: URL;
  try {
    target = new URL(location, `${origin}${basePath}/`);
  } catch {
    throw new Error("Invalid Open Kritt redirect.");
  }
  if (
    target.origin !== origin ||
    target.username !== "" ||
    target.password !== "" ||
    target.hash !== "" ||
    target.search !== "" ||
    // A redirect that escapes the approved prefix is exactly the case the prefix
    // exists to prevent (for example /kritt/api/... -> /admin).
    !isWithinOpenKrittBasePath(target.pathname, basePath)
  ) {
    throw new Error("Unsafe Open Kritt redirect.");
  }
  return target.toString();
}

/** Strips the approved prefix so a followed redirect is not double-prefixed. */
export function stripOpenKrittBasePath(pathname: string, basePath: string): string {
  if (basePath === "") return pathname;
  if (!isWithinOpenKrittBasePath(pathname, basePath)) {
    throw new Error("Unsafe Open Kritt redirect.");
  }
  const rest = pathname.slice(basePath.length);
  return rest.length === 0 ? "/" : rest;
}

function ipv4Parts(address: string): readonly number[] | null {
  if (NodeNet.isIP(address) !== 4) return null;
  const parts = address.split(".").map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function inRange(
  parts: readonly number[],
  start: readonly number[],
  end: readonly number[],
): boolean {
  const value =
    (parts[0] ?? 0) * 0x1000000 +
    (parts[1] ?? 0) * 0x10000 +
    (parts[2] ?? 0) * 0x100 +
    (parts[3] ?? 0);
  const low =
    (start[0] ?? 0) * 0x1000000 +
    (start[1] ?? 0) * 0x10000 +
    (start[2] ?? 0) * 0x100 +
    (start[3] ?? 0);
  const high =
    (end[0] ?? 0) * 0x1000000 + (end[1] ?? 0) * 0x10000 + (end[2] ?? 0) * 0x100 + (end[3] ?? 0);
  return value >= low && value <= high;
}

/**
 * Expands an IPv6 literal (including `::` compression and a trailing embedded
 * IPv4 form) into its 16 bytes so ranges can be classified numerically.
 */
function ipv6Bytes(address: string): Uint8Array | null {
  if (NodeNet.isIP(address) !== 6) return null;
  let text = address;
  // Node accepts a zone index (fe80::1%en0); it is irrelevant to classification.
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  let tail: readonly number[] = [];
  const lastColon = text.lastIndexOf(":");
  const trailing = text.slice(lastColon + 1);
  if (trailing.includes(".")) {
    const embedded = ipv4Parts(trailing);
    if (embedded === null) return null;
    tail = embedded;
    text = text.slice(0, lastColon + 1) + "0:0";
  }
  const [head, rest, extra] = text.split("::");
  if (extra !== undefined) return null;
  const toGroups = (value: string): readonly number[] | null => {
    if (value === undefined || value.length === 0) return [];
    const groups: number[] = [];
    for (const part of value.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };
  const headGroups = toGroups(head ?? "");
  const restGroups = rest === undefined ? [] : toGroups(rest);
  if (headGroups === null || restGroups === null) return null;
  // The embedded-IPv4 rewrite above already contributes its two placeholder
  // groups, so the group accounting is uniform from here on.
  const fill = 8 - (headGroups.length + restGroups.length);
  if (rest === undefined ? fill !== 0 : fill < 0) return null;
  const groups = [
    ...headGroups,
    ...Array.from({ length: rest === undefined ? 0 : fill }, () => 0),
    ...restGroups,
  ];
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = (group >> 8) & 0xff;
    bytes[index * 2 + 1] = group & 0xff;
  });
  if (tail.length === 4) {
    bytes[12] = tail[0] ?? 0;
    bytes[13] = tail[1] ?? 0;
    bytes[14] = tail[2] ?? 0;
    bytes[15] = tail[3] ?? 0;
  }
  return bytes;
}

/**
 * Post-DNS address policy. `allowedPrivateAddresses` is the bounded operator
 * allowlist that makes the documented dedicated-private-host deployment
 * reachable: without it every RFC1918/ULA address is refused and only loopback
 * works. Entries are literal addresses or CIDRs and override *only* the private
 * unicast ranges — link-local (including 169.254.169.254), multicast, 0.0.0.0/8
 * and the other reserved blocks stay refused no matter what is listed, so an
 * allowlist entry can never open a cloud metadata endpoint.
 */
export type OpenKrittAddressPolicy = {
  readonly allowLoopback: boolean;
  readonly allowedPrivateAddresses?: ReadonlyArray<string> | undefined;
};

/** Longest supported operator allowlist; anything larger is a policy smell. */
export const MAX_OPEN_KRITT_ALLOWED_PRIVATE_ADDRESSES = 8;

/** Uncompressed 8-group form, so allowlist matching never depends on `::` placement. */
function formatIpv6(bytes: Uint8Array): string {
  return Array.from({ length: 8 }, (_, index) =>
    (((bytes[index * 2] ?? 0) << 8) | (bytes[index * 2 + 1] ?? 0)).toString(16),
  ).join(":");
}

function addressBytes(address: string): Uint8Array | null {
  const family = NodeNet.isIP(address);
  if (family === 4) {
    const parts = ipv4Parts(address);
    return parts === null ? null : Uint8Array.from(parts);
  }
  if (family === 6) return ipv6Bytes(address);
  return null;
}

/** Validates one allowlist entry: a literal IP or `ip/prefix` CIDR. */
export function parseOpenKrittAllowedAddress(
  entry: string,
): { readonly bytes: Uint8Array; readonly prefixBits: number } | null {
  const trimmed = entry
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const slash = trimmed.indexOf("/");
  const literal = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const bytes = addressBytes(literal);
  if (bytes === null) return null;
  const maxBits = bytes.length * 8;
  if (slash === -1) return { bytes, prefixBits: maxBits };
  const suffix = trimmed.slice(slash + 1);
  if (!/^\d{1,3}$/.test(suffix)) return null;
  const prefixBits = Number(suffix);
  if (prefixBits > maxBits) return null;
  return { bytes, prefixBits };
}

function matchesAllowedPrivateAddress(
  address: string,
  allowed: ReadonlyArray<string> | undefined,
): boolean {
  if (allowed === undefined || allowed.length === 0) return false;
  const target = addressBytes(address);
  if (target === null) return false;
  return allowed.slice(0, MAX_OPEN_KRITT_ALLOWED_PRIVATE_ADDRESSES).some((entry) => {
    const parsed = parseOpenKrittAllowedAddress(entry);
    if (parsed === null || parsed.bytes.length !== target.length) return false;
    let remaining = parsed.prefixBits;
    for (let index = 0; index < target.length && remaining > 0; index += 1) {
      const bits = Math.min(8, remaining);
      const mask = (0xff << (8 - bits)) & 0xff;
      if (((target[index] ?? 0) & mask) !== ((parsed.bytes[index] ?? 0) & mask)) return false;
      remaining -= bits;
    }
    return true;
  });
}

function isIpv6Allowed(bytes: Uint8Array, options: OpenKrittAddressPolicy): boolean {
  const allowLoopback = options.allowLoopback;
  const first = bytes[0] ?? 0;
  const second = bytes[1] ?? 0;
  const isZeroPrefix = bytes.slice(0, 12).every((byte) => byte === 0);
  // ::1 loopback and the unspecified address ::.
  if (bytes.every((byte, index) => (index === 15 ? byte === 1 : byte === 0))) return allowLoopback;
  if (bytes.every((byte) => byte === 0)) return false;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms delegate to the IPv4 policy.
  if (
    isZeroPrefix ||
    (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff)
  ) {
    const mapped = [bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0].join(".");
    return isOpenKrittResolvedAddressAllowed(mapped, options);
  }
  // RFC 6052's well-known NAT64 prefix and RFC 8215's local-use extension
  // translate embedded IPv4 destinations after this policy check. Reject the
  // whole reserved 64:ff9b::/32 family so metadata/private IPv4 cannot bypass
  // the IPv4 policy by arriving in translated IPv6 form.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b)
    return false;
  if ((first & 0xfe) === 0xfc) {
    // fc00::/7 unique-local: reachable only when the operator listed it.
    return matchesAllowedPrivateAddress(formatIpv6(bytes), options.allowedPrivateAddresses);
  }
  if (first === 0xfe && (second & 0xc0) === 0x80) return false; // fe80::/10 link-local
  if (first === 0xff) return false; // ff00::/8 multicast
  if (first === 0x20 && second === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false; // 2001:db8::/32
  return true;
}

/** Address allowlist applied after DNS resolution to prevent SSRF/rebinding. */
export function isOpenKrittResolvedAddressAllowed(
  address: string,
  options: OpenKrittAddressPolicy,
): boolean {
  const normalized = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (NodeNet.isIP(normalized) === 6) {
    const bytes = ipv6Bytes(normalized);
    return bytes === null ? false : isIpv6Allowed(bytes, options);
  }
  const parts = ipv4Parts(normalized);
  if (parts === null) return false;
  const allowlisted = () =>
    matchesAllowedPrivateAddress(normalized, options.allowedPrivateAddresses);
  if (inRange(parts, [127, 0, 0, 0], [127, 255, 255, 255])) return options.allowLoopback;
  // Private unicast: reachable only when the operator explicitly listed it.
  if (inRange(parts, [10, 0, 0, 0], [10, 255, 255, 255])) return allowlisted();
  if (inRange(parts, [172, 16, 0, 0], [172, 31, 255, 255])) return allowlisted();
  if (inRange(parts, [192, 168, 0, 0], [192, 168, 255, 255])) return allowlisted();
  if (inRange(parts, [100, 64, 0, 0], [100, 127, 255, 255])) return allowlisted();
  // Never allowlistable: link-local carries the cloud metadata endpoints, and
  // the rest are not valid unicast destinations for an HTTP API at all.
  if (inRange(parts, [169, 254, 0, 0], [169, 254, 255, 255])) return false;
  if (inRange(parts, [224, 0, 0, 0], [239, 255, 255, 255])) return false;
  if (inRange(parts, [0, 0, 0, 0], [0, 255, 255, 255])) return false;
  if (inRange(parts, [192, 0, 0, 0], [192, 0, 0, 255])) return false; // IETF protocol assignments
  if (inRange(parts, [198, 18, 0, 0], [198, 19, 255, 255])) return false; // benchmarking
  if (inRange(parts, [240, 0, 0, 0], [255, 255, 255, 255])) return false; // reserved / broadcast
  return true;
}
