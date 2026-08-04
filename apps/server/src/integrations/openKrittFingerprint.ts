import * as NodeCrypto from "node:crypto";

type FindingLike = {
  readonly type?: unknown;
  readonly path?: unknown;
  readonly line?: unknown;
  readonly column?: unknown;
  readonly rootBug?: unknown;
  readonly duplicateOf?: unknown;
};

function normalizedPath(value: unknown): string {
  const path = typeof value === "string" ? value : "";
  const segments: string[] = [];
  for (const segment of path.replaceAll("\\", "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join("/").toLowerCase();
}

function normalizedType(value: unknown): string {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
    : "";
}

export function fingerprintFinding(finding: FindingLike): string {
  const stable = [
    normalizedType(finding.type),
    normalizedPath(finding.path),
    typeof finding.line === "number" ? String(finding.line) : "",
    typeof finding.column === "number" ? String(finding.column) : "",
    typeof finding.rootBug === "string" ? finding.rootBug.trim().toLowerCase() : "",
    typeof finding.duplicateOf === "string" ? finding.duplicateOf.trim().toLowerCase() : "",
  ].join("\u0000");
  return NodeCrypto.createHash("sha256").update(stable).digest("hex");
}

export function compareFindingSets<T extends FindingLike>(
  prior: ReadonlyArray<T>,
  current: ReadonlyArray<T>,
  options: { readonly sameSourceRevision?: boolean; readonly sameConfiguration?: boolean } = {},
): {
  readonly stillPresent: ReadonlyArray<{ readonly fingerprint: string; readonly finding: T }>;
  readonly disappeared: ReadonlyArray<{ readonly fingerprint: string; readonly finding: T }>;
  readonly conclusion: "still-present" | "not-reproduced" | "uncertain" | "proven-fixed";
  readonly reason?: string;
} {
  const priorByFingerprint = new Map(
    prior.map((finding) => [fingerprintFinding(finding), finding] as const),
  );
  const currentByFingerprint = new Map(
    current.map((finding) => [fingerprintFinding(finding), finding] as const),
  );
  const stillPresent = [...currentByFingerprint.entries()]
    .filter(([fingerprint]) => priorByFingerprint.has(fingerprint))
    .map(([fingerprint, finding]) => ({ fingerprint, finding }));
  const disappeared = [...priorByFingerprint.entries()]
    .filter(([fingerprint]) => !currentByFingerprint.has(fingerprint))
    .map(([fingerprint, finding]) => ({ fingerprint, finding }));
  if (options.sameConfiguration === false) {
    return {
      stillPresent,
      disappeared,
      conclusion: "uncertain",
      reason: "Scan configuration or scope changed; absence is not comparable.",
    };
  }
  if (stillPresent.length > 0) return { stillPresent, disappeared, conclusion: "still-present" };
  if (disappeared.length === 0) {
    return {
      stillPresent,
      disappeared,
      conclusion: "uncertain",
      reason: "The prior scan produced no comparable findings.",
    };
  }
  // Absence on the *same* revision cannot be a fix: the code did not change, so
  // the finding simply did not reproduce. A fix can only be evidenced when the
  // revision changed under an identical configuration and the new scan still
  // produced findings, which shows the scan itself was effective.
  if (options.sameSourceRevision === false && current.length > 0) {
    return { stillPresent, disappeared, conclusion: "proven-fixed" };
  }
  return {
    stillPresent,
    disappeared,
    conclusion: "not-reproduced",
    reason:
      options.sameSourceRevision === false
        ? "The new scan reported no findings at all; absence is not proof of a fix."
        : "The source revision did not change; absence is not proof of a fix.",
  };
}
