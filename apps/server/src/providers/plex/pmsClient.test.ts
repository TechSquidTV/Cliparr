import {
  PRIVATE_IPV4_ADDRESSES,
  PRIVATE_IPV6_ADDRESS,
} from "@/test/networkPolicyFixtures";
import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { getEventListeners } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { setImmediate } from "node:timers/promises";
import { Agent } from "undici";
import { createDeferred } from "@/test/deferred";
import { isApiError } from "@/http/errors";
import {
  plexPmsResponseStatusMessage,
  openPlexEventStream,
  requestPlexPmsCurrentSessions,
  requestPlexPmsIdentity,
  requestPlexPmsMetadata,
  type PlexPmsRequestContext,
  type PlexPmsRequestOptions,
} from "@/providers/plex/pmsClient";

// Each security scenario gets a fresh DNS TTL window for its mocked answers.
let testTime = Date.now();
beforeEach((testContext) => {
  assert.ok("mock" in testContext);
  testTime += 60_001;
  testContext.mock.method(Date, "now", () => testTime);
});

const context: PlexPmsRequestContext = {
  baseUrl: "http://plex.example.test:32400",
  token: "server-token",
};

const options: PlexPmsRequestOptions = {
  clientIdentifier: "cliparr-test",
  product: "Cliparr",
  timeoutMs: 5000,
};

function withMockFetch(
  handler: (
    request: Request,
    init?: RequestInit & { dispatcher?: Agent },
  ) => Response | Promise<Response>,
  callback: () => Promise<void>,
  allowLoopback = false,
) {
  const originalFetch = globalThis.fetch;
  const previous = process.env.CLIPARR_ALLOW_LOOPBACK_PLEX_URLS;
  if (allowLoopback) {
    process.env.CLIPARR_ALLOW_LOOPBACK_PLEX_URLS = "true";
  } else {
    delete process.env.CLIPARR_ALLOW_LOOPBACK_PLEX_URLS;
  }
  const lookup = mock.method(dns, "lookup", async () => [
    { address: "192.0.2.10", family: 4 },
  ]);
  syncBuiltinESMExports();
  globalThis.fetch = (async (input, init) => {
    return handler(new Request(input, init), init);
  }) as typeof fetch;

  return callback().finally(() => {
    globalThis.fetch = originalFetch;
    if (previous === undefined) {
      delete process.env.CLIPARR_ALLOW_LOOPBACK_PLEX_URLS;
    } else {
      process.env.CLIPARR_ALLOW_LOOPBACK_PLEX_URLS = previous;
    }
    lookup.mock.restore();
    syncBuiltinESMExports();
  });
}

for (const hostname of [
  "127.0.0.1",
  "localhost",
  "[::1]",
  "[::ffff:127.0.0.1]",
  "169.254.169.254",
  "metadata.google.internal",
  "0.0.0.0",
  "[::]",
  "224.0.0.1",
  "[fe80::1]",
  "[ff02::1]",
]) {
  void test(`rejects initial Plex PMS requests to ${hostname} before fetching`, async () => {
    await withMockFetch(
      () => assert.fail("Unsafe Plex URLs must never be fetched"),
      async () => {
        await assert.rejects(
          requestPlexPmsIdentity(
            { ...context, baseUrl: `http://${hostname}:32400` },
            options,
          ),
          (error: Error) =>
            isApiError(error) &&
            error.status === 400 &&
            error.code === "plex_unsafe_redirect",
        );
      },
    );
  });
}

void test("rejects loopback Plex URLs with the opt-in hint by default", async () => {
  await withMockFetch(
    () => assert.fail("Loopback Plex URLs must never be fetched by default"),
    async () => {
      await assert.rejects(
        requestPlexPmsIdentity(
          { ...context, baseUrl: "http://127.0.0.1:32400" },
          options,
        ),
        (error: Error) =>
          isApiError(error) &&
          error.status === 400 &&
          error.code === "plex_unsafe_redirect" &&
          error.message.includes("CLIPARR_ALLOW_LOOPBACK_PLEX_URLS"),
      );
    },
  );
});

