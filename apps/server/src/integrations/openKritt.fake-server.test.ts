import { describe, expect, it } from "vite-plus/test";

import compatibilityFixture from "./fixtures/open-kritt-v1.2.0.json" with { type: "json" };
import { requestOpenKritt } from "./Layers/OpenKrittHttpClient.ts";
import {
  findingResponse,
  makeFakeOpenKrittFetch,
  OPEN_KRITT_TEST_URL,
  scanResponse,
} from "./test/openKrittTestFixtures.ts";

describe("deterministic Open Kritt fake server boundary", () => {
  it("covers healthy discovery, scan lifecycle, findings, and disappearing resources without network access", async () => {
    const fake = makeFakeOpenKrittFetch({
      "GET /api/health": {
        status: 200,
        contentType: "application/json",
        body: compatibilityFixture.responses.health,
      },
      "GET /api/workflows": {
        status: 200,
        contentType: "application/json",
        body: compatibilityFixture.responses.workflows,
      },
      "GET /api/scans": {
        status: 200,
        contentType: "application/json",
        body: compatibilityFixture.responses.scans,
      },
      "GET /api/scans/scan-1": {
        status: 404,
        contentType: "application/json",
        body: compatibilityFixture.errors.notFound.body,
      },
      [`GET /api/scans/${scanResponse.id}/vulnerabilities`]: {
        status: 200,
        contentType: "application/json",
        body: [findingResponse],
      },
    });

    await expect(
      requestOpenKritt({
        fetch: fake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: "/api/health",
        expectedContentType: "application/json",
      }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      requestOpenKritt({
        fetch: fake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: "/api/workflows",
        expectedContentType: "application/json",
      }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      requestOpenKritt({
        fetch: fake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: "/api/scans",
        expectedContentType: "application/json",
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: expect.objectContaining({
        totalPages: compatibilityFixture.responses.scans.totalPages,
      }),
    });
    await expect(
      requestOpenKritt({
        fetch: fake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: `/api/scans/${scanResponse.id}/vulnerabilities`,
        expectedContentType: "application/json",
      }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      requestOpenKritt({
        fetch: fake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: "/api/scans/scan-1",
        expectedContentType: "application/json",
      }),
    ).resolves.toMatchObject({ status: 404 });
  });

  it("covers unauthorized, launch policy, validation, malformed, oversized, and slow responses", async () => {
    const fake = makeFakeOpenKrittFetch({
      "GET /api/unauthorized": {
        status: 401,
        contentType: "application/json",
        body: compatibilityFixture.errors.unauthorized.body,
      },
      "POST /api/scans": {
        status: 409,
        contentType: "application/json",
        body: compatibilityFixture.errors.launchPolicyRequired.body,
      },
      "POST /api/scans/invalid": {
        status: 422,
        contentType: "application/json",
        body: compatibilityFixture.errors.validation.body,
      },
      "GET /api/malformed": { status: 200, contentType: "application/json", body: "{" },
      "GET /api/oversized": {
        status: 200,
        contentType: "application/json",
        body: "x".repeat(1_048_577),
      },
      "GET /api/slow": { status: 200, contentType: "application/json", body: {}, delayMs: 100 },
    });

    await expect(
      requestOpenKritt({
        fetch: fake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: "/api/unauthorized",
        expectedContentType: "application/json",
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    await expect(
      requestOpenKritt({
        fetch: fake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "POST",
        path: "/api/scans",
        expectedContentType: "application/json",
      }),
    ).resolves.toMatchObject({ status: 409 });
    await expect(
      requestOpenKritt({
        fetch: fake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "POST",
        path: "/api/scans/invalid",
        expectedContentType: "application/json",
      }),
    ).resolves.toMatchObject({ status: 422 });
    await expect(
      requestOpenKritt({
        fetch: fake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: "/api/malformed",
        expectedContentType: "application/json",
      }),
    ).rejects.toMatchObject({ code: "malformed-response" });
    await expect(
      requestOpenKritt({
        fetch: fake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: "/api/oversized",
        expectedContentType: "application/json",
      }),
    ).rejects.toMatchObject({ code: "response-too-large" });
    await expect(
      requestOpenKritt({
        fetch: fake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: "/api/slow",
        expectedContentType: "application/json",
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});
