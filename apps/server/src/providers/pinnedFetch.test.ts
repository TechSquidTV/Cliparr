import { TEST_PUBLIC_ADDRESS } from "@/test/providerFixtures";
import { PRIVATE_IPV4_ADDRESSES } from "@/test/networkPolicyFixtures";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { createServer } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import test, { afterEach, type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Agent } from "undici";
import {
  closePooledPinnedDnsAgents,
  fetchWithPinnedDns,
} from "@/providers/shared/pinnedFetch";
import { fetchMediaHandleRequest } from "@/providers/shared/mediaProxy";
import { isApiError } from "@/http/errors";
import { requestPlexPmsIdentity } from "@/providers/plex/pmsClient";
import { fetchPublicSystemInfo } from "@/providers/jellyfin/shared";
import { authenticateWithCredentials } from "@/providers/jellyfin/auth";

afterEach(closePooledPinnedDnsAgents);

function capturePinnedDispatchers(context: TestContext) {
  const dispatchers: Agent[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (
      _input: Parameters<typeof fetch>[0],
      init?: RequestInit & { dispatcher?: Agent },
    ) => {
      assert.ok(init?.dispatcher instanceof Agent);
      dispatchers.push(init.dispatcher);
      return new Response("segment");
    },
  );
  return dispatchers;
}

void test("reuses a pinned agent for the same address set across hostnames", async (context) => {
  const dispatchers = capturePinnedDispatchers(context);
  await fetchWithPinnedDns(new URL("https://first.invalid/segment.ts"), {}, [
    "127.0.0.1",
    "::1",
  ]);
  const first = dispatchers[0];
  assert.ok(first);
  await fetchWithPinnedDns(new URL("https://second.invalid/segment.ts"), {}, [
    "::1",
    "127.0.0.1",
  ]);
  assert.equal(dispatchers[1], first);
  assert.equal(first.closed, false);
});

void test("uses different pinned agents for different address sets", async (context) => {
  const dispatchers = capturePinnedDispatchers(context);
  const url = new URL("https://media.invalid/segment.ts");
  await fetchWithPinnedDns(url, {}, ["127.0.0.1"]);
  await fetchWithPinnedDns(url, {}, ["127.0.0.2"]);
  assert.notEqual(dispatchers[0], dispatchers[1]);
});

void test("refreshes last-used time and evicts idle pinned agents lazily", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 0 });
  const dispatchers = capturePinnedDispatchers(context);
  const url = new URL("https://media.invalid/segment.ts");
  await fetchWithPinnedDns(url, {}, ["127.0.0.1"]);
  const first = dispatchers[0];
  assert.ok(first);
  context.mock.timers.tick(40_000);
  await fetchWithPinnedDns(url, {}, ["127.0.0.1"]);
  context.mock.timers.tick(40_000);
  await fetchWithPinnedDns(url, {}, ["127.0.0.1"]);
  assert.equal(dispatchers[2], first);
  assert.equal(first.closed, false);
  context.mock.timers.tick(60_001);
  await fetchWithPinnedDns(url, {}, ["127.0.0.2"]);
  assert.equal(first.closed, true);
  await fetchWithPinnedDns(url, {}, ["127.0.0.1"]);
  assert.notEqual(dispatchers[4], first);
});

void test("caps rotating address sets at 32 agents and evicts the least recently used", async (context) => {
  const dispatchers = capturePinnedDispatchers(context);
  const url = new URL("https://media.invalid/segment.ts");
  for (let index = 1; index <= 32; index += 1) {
    await fetchWithPinnedDns(url, {}, [`127.0.0.${index}`]);
  }
  await fetchWithPinnedDns(url, {}, ["127.0.0.1"]);
  assert.equal(dispatchers[32], dispatchers[0]);
  await fetchWithPinnedDns(url, {}, ["127.0.0.33"]);
  assert.equal(dispatchers[0]?.closed, false);
  assert.equal(dispatchers[1]?.closed, true);
  for (let index = 34; index <= 64; index += 1) {
    await fetchWithPinnedDns(url, {}, [`127.0.0.${index}`]);
  }
  assert.ok(dispatchers.slice(0, 32).every((agent) => agent.closed));
  assert.equal(dispatchers.filter((agent) => !agent.closed).length, 32);
});

