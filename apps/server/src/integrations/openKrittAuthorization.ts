export const OPEN_KRITT_READ_OPERATIONS = [
  "integrations.openKritt.runs.list",
  "integrations.openKritt.findings.list",
  "integrations.openKritt.finding.get",
  "integrations.openKritt.scans.compare",
] as const;

/**
 * `test` and `catalog.refresh` are operate operations, not read: both issue
 * outbound requests to the operator's private Open Kritt instance, so read scope
 * must not authorize that egress.
 */
export const OPEN_KRITT_OPERATE_OPERATIONS = [
  "integrations.openKritt.configure",
  "integrations.openKritt.test",
  "integrations.openKritt.catalog.refresh",
  "integrations.openKritt.scan.launch",
  "integrations.openKritt.remediation.launch",
  "integrations.openKritt.rescan",
] as const;

const OPEN_KRITT_READ_OPERATION_SET: ReadonlySet<string> = new Set(OPEN_KRITT_READ_OPERATIONS);
const OPEN_KRITT_OPERATE_OPERATION_SET: ReadonlySet<string> = new Set(
  OPEN_KRITT_OPERATE_OPERATIONS,
);

export function authorizeOpenKrittOperation(
  operation: string,
  scopes: ReadonlyArray<string>,
): "read" | "operate" {
  if (OPEN_KRITT_READ_OPERATION_SET.has(operation)) {
    if (!scopes.includes("orchestration:read") && !scopes.includes("orchestration:operate")) {
      throw new Error("Open Kritt observation requires orchestration:read scope.");
    }
    return "read";
  }
  if (OPEN_KRITT_OPERATE_OPERATION_SET.has(operation)) {
    if (!scopes.includes("orchestration:operate")) {
      throw new Error("Open Kritt operation requires orchestration:operate scope.");
    }
    return "operate";
  }
  throw new Error("Unknown Open Kritt operation.");
}