for (const hostname of ["127.0.0.1", "[::1]", "[::ffff:127.0.0.1]"]) {
  void test(`allows initial loopback Plex requests to ${hostname} only when opted in`, async () => {
    await withMockFetch(
      (request) => {
        assert.equal(request.headers.get("X-Plex-Token"), context.token);
        return jsonResponse({
          MediaContainer: { machineIdentifier: "loopback" },
        });
      },
      async () => {
        const result = await requestPlexPmsIdentity(
          { ...context, baseUrl: `http://${hostname}:32400` },
          options,
        );
        assert.equal(result.MediaContainer?.machineIdentifier, "loopback");
      },
      true,
    );
  });
}

for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
  void test(`pins opted-in initial Plex hostname requests resolving to ${address}`, async () => {
    await withMockFetch(
      (request, init) => {
        assert.equal(request.url, "http://localhost:32400/identity");
        assert.ok(init?.dispatcher instanceof Agent);
        assert.equal(request.headers.get("X-Plex-Token"), context.token);
        return jsonResponse({
          MediaContainer: { machineIdentifier: "loopback" },
        });
      },
      async () => {
        const lookup = mock.method(dns, "lookup", async () => [
          { address, family: address.includes(":") ? 6 : 4 },
        ]);
        syncBuiltinESMExports();
        try {
          await requestPlexPmsIdentity(
            { ...context, baseUrl: "http://localhost:32400" },
            options,
          );
          assert.equal(lookup.mock.callCount(), 1);
        } finally {
          lookup.mock.restore();
          syncBuiltinESMExports();
        }
      },
      true,
    );
  });
}

for (const hostname of [
  "169.254.169.254",
  "metadata.google.internal",
  "0.0.0.0",
  "[::]",
  "224.0.0.1",
  "[fe80::1]",
  "[ff02::1]",
]) {
  void test(`still rejects initial Plex requests to ${hostname} when loopback is opted in`, async () => {
    await withMockFetch(
      () => assert.fail("Unsafe Plex URLs must never be fetched"),
      async () => {
        await assert.rejects(
          requestPlexPmsIdentity(
            { ...context, baseUrl: `http://${hostname}:32400` },
            options,
          ),
          { code: "plex_unsafe_redirect" },
        );
      },
      true,
    );
  });
}

void test("rejects unsafe resolved addresses mixed with opted-in loopback", async () => {
  await withMockFetch(
    () => assert.fail("Unsafe DNS must never be fetched"),
    async () => {
      const lookup = mock.method(dns, "lookup", async () => [
        { address: "127.0.0.1", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ]);
      syncBuiltinESMExports();
      try {
        await assert.rejects(requestPlexPmsIdentity(context, options), {
          code: "plex_unsafe_redirect",
        });
      } finally {
        lookup.mock.restore();
        syncBuiltinESMExports();
      }
    },
    true,
  );
});

for (const intermediate of [
  "http://127.0.0.1:32400/same-origin",
  "http://198.51.100.10:32400/other-origin",
]) {
  void test(`allows opted-in redirects returning to the initial origin via ${intermediate}`, async () => {
    const requests: Request[] = [];
    const initial = "http://127.0.0.1:32400";
    await withMockFetch(
      (request) => {
        requests.push(request);
        if (requests.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: intermediate },
          });
        }
        if (requests.length === 2) {
          return new Response(null, {
            status: 302,
            headers: { location: `${initial}/returned` },
          });
        }
        return jsonResponse({
          MediaContainer: { machineIdentifier: "loopback" },
        });
      },
      async () => {
        await requestPlexPmsIdentity({ ...context, baseUrl: initial }, options);
        assert.deepEqual(
          requests.map((request) => request.url),
          [`${initial}/identity`, intermediate, `${initial}/returned`],
        );
        const crossedOrigin = new URL(intermediate).origin !== initial;
        assert.equal(
          requests[2]?.headers.get("X-Plex-Token"),
          crossedOrigin ? null : context.token,
        );
      },
      true,
    );
  });
}