void test("closes and clears the pooled agents", async (context) => {
  const dispatchers = capturePinnedDispatchers(context);
  const url = new URL("https://media.invalid/segment.ts");
  await fetchWithPinnedDns(url, {}, ["127.0.0.1"]);
  const first = dispatchers[0];
  assert.ok(first);
  await closePooledPinnedDnsAgents();
  assert.equal(first.closed, true);
  assert.equal(first.destroyed, true);
  await fetchWithPinnedDns(url, {}, ["127.0.0.1"]);
  assert.notEqual(dispatchers[1], first);
});

void test("the pinned dispatcher overrides a caller-supplied dispatcher", async (context) => {
  const dispatchers = capturePinnedDispatchers(context);
  const supplied = new Agent();
  const init: RequestInit & { dispatcher: Agent } = { dispatcher: supplied };
  try {
    await fetchWithPinnedDns(
      new URL("https://media.invalid/segment.ts"),
      init,
      ["127.0.0.1"],
    );
    assert.notEqual(dispatchers[0], supplied);
  } finally {
    await supplied.close();
  }
});

for (const [url, addresses] of [
  ["https://media.invalid/segment.ts", undefined],
  ["http://127.0.0.1/segment.ts", []],
  ["http://[::1]/segment.ts", ["invalid"]],
] as const) {
  void test(`bypasses the pool for ${url} with ${JSON.stringify(addresses)} addresses`, async (context) => {
    const init = { redirect: "manual" } as const;
    const fetchMock = context.mock.method(
      globalThis,
      "fetch",
      async (
        input: Parameters<typeof fetch>[0],
        receivedInit?: RequestInit,
      ) => {
        assert.equal(input, url);
        assert.equal(receivedInit, init);
        return new Response("plain fetch");
      },
    );
    await fetchWithPinnedDns(new URL(url), init, addresses);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

void test("connects to pinned addresses while preserving the URL hostname", async () => {
  let requestHost: string | undefined;
  let connections = 0;
  const server = createServer((request, response) => {
    requestHost = request.headers.host;
    response.end("pinned response");
  });
  server.on("connection", () => {
    connections += 1;
  });
  try {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = new URL(`http://rebinding.invalid:${address.port}/media`);
    const response = await fetchWithPinnedDns(
      url,
      { signal: AbortSignal.timeout(3000) },
      ["127.0.0.1"],
    );
    assert.equal(await response.text(), "pinned response");
    assert.equal(response.url, url.toString());
    assert.equal(requestHost, `rebinding.invalid:${address.port}`);
    // Let the consumed response's socket return to undici's available pool.
    await setImmediate();
    const next = await fetchWithPinnedDns(
      new URL("segment-2.ts", url),
      { signal: AbortSignal.timeout(3000) },
      ["127.0.0.1"],
    );
    assert.equal(await next.text(), "pinned response");
    assert.equal(connections, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

void test("passes validated media DNS addresses to a pinned dispatcher", async (context) => {
  let resolutions = 0;
  context.mock.method(dns, "lookup", async () => {
    resolutions += 1;
    return [
      { address: resolutions === 1 ? "192.0.2.10" : "127.0.0.1", family: 4 },
    ];
  });
  syncBuiltinESMExports();
  context.mock.method(
    globalThis,
    "fetch",
    async (
      _input: Parameters<typeof fetch>[0],
      init?: RequestInit & { dispatcher?: Agent },
    ) => {
      assert.ok(init?.dispatcher instanceof Agent);
      assert.equal(init.redirect, "manual");
      return new Response("media");
    },
  );
  try {
    const response = await fetchMediaHandleRequest({
      id: "dns-pinning",
      providerId: "plex",
      sourceId: "source-1",
      baseUrl: "http://plex.example.test:32400",
      path: "https://media-rebinding.invalid/clip.mp4",
      token: "token",
      lastAccessedAt: 0,
    });
    assert.equal(await response.text(), "media");
    assert.equal(resolutions, 1);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

void test("fails closed for empty or invalid address sets even with cached agents", async (context) => {
  const dispatchers = capturePinnedDispatchers(context);
  const url = new URL("https://empty.invalid/media");
  await fetchWithPinnedDns(url, {}, ["127.0.0.1", "::1"]);
  for (const addresses of [
    [],
    ["invalid"],
    ["127.0.0.1", "invalid"],
    ["127.0.0.1,::1"],
  ]) {
    await assert.rejects(fetchWithPinnedDns(url, {}, addresses), {
      message: "No validated IP addresses are available for this request",
    });
  }
  assert.equal(dispatchers.length, 1);
});

void test("does not treat the local URL placeholder origin as a trusted provider", async (context) => {
  context.mock.method(dns, "lookup", async () => [
    { address: "127.0.0.1", family: 4 },
  ]);
  syncBuiltinESMExports();
  context.mock.method(globalThis, "fetch", () =>
    assert.fail("unsafe local URLs must not be fetched"),
  );
  try {
    await assert.rejects(
      fetchMediaHandleRequest({
        id: "local-placeholder",
        providerId: "local-url",
        sourceId: "remote-url",
        baseUrl: "http://cliparr.local",
        path: "http://cliparr.local/secret",
        token: "",
        lastAccessedAt: 0,
      }),
      (error: Error) =>
        isApiError(error) && error.code === "media_proxy_unsafe_url",
    );
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

for (const provider of ["plex", "jellyfin"] as const) {
  void test(`pins DNS for ${provider} API redirects`, async (context) => {
    let resolutions = 0;
    let requests = 0;
    context.mock.method(dns, "lookup", async () => {
      resolutions += 1;
      return [{ address: "192.0.2.10", family: 4 }];
    });
    syncBuiltinESMExports();
    context.mock.method(
      globalThis,
      "fetch",
      async (
        input: Parameters<typeof fetch>[0],
        init?: RequestInit & { dispatcher?: Agent },
      ) => {
        requests += 1;
        const request = new Request(input, init);
        if (new URL(request.url).hostname === `${provider}.example.test`) {
          return new Response(null, {
            status: 302,
            headers: { location: `https://${provider}-redirect.invalid/api` },
          });
        }
        assert.ok(init?.dispatcher instanceof Agent);
        assert.equal(request.headers.get("authorization"), null);
        assert.equal(request.headers.get("x-plex-token"), null);
        return Response.json(
          provider === "plex"
            ? { MediaContainer: { machineIdentifier: "server-1" } }
            : { Id: "server-1" },
        );
      },
    );
    try {
      if (provider === "plex") {
        await requestPlexPmsIdentity(
          { baseUrl: "http://plex.example.test", token: "provider-token" },
          {
            clientIdentifier: "test",
            product: "Cliparr",
            timeoutMs: 3000,
          },
        );
      } else {
        await fetchPublicSystemInfo({
          baseUrl: "http://jellyfin.example.test",
        });
      }
      assert.equal(resolutions, 2);
      assert.equal(requests, 2);
    } finally {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
}

for (const [index, address] of [
  TEST_PUBLIC_ADDRESS,
  ...PRIVATE_IPV4_ADDRESSES,
].entries()) {
  void test(`pins initial Plex PMS requests to validated ${address} addresses`, async (context) => {
    let resolutions = 0;
    context.mock.method(dns, "lookup", async () => {
      resolutions++;
      return [
        { address: resolutions === 1 ? address : "127.0.0.1", family: 4 },
      ];
    });
    syncBuiltinESMExports();
    context.mock.method(
      globalThis,
      "fetch",
      async (
        _input: Parameters<typeof fetch>[0],
        init?: RequestInit & { dispatcher?: Agent },
      ) => {
        assert.ok(init?.dispatcher instanceof Agent);
        assert.equal(new Headers(init.headers).get("X-Plex-Token"), "token");
        return Response.json({
          MediaContainer: { machineIdentifier: "server" },
        });
      },
    );
    try {
      await requestPlexPmsIdentity(
        {
          baseUrl: `http://plex-rebinding-allowed-${index}.example.test:32400`,
          token: "token",
        },
        { clientIdentifier: "test", product: "Cliparr", timeoutMs: 3000 },
      );
      assert.equal(resolutions, 1);
    } finally {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
}

for (const [index, address] of [
  "127.0.0.1",
  "169.254.169.254",
  "::1",
].entries()) {
  void test(`rejects initial Plex DNS resolving to ${address} before fetching`, async (context) => {
    const previousLoopbackSetting =
      process.env.CLIPARR_ALLOW_LOOPBACK_PLEX_URLS;
    delete process.env.CLIPARR_ALLOW_LOOPBACK_PLEX_URLS;
    context.after(() => {
      if (previousLoopbackSetting === undefined) {
        delete process.env.CLIPARR_ALLOW_LOOPBACK_PLEX_URLS;
      } else {
        process.env.CLIPARR_ALLOW_LOOPBACK_PLEX_URLS = previousLoopbackSetting;
      }
    });
    context.mock.method(dns, "lookup", async () => [
      { address: TEST_PUBLIC_ADDRESS, family: 4 },
      { address, family: address === "::1" ? 6 : 4 },
    ]);
    syncBuiltinESMExports();
    context.mock.method(globalThis, "fetch", () =>
      assert.fail("Unsafe DNS must not be fetched"),
    );
    try {
      await assert.rejects(
        requestPlexPmsIdentity(
          {
            baseUrl: `http://plex-rebinding-unsafe-${index}.example.test:32400`,
            token: "token",
          },
          { clientIdentifier: "test", product: "Cliparr", timeoutMs: 3000 },
        ),
        (error: Error) =>
          isApiError(error) && error.code === "plex_unsafe_redirect",
      );
    } finally {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
}

for (const address of [TEST_PUBLIC_ADDRESS, ...PRIVATE_IPV4_ADDRESSES]) {
  void test(`pins initial Jellyfin sign-in requests to validated ${address} addresses`, async (context) => {
    let resolutions = 0;
    const paths: string[] = [];
    context.mock.method(dns, "lookup", async () => {
      resolutions += 1;
      return [{ address, family: 4 }];
    });
    syncBuiltinESMExports();
    context.mock.method(
      globalThis,
      "fetch",
      async (
        input: Parameters<typeof fetch>[0],
        init?: RequestInit & { dispatcher?: Agent },
      ) => {
        assert.ok(init?.dispatcher instanceof Agent);
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        paths.push(path);
        if (path === "/System/Info/Public") {
          return Response.json({ Id: "server-1" });
        }
        assert.deepEqual(await request.json(), {
          Username: "admin",
          Pw: "password",
        });
        return Response.json({
          AccessToken: "token",
          ServerId: "server-1",
          User: { Id: "user-1", Policy: { IsAdministrator: true } },
        });
      },
    );
    try {
      await authenticateWithCredentials({
        serverUrl: "http://jellyfin-rebinding.invalid",
        username: "admin",
        password: "password",
      });
      assert.equal(resolutions, 3);
      assert.deepEqual(paths, [
        "/System/Info/Public",
        "/Users/AuthenticateByName",
      ]);
    } finally {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
}

void test("rejects Jellyfin DNS rebinding before sending sign-in credentials", async (context) => {
  let resolutions = 0;
  let requests = 0;
  context.mock.method(dns, "lookup", async () => {
    resolutions += 1;
    return [
      {
        address: resolutions < 3 ? "192.0.2.10" : "169.254.169.254",
        family: 4,
      },
    ];
  });
  syncBuiltinESMExports();
  context.mock.method(
    globalThis,
    "fetch",
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requests += 1;
      assert.equal(new Request(input, init).method, "GET");
      return Response.json({ Id: "server-1" });
    },
  );
  try {
    await assert.rejects(
      authenticateWithCredentials({
        serverUrl: "http://jellyfin-rebinding.invalid",
        username: "admin",
        password: "password",
      }),
      (error: Error) =>
        isApiError(error) && error.code === "invalid_jellyfin_server_url",
    );
    assert.equal(requests, 1);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
