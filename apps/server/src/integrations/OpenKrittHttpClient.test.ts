// These tests drive the raw Node/WHATWG transport directly, so they need real
// wall-clock timers to simulate a peer that dribbles a body.
// @effect-diagnostics globalTimers:off nodeBuiltinImport:off
import * as NodeHttp from "node:http";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  type FakeOpenKrittFetch,
  makeFakeOpenKrittFetch,
  OPEN_KRITT_TEST_TOKEN,
  OPEN_KRITT_TEST_URL,
  scanResponse,
} from "./test/openKrittTestFixtures.ts";
import {
  OpenKrittHttpClientError,
  requestOpenKritt,
  pinnedOpenKrittLookup,
  OPEN_KRITT_HTTP_LIMITS,
} from "./Layers/OpenKrittHttpClient.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Open Kritt server-only HTTP client", () => {
  it("bounds DNS resolution by the total request deadline before opening a socket", async () => {
    let fetchCalled = false;
    await expect(
      requestOpenKritt({
        fetch: () => {
          fetchCalled = true;
          return Promise.resolve(new Response());
        },
        resolveAddresses: () => new Promise(() => undefined),
        serverUrl: "https://open-kritt.example",
        token: null,
        method: "POST",
        path: "/api/scans",
        expectedContentType: "application/json",
        totalRequestMs: 25,
        retry: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ code: "resolution-error" });
    expect(fetchCalled).toBe(false);
  });

  it("bounds total call duration even when every chunk arrives inside the idle window", async () => {
    let cancelled = false;
    const dribble = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              if (!cancelled) controller.enqueue(new TextEncoder().encode("x"));
              resolve();
            }, 10);
          });
        },
        cancel() {
          cancelled = true;
        },
      });

    await expect(
      requestOpenKritt({
        fetch: () =>
          Promise.resolve(
            new Response(dribble(), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ),
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: "/api/health",
        expectedContentType: "application/json",
        // Each chunk resets the idle timer, so only the total budget can stop this.
        idleTimeoutMs: 5_000,
        totalRequestMs: 150,
        retry: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(cancelled).toBe(true);
  });

  it("sends only the configured origin/path and a bearer token from the server boundary", async () => {
    const fake = makeFakeOpenKrittFetch({
      "GET /api/health": {
        status: 200,
        contentType: "application/json",
        body: { status: "ok", service: "open-kritt" },
      },
    });

    const result = await requestOpenKritt({
      fetch: fake.fetch,
      serverUrl: OPEN_KRITT_TEST_URL,
      token: OPEN_KRITT_TEST_TOKEN,
      method: "GET",
      path: "/api/health",
      expectedContentType: "application/json",
    });

    expect(result).toMatchObject({ status: 200, body: { service: "open-kritt" } });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe(`${OPEN_KRITT_TEST_URL}/api/health`);
    expect(fake.calls[0]?.headers.get("authorization")).toBe(`Bearer ${OPEN_KRITT_TEST_TOKEN}`);
  });

  it("rejects unexpected content types and malformed/oversized bodies before decoding", async () => {
    const contentTypeFake = makeFakeOpenKrittFetch({
      "GET /api/health": {
        status: 200,
        contentType: "text/html",
        body: "<html>not an API response</html>",
      },
    });
    await expect(
      requestOpenKritt({
        fetch: contentTypeFake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: "/api/health",
        expectedContentType: "application/json",
      }),
    ).rejects.toMatchObject({ _tag: "OpenKrittHttpClientError", code: "unexpected-content-type" });

    const oversizedFake = makeFakeOpenKrittFetch({
      "GET /api/health": {
        status: 200,
        contentType: "application/json",
        body: "x".repeat(OPEN_KRITT_HTTP_LIMITS.responseBodyBytes + 1),
      },
    });
    await expect(
      requestOpenKritt({
        fetch: oversizedFake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: "/api/health",
        expectedContentType: "application/json",
      }),
    ).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("rejects an unexpected content type without reading the response body", async () => {
    // A misconfigured reverse proxy can answer every poll tick with a large HTML
    // error page. Reading it before checking the declared type would stream up to
    // the full body cap on each tick only to discard it, so the type check has to
    // come first and cancel the stream.
    let bytesPulled = 0;
    const htmlBody = "<html>not an API response</html>".repeat(4_096);
    let cancelled = false;
    const fetchImpl = (): Promise<Response> =>
      Promise.resolve(
        new Response(
          // A zero high-water mark keeps the source lazy, so `bytesPulled` counts
          // only what a *reader* asked for rather than eager queue filling.
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                const chunk = new TextEncoder().encode(htmlBody);
                bytesPulled += chunk.byteLength;
                controller.enqueue(chunk);
                controller.close();
              },
              cancel() {
                cancelled = true;
              },
            },
            new CountQueuingStrategy({ highWaterMark: 0 }),
          ),
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
        ),
      );

    await expect(
      requestOpenKritt({
        fetch: fetchImpl,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: "/api/health",
        expectedContentType: "application/json",
      }),
    ).rejects.toMatchObject({ code: "unexpected-content-type" });
    expect(bytesPulled).toBe(0);
    expect(cancelled).toBe(true);
  });

  it("classifies 401/403 without including upstream bodies or the bearer token", async () => {
    const fake = makeFakeOpenKrittFetch({
      "GET /api/health": {
        status: 401,
        contentType: "application/json",
        body: {
          detail: `secret upstream response ${OPEN_KRITT_TEST_TOKEN}`,
        },
      },
    });

    const error = await requestOpenKritt({
      fetch: fake.fetch,
      serverUrl: OPEN_KRITT_TEST_URL,
      token: OPEN_KRITT_TEST_TOKEN,
      method: "GET",
      path: "/api/health",
      expectedContentType: "application/json",
    }).catch((cause: unknown) => cause as OpenKrittHttpClientError);

    expect(error).toMatchObject({ code: "unauthorized", status: 401 });
    expect(error.message).not.toContain(OPEN_KRITT_TEST_TOKEN);
    expect(error.message).not.toContain("secret upstream response");
    expect(JSON.stringify(error)).not.toContain(OPEN_KRITT_TEST_TOKEN);
  });

  it("retries bounded idempotent reads with jitter but never retries a POST with uncertain acceptance", async () => {
    let getAttempts = 0;
    const getFake = makeFakeOpenKrittFetch({
      "GET /api/scans": {
        status: 503,
        contentType: "application/json",
        body: { detail: "temporary" },
      },
    });
    const getFetch: FakeOpenKrittFetch = async (input, init) => {
      getAttempts += 1;
      if (getAttempts === 2) {
        return new Response(
          JSON.stringify({ items: [scanResponse], page: 1, pageSize: 100, totalPages: 1 }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return getFake.fetch(input, init);
    };

    await expect(
      requestOpenKritt({
        fetch: getFetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: "/api/scans",
        expectedContentType: "application/json",
        retry: { maxAttempts: 2, baseDelayMs: 0, jitterMs: 0 },
      }),
    ).resolves.toMatchObject({ status: 200 });
    expect(getAttempts).toBe(2);

    const postFake = makeFakeOpenKrittFetch({
      "POST /api/scans": {
        status: 201,
        contentType: "application/json",
        body: { id: "accepted-after-network-loss" },
        delayMs: 100,
      },
    });
    await expect(
      requestOpenKritt({
        fetch: postFake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "POST",
        path: "/api/scans",
        body: { configuration: { not_codex: { request_id: "stable-marker" } } },
        expectedContentType: "application/json",
        timeoutMs: 1,
        retry: { maxAttempts: 5, baseDelayMs: 0, jitterMs: 0 },
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(postFake.calls).toHaveLength(1);
  });

  it("cancels a retryable 5xx response body before starting the next attempt", async () => {
    let attempts = 0;
    let cancelled = false;
    const fetchImpl = (): Promise<Response> => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.enqueue(new TextEncoder().encode("temporary failure"));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { status: 503, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };

    await expect(
      requestOpenKritt({
        fetch: fetchImpl,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: "/api/health",
        expectedContentType: "application/json",
        retry: { maxAttempts: 2, baseDelayMs: 0, jitterMs: 0 },
      }),
    ).resolves.toMatchObject({ status: 200 });
    expect(cancelled).toBe(true);
    expect(attempts).toBe(2);
  });

  it("accepts only same-origin redirects and never follows an origin-changing Location", async () => {
    const redirectFake = makeFakeOpenKrittFetch({
      "GET /api/health": {
        status: 302,
        contentType: "text/plain",
        body: "redirected",
      },
    });

    await expect(
      requestOpenKritt({
        fetch: redirectFake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "GET",
        path: "/api/health",
        expectedContentType: "application/json",
        redirect: { location: "https://attacker.example/api/health" },
      }),
    ).rejects.toMatchObject({ code: "unsafe-redirect" });
  });

  it("follows a validated same-origin redirect exactly once", async () => {
    const fake = makeFakeOpenKrittFetch({
      "GET /api/health": {
        status: 301,
        headers: { location: "/api/health/" },
        body: "",
      },
      "GET /api/health/": {
        status: 200,
        contentType: "application/json",
        body: { status: "ok", service: "open-kritt" },
      },
    });

    const result = await requestOpenKritt({
      fetch: fake.fetch,
      serverUrl: OPEN_KRITT_TEST_URL,
      token: null,
      method: "GET",
      path: "/api/health",
      expectedContentType: "application/json",
    });

    expect(result).toMatchObject({ status: 200, body: { service: "open-kritt" } });
    expect(fake.calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/api/health",
      "/api/health/",
    ]);
  });

  it("refuses to replay a redirected POST so a scan is never created twice", async () => {
    const fake = makeFakeOpenKrittFetch({
      "POST /api/scans": {
        status: 302,
        headers: { location: "/api/scans/6" },
        body: "",
      },
      "POST /api/scans/6": {
        status: 201,
        contentType: "application/json",
        body: { id: 7 },
      },
    });

    await expect(
      requestOpenKritt({
        fetch: fake.fetch,
        serverUrl: OPEN_KRITT_TEST_URL,
        token: null,
        method: "POST",
        path: "/api/scans",
        body: { repo_kind: "remote" },
        expectedContentType: "application/json",
      }),
    ).rejects.toMatchObject({ code: "unsafe-redirect", status: 302 });
    // The upstream may already have accepted the scan; exactly one POST left here.
    expect(fake.calls).toHaveLength(1);
  });

  it.each([301, 302, 303, 307, 308] as const)(
    "refuses a %i redirect of a PATCH rather than repeating the mutation",
    async (status) => {
      const fake = makeFakeOpenKrittFetch({
        "PATCH /api/scans/6": {
          status,
          headers: { location: "/api/scans/6/" },
          body: "",
        },
      });

      await expect(
        requestOpenKritt({
          fetch: fake.fetch,
          serverUrl: OPEN_KRITT_TEST_URL,
          token: null,
          method: "PATCH",
          path: "/api/scans/6",
          body: { status: "stopped" },
          expectedContentType: "application/json",
        }),
      ).rejects.toMatchObject({ code: "unsafe-redirect" });
      expect(fake.calls).toHaveLength(1);
    },
  );

  it("reaches a private host only when the operator allowlisted its address", async () => {
    const fake = makeFakeOpenKrittFetch({
      "GET /api/health": {
        status: 200,
        contentType: "application/json",
        body: { status: "ok", service: "open-kritt" },
      },
    });
    const shared = {
      fetch: fake.fetch,
      serverUrl: "https://kritt.internal",
      token: null,
      method: "GET",
      path: "/api/health",
      expectedContentType: "application/json",
      retry: { maxAttempts: 1 },
      resolveAddresses: async () => ["192.168.10.20"],
    } as const;

    await expect(requestOpenKritt({ ...shared })).rejects.toMatchObject({ code: "invalid-url" });
    await expect(
      requestOpenKritt({ ...shared, allowedPrivateAddresses: ["10.1.0.0/24"] }),
    ).rejects.toMatchObject({ code: "invalid-url" });
    await expect(
      requestOpenKritt({ ...shared, allowedPrivateAddresses: ["192.168.10.0/24"] }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("never lets an allowlist entry open the cloud metadata address", async () => {
    await expect(
      requestOpenKritt({
        fetch: makeFakeOpenKrittFetch({}).fetch,
        serverUrl: "https://kritt.internal",
        token: null,
        method: "GET",
        path: "/api/health",
        expectedContentType: "application/json",
        retry: { maxAttempts: 1 },
        resolveAddresses: async () => ["169.254.169.254"],
        allowedPrivateAddresses: ["169.254.169.254", "0.0.0.0/0"],
      }),
    ).rejects.toMatchObject({ code: "invalid-url" });
  });

  it("reports a redirect loop instead of chasing it", async () => {
    const fake = makeFakeOpenKrittFetch({
      "GET /api/health": {
        status: 302,
        headers: { location: "/api/health" },
        body: "",
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
        retry: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ code: "unsafe-redirect" });
  });

  it("accepts a dual-stack host by connecting only to the approved addresses", async () => {
    const fake = makeFakeOpenKrittFetch({
      "GET /api/health": {
        status: 200,
        contentType: "application/json",
        body: { status: "ok", service: "open-kritt" },
      },
    });

    const result = await requestOpenKritt({
      fetch: fake.fetch,
      serverUrl: OPEN_KRITT_TEST_URL,
      token: null,
      method: "GET",
      path: "/api/health",
      expectedContentType: "application/json",
      // A public A record beside a unique-local AAAA record is ordinary on a
      // dual-stack network and must not disable the connector.
      resolveAddresses: async () => ["93.184.216.34", "fc00::1"],
    });

    expect(result.status).toBe(200);
  });

  it("accepts a public IPv6-only host", async () => {
    const fake = makeFakeOpenKrittFetch({
      "GET /api/health": {
        status: 200,
        contentType: "application/json",
        body: { status: "ok", service: "open-kritt" },
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
        resolveAddresses: async () => ["2606:4700:4700::1111"],
      }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("rejects a host whose resolved address is disallowed", async () => {
    await expect(
      requestOpenKritt({
        serverUrl: "https://kritt.example",
        token: null,
        method: "GET",
        path: "/api/health",
        expectedContentType: "application/json",
        resolveAddresses: async () => ["169.254.169.254"],
        retry: { maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ code: "invalid-url" });
  });

  it("frames request bodies with content-length instead of chunked transfer encoding", async () => {
    const seen: Array<Record<string, string | string[] | undefined>> = [];
    const body = { repo_full: "Kritt-ai/open-kritt" };
    const server = NodeHttp.createServer((request, response) => {
      seen.push(request.headers);
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: 1, status: "queued" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    try {
      await requestOpenKritt({
        serverUrl: `http://127.0.0.1:${port}`,
        token: null,
        method: "POST",
        path: "/api/scans",
        body,
        expectedContentType: "application/json",
        retry: { maxAttempts: 1 },
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // A reverse proxy that rebuffers or rejects a chunked POST would strand the
    // launch in the expensive "unknown" resolution path.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.["content-length"]).toBe(String(Buffer.byteLength(JSON.stringify(body))));
    expect(seen[0]?.["transfer-encoding"]).toBeUndefined();
  });

  it("pins the connection to the approved address so a rebinding re-resolution cannot apply", () => {
    const lookup = pinnedOpenKrittLookup(["93.184.216.34"]);
    const observed: unknown[] = [];
    // The pinned lookup ignores the hostname entirely; a second, attacker
    // controlled DNS answer has no path into the socket.
    lookup("kritt.example", {}, (_error, address, family) => observed.push({ address, family }));
    lookup("kritt.attacker.example", {}, (_error, address, family) =>
      observed.push({ address, family }),
    );

    expect(observed).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  it("offers every approved address when the transport asks for all of them", () => {
    const lookup = pinnedOpenKrittLookup(["93.184.216.34", "2606:4700:4700::1111"]);
    let observed: unknown;
    lookup("kritt.example", { all: true }, (_error, addresses) => {
      observed = addresses;
    });

    // Failover stays inside the approved set; no unapproved address is reachable.
    expect(observed).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
  });

  it("fails the pinned lookup when no approved address survived validation", () => {
    const lookup = pinnedOpenKrittLookup([]);
    let error: Error | null = null;
    lookup("kritt.example", {}, (cause) => {
      error = cause;
    });
    expect(error).toBeInstanceOf(Error);
  });

  it("applies the approved reverse-proxy base path to requests and followed redirects", async () => {
    const requested: string[] = [];
    const result = await requestOpenKritt({
      fetch: (input) => {
        const url = String(input);
        requested.push(new URL(url).pathname);
        return Promise.resolve(
          requested.length === 1
            ? new Response(null, {
                status: 307,
                headers: { location: "/kritt/api/scans/" },
              })
            : new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
        );
      },
      serverUrl: "http://127.0.0.1:8765/kritt",
      token: null,
      method: "GET",
      path: "/api/scans",
      expectedContentType: "application/json",
      retry: { maxAttempts: 1 },
    });

    expect(result.status).toBe(200);
    // The follow-up must not be double-prefixed (/kritt/kritt/api/scans/).
    expect(requested).toEqual(["/kritt/api/scans", "/kritt/api/scans/"]);
  });

  it("refuses a same-origin redirect that escapes the approved base path", async () => {
    await expect(
      requestOpenKritt({
        fetch: () =>
          Promise.resolve(new Response(null, { status: 302, headers: { location: "/admin" } })),
        serverUrl: "http://127.0.0.1:8765/kritt",
        token: null,
        method: "GET",
        path: "/api/scans",
        expectedContentType: "application/json",
        retry: { maxAttempts: 1 },
      }),
    ).rejects.toThrow(OpenKrittHttpClientError);
  });
});