for (const destination of [
  "http://127.0.0.1:32401/identity",
  "http://localhost:32400/identity",
  "http://plex.example.test:32400/identity",
]) {
  void test(`rejects opted-in redirects to loopback on another origin ${destination}`, async () => {
    let requests = 0;
    await withMockFetch(
      () => {
        requests++;
        assert.equal(requests, 1);
        return new Response(null, {
          status: 302,
          headers: { location: destination },
        });
      },
      async () => {
        const lookup = mock.method(dns, "lookup", async () => [
          { address: "127.0.0.1", family: 4 },
        ]);
        syncBuiltinESMExports();
        try {
          await assert.rejects(
            requestPlexPmsIdentity(
              { ...context, baseUrl: "http://127.0.0.1:32400" },
              options,
            ),
            { code: "plex_unsafe_redirect" },
          );
          assert.equal(requests, 1);
        } finally {
          lookup.mock.restore();
          syncBuiltinESMExports();
        }
      },
      true,
    );
  });
}

for (const hostname of [
  ...PRIVATE_IPV4_ADDRESSES,
  `[${PRIVATE_IPV6_ADDRESS}]`,
]) {
  void test(`allows initial LAN Plex PMS requests to ${hostname}`, async () => {
    await withMockFetch(
      (request) => {
        assert.equal(request.headers.get("X-Plex-Token"), context.token);
        return jsonResponse({ MediaContainer: { machineIdentifier: "lan" } });
      },
      async () => {
        const result = await requestPlexPmsIdentity(
          { ...context, baseUrl: `http://${hostname}:32400` },
          options,
        );
        assert.equal(result.MediaContainer?.machineIdentifier, "lan");
      },
    );
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  return Response.json(body, {
    ...init,
    headers,
  });
}

void test("already-aborted Plex requests skip DNS and fetch and preserve the abort reason", async (testContext) => {
  testContext.mock.method(dns, "lookup", () =>
    assert.fail("DNS must not start"),
  );
  testContext.mock.method(globalThis, "fetch", () =>
    assert.fail("Fetch must not start"),
  );
  syncBuiltinESMExports();
  testContext.after(() => {
    testContext.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const reason = new Error("Cancelled before starting");
  const signal = AbortSignal.abort(reason);
  await assert.rejects(
    requestPlexPmsIdentity(context, { ...options, signal }),
    (error: Error) => error === reason,
  );
  await assert.rejects(
    openPlexEventStream(context, new Headers(), signal),
    (error: Error) => error === reason,
  );
});

for (const scenario of [
  "caller abort",
  "timeout",
  "redirect abort",
  "event stream abort",
] as const) {
  void test(
    `Plex ${scenario} rejects while DNS is pending without a later fetch`,
    { timeout: 1000 },
    async (testContext) => {
      testContext.mock.timers.enable({ apis: ["setTimeout"] });
      const entered = createDeferred<void>();
      const pending = createDeferred<LookupAddress[]>();
      const controller = new AbortController();
      const reason = new Error("Cancelled during DNS");
      let fetchCalls = 0;
      testContext.mock.method(dns, "lookup", () => {
        entered.resolve();
        return pending.promise;
      });
      testContext.mock.method(globalThis, "fetch", async () => {
        fetchCalls++;
        assert.equal(scenario, "redirect abort");
        assert.equal(fetchCalls, 1);
        return new Response(null, {
          status: 302,
          headers: { location: "https://plex-redirect.invalid/identity" },
        });
      });
      syncBuiltinESMExports();
      testContext.after(() => {
        controller.abort();
        pending.resolve([{ address: "192.0.2.10", family: 4 }]);
        testContext.mock.restoreAll();
        syncBuiltinESMExports();
      });
      const requestContext =
        scenario === "redirect abort"
          ? { ...context, baseUrl: "http://192.0.2.10:32400" }
          : context;
      const request =
        scenario === "event stream abort"
          ? openPlexEventStream(
              requestContext,
              new Headers(),
              controller.signal,
            )
          : requestPlexPmsIdentity(requestContext, {
              ...options,
              signal: controller.signal,
            });
      const rejected = assert.rejects(request, (error: Error) =>
        scenario === "timeout" ? error.name === "AbortError" : error === reason,
      );
      await entered.promise;
      if (scenario === "timeout") {
        testContext.mock.timers.tick(options.timeoutMs);
      } else {
        controller.abort(reason);
      }
      // DNS remains unresolved until after the request has rejected.
      await rejected;
      const expectedFetchCalls = scenario === "redirect abort" ? 1 : 0;
      assert.equal(fetchCalls, expectedFetchCalls);
      pending.resolve([{ address: "192.0.2.10", family: 4 }]);
      await setImmediate();
      assert.equal(fetchCalls, expectedFetchCalls);
    },
  );
}

void test(
  "late DNS rejection after Plex cancellation is handled",
  { timeout: 1000 },
  async (testContext) => {
    const entered = createDeferred<void>();
    const pending = createDeferred<LookupAddress[]>();
    const controller = new AbortController();
    testContext.mock.method(dns, "lookup", () => {
      entered.resolve();
      return pending.promise;
    });
    testContext.mock.method(globalThis, "fetch", () =>
      assert.fail("Cancelled requests must not fetch"),
    );
    syncBuiltinESMExports();
    testContext.after(() => {
      controller.abort();
      pending.resolve([]);
      testContext.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const rejected = assert.rejects(
      requestPlexPmsIdentity(context, {
        ...options,
        signal: controller.signal,
      }),
      { name: "AbortError" },
    );
    await entered.promise;
    controller.abort();
    await rejected;
    pending.reject(new Error("DNS failed after cancellation"));
    await setImmediate();
  },
);

for (const outcome of ["success", "failure"] as const) {
  void test(`Plex DNS ${outcome} removes its abort listener`, async (testContext) => {
    const entered = createDeferred<void>();
    const pending = createDeferred<LookupAddress[]>();
    const controller = new AbortController();
    testContext.mock.method(dns, "lookup", () => {
      entered.resolve();
      return pending.promise;
    });
    testContext.mock.method(globalThis, "fetch", async () => {
      assert.equal(outcome, "success");
      return new Response("heartbeat", {
        headers: { "content-type": "text/event-stream" },
      });
    });
    syncBuiltinESMExports();
    testContext.after(() => {
      controller.abort();
      testContext.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const request = openPlexEventStream(
      context,
      new Headers(),
      controller.signal,
    );
    const completion =
      outcome === "failure"
        ? assert.rejects(request, { code: "plex_unsafe_redirect", status: 400 })
        : request.then((body) => body.cancel());
    await entered.promise;
    const listenerCount = getEventListeners(controller.signal, "abort").length;
    if (outcome === "failure") {
      pending.reject(new Error("DNS lookup failed"));
    } else {
      pending.resolve([{ address: "192.0.2.10", family: 4 }]);
    }
    await completion;
    assert.equal(
      getEventListeners(controller.signal, "abort").length,
      listenerCount - 1,
    );
  });
}

void test("requests current Plex sessions with Cliparr Plex headers", async () => {
  await withMockFetch(
    (request) => {
      assert.equal(
        request.url,
        "http://plex.example.test:32400/status/sessions",
      );
      assert.equal(request.headers.get("Accept"), "application/json");
      assert.equal(request.headers.get("X-Plex-Token"), "server-token");
      assert.equal(request.headers.get("X-Plex-Product"), "Cliparr");
      assert.equal(
        request.headers.get("X-Plex-Client-Identifier"),
        "cliparr-test",
      );

      return jsonResponse({
        MediaContainer: {
          Metadata: [],
        },
      });
    },
    async () => {
      const data = await requestPlexPmsCurrentSessions(context, options);
      assert.deepEqual(data, {
        MediaContainer: {
          Metadata: [],
        },
      });
    },
  );
});

void test("serializes Plex metadata ids through the generated SDK", async () => {
  await withMockFetch(
    (request) => {
      assert.equal(
        request.url,
        "http://plex.example.test:32400/library/metadata/123",
      );
      return jsonResponse({
        MediaContainer: {
          Metadata: [{ ratingKey: "123" }],
        },
      });
    },
    async () => {
      const data = await requestPlexPmsMetadata(context, ["123"], options);
      assert.deepEqual(data, {
        MediaContainer: {
          Metadata: [{ ratingKey: "123" }],
        },
      });
    },
  );
});

void test("validates Plex PMS redirects before following them", async () => {
  const requests: Request[] = [];

  await withMockFetch(
    (request) => {
      requests.push(request);
      if (request.url === "http://198.51.100.10:32400/identity") {
        return new Response(null, {
          status: 302,
          headers: {
            location: "http://[::ffff:127.0.0.1]:32400/identity",
          },
        });
      }

      throw new Error(`Unexpected request: ${request.url}`);
    },
    async () => {
      await assert.rejects(
        () =>
          requestPlexPmsIdentity(
            {
              baseUrl: "http://198.51.100.10:32400",
              token: "server-token",
            },
            options,
          ),
        (error: unknown) =>
          isApiError(error) &&
          error.status === 400 &&
          error.code === "plex_unsafe_redirect",
      );

      assert.deepEqual(
        requests.map((request) => request.url),
        ["http://198.51.100.10:32400/identity"],
      );
      assert.equal(requests[0]?.redirect, "manual");
    },
  );
});

void test("follows Plex PMS redirects to public targets without forwarding tokens", async () => {
  const requests: Request[] = [];

  await withMockFetch(
    (request) => {
      requests.push(request);
      if (request.url === "http://198.51.100.10:32400/identity") {
        return new Response(null, {
          status: 302,
          headers: {
            location: "http://203.0.113.20:32400/identity",
          },
        });
      }

      if (request.url === "http://203.0.113.20:32400/identity") {
        return jsonResponse({
          MediaContainer: {
            claimed: true,
            machineIdentifier: "plex-server-1",
            version: "1.41.0",
          },
        });
      }

      throw new Error(`Unexpected request: ${request.url}`);
    },
    async () => {
      const data = await requestPlexPmsIdentity(
        {
          baseUrl: "http://198.51.100.10:32400",
          token: "server-token",
        },
        options,
      );

      assert.deepEqual(data, {
        MediaContainer: {
          claimed: true,
          machineIdentifier: "plex-server-1",
          version: "1.41.0",
        },
      });
      assert.deepEqual(
        requests.map((request) => request.url),
        [
          "http://198.51.100.10:32400/identity",
          "http://203.0.113.20:32400/identity",
        ],
      );
      assert.equal(requests[0]?.headers.get("X-Plex-Token"), "server-token");
      assert.equal(requests[1]?.headers.get("X-Plex-Token"), null);
    },
  );
});

void test("maps failed Plex PMS responses to Cliparr API errors", async () => {
  await withMockFetch(
    () =>
      jsonResponse(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
          statusText: "Unauthorized",
        },
      ),
    async () => {
      let capturedError: unknown;
      await assert.rejects(
        async () => {
          try {
            await requestPlexPmsCurrentSessions(context, options);
          } catch (error) {
            capturedError = error;
            throw error;
          }
        },
        (error: unknown) =>
          isApiError(error) &&
          error.status === 401 &&
          error.code === "plex_request_failed" &&
          error.message === "Plex request failed: 401 Unauthorized",
      );
      assert.equal(
        plexPmsResponseStatusMessage(capturedError),
        "401 Unauthorized",
      );
    },
  );
});

void test("generated Plex events preserve HTTP failures and reject non-stream responses", async () => {
  await withMockFetch(
    () =>
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    async () => {
      await assert.rejects(
        openPlexEventStream(
          context,
          new Headers(),
          new AbortController().signal,
        ),
        (error: Error) => isApiError(error) && error.status === 401,
      );
    },
  );
  let cancelled = false;
  await withMockFetch(
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "text/html" } },
      ),
    async () => {
      await assert.rejects(
        openPlexEventStream(
          context,
          new Headers(),
          new AbortController().signal,
        ),
        /Plex did not return an event stream/,
      );
      assert.equal(cancelled, true);
    },
  );
});
