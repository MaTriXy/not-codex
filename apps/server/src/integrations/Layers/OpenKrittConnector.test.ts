import { describe, expect, it } from "vite-plus/test";

import {
  buildOpenKrittLaunchRequestBody,
  buildOpenKrittLocalScanRequestBody,
  buildOpenKrittRequestMarker,
  classifyOpenKrittLaunchResponse,
  isOpenKrittControlAuthorized,
  launchResolutionForTimeout,
  mapOpenKrittStatus,
  openKrittControlStatus,
  readOpenKrittRequestMarker,
} from "./OpenKrittConnector.ts";
import {
  FULL_COMMIT_SHA,
  launchConfiguration,
  OPEN_KRITT_REQUEST_ID,
  OPEN_KRITT_SCAN_ID,
  remoteSource,
  scanResponse,
} from "../test/openKrittTestFixtures.ts";

describe("Open Kritt connector launch boundary", () => {
  it("persists the launch intent marker in a bounded non-secret configuration field", () => {
    const marker = buildOpenKrittRequestMarker(OPEN_KRITT_REQUEST_ID);
    expect(marker).toEqual({ not_codex: { request_id: OPEN_KRITT_REQUEST_ID } });
    expect(JSON.stringify(marker)).not.toContain("Bearer");
    expect(JSON.stringify(marker)).not.toContain("token");
    expect(() => buildOpenKrittRequestMarker("x".repeat(121))).toThrow(/bounded|length|request/i);
  });

  it("encodes the documented remote request without credentials, absolute paths, or provider secrets", () => {
    const body = buildOpenKrittLaunchRequestBody({
      source: remoteSource,
      requestId: OPEN_KRITT_REQUEST_ID,
      configuration: launchConfiguration,
    });

    expect(body).toMatchObject({
      repo_kind: "remote",
      repo_full: "Kritt-ai/open-kritt",
      commit_sha: FULL_COMMIT_SHA,
      // Verified against v1.2.0 `validateScan`: the selection is read from the
      // request root, and the ranker is submitted as its Markdown body.
      workflowId: launchConfiguration.workflowId,
      postScriptId: launchConfiguration.postScriptIds[0],
      model: launchConfiguration.modelId,
      model_provider: launchConfiguration.providerId,
      harness: launchConfiguration.harness,
      thinking_effort: launchConfiguration.thinkingEffort,
      severity_ranker: launchConfiguration.severityRankerContent,
      job_limit: launchConfiguration.jobLimit,
      configuration: { not_codex: { request_id: OPEN_KRITT_REQUEST_ID } },
    });
    expect(body).not.toHaveProperty("severity_ranker_id");
    expect(JSON.stringify(body)).not.toContain("/Users/");
    expect(JSON.stringify(body)).not.toContain("Authorization");
  });

  it("submits only an immediate generated folder name for local snapshots", () => {
    expect(
      buildOpenKrittLocalScanRequestBody({
        snapshotFolderName: "nc126-snapshot-a1b2c3",
        requestId: OPEN_KRITT_REQUEST_ID,
        configuration: launchConfiguration,
      }),
    ).toMatchObject({ repo_kind: "local", repo_full: "nc126-snapshot-a1b2c3" });
    expect(() =>
      buildOpenKrittLocalScanRequestBody({
        snapshotFolderName: "/srv/notcodex/open-kritt-snapshots/nc126-snapshot-a1b2c3",
        requestId: OPEN_KRITT_REQUEST_ID,
        configuration: launchConfiguration,
      }),
    ).toThrow(/immediate|absolute|folder/i);
  });

  it("elects a launch policy only from the values upstream accepts", () => {
    expect(
      buildOpenKrittLaunchRequestBody({
        source: remoteSource,
        requestId: OPEN_KRITT_REQUEST_ID,
        configuration: launchConfiguration,
        launchPolicy: "queue",
      }),
    ).toMatchObject({ launchPolicy: "queue" });
    expect(() =>
      buildOpenKrittLaunchRequestBody({
        source: remoteSource,
        requestId: OPEN_KRITT_REQUEST_ID,
        configuration: launchConfiguration,
        launchPolicy: "launch-concurrently",
      }),
    ).toThrow(/launch policy/i);
  });

  it("decodes 201, launch-policy 409, and bounded field-level 422 responses", () => {
    expect(classifyOpenKrittLaunchResponse(201, scanResponse)).toEqual({
      kind: "accepted",
      externalScanId: OPEN_KRITT_SCAN_ID,
    });
    expect(
      classifyOpenKrittLaunchResponse(409, {
        error: "Another scan is running. Choose whether to start immediately or queue this scan.",
        code: "scan_launch_policy_required",
        errors: [{ field: "launchPolicy", message: "Choose whether to start immediately." }],
      }),
    ).toMatchObject({ kind: "policy-required", choices: ["immediate", "queue"] });
    expect(
      classifyOpenKrittLaunchResponse(422, {
        error: "Validation failed.",
        errors: [{ field: "target.repo_full", message: "A repository is required." }],
      }),
    ).toMatchObject({
      kind: "validation-error",
      fieldErrors: [{ field: "target.repo_full", message: "A repository is required." }],
    });
    // A conflict that is not the launch-policy choice must not be presented as one.
    expect(() =>
      classifyOpenKrittLaunchResponse(409, { error: "Cannot delete a running scan." }),
    ).toThrow(/conflict/i);
  });

  it("refuses control transitions upstream does not authorize", () => {
    // v1.2.0 answers an unauthorized PATCH with a 500, so it is refused locally.
    expect(isOpenKrittControlAuthorized("pause", "running")).toBe(true);
    expect(isOpenKrittControlAuthorized("stop", "queued")).toBe(true);
    expect(isOpenKrittControlAuthorized("resume", "paused")).toBe(true);
    expect(isOpenKrittControlAuthorized("pause", "queued")).toBe(false);
    expect(isOpenKrittControlAuthorized("resume", "rate_limited")).toBe(false);
    expect(isOpenKrittControlAuthorized("stop", "completed")).toBe(false);
    expect(openKrittControlStatus("resume")).toBe("pending");
  });

  it("reads its own launch marker back out of a stored configuration", () => {
    expect(readOpenKrittRequestMarker(scanResponse.configuration)).toBe(OPEN_KRITT_REQUEST_ID);
    expect(readOpenKrittRequestMarker({ not_codex: {} })).toBeNull();
    expect(readOpenKrittRequestMarker("nope")).toBeNull();
  });

  it("keeps an uncertain POST queued/waiting and never classifies it as success or failure", () => {
    expect(launchResolutionForTimeout()).toEqual({
      launchResolution: "unknown",
      durableState: "waiting",
      requiresReconciliation: true,
    });
  });

  it("maps scan status while preserving the upstream phase and avoiding destructive cleanup", () => {
    expect(mapOpenKrittStatus({ status: "post_processing", phase: "settling" })).toEqual(
      expect.objectContaining({ state: "running", upstreamPhase: "settling" }),
    );
    expect(mapOpenKrittStatus({ status: "completed", phase: "done" })).toEqual(
      expect.objectContaining({ state: "succeeded" }),
    );
  });
});
