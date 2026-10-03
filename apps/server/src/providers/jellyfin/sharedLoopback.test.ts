import {
  PRIVATE_IPV4_ADDRESSES,
  PRIVATE_IPV6_ADDRESS,
} from "@/test/networkPolicyFixtures";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import test, { beforeEach, afterEach } from "node:test";
import { Agent } from "undici";
import { closePooledPinnedDnsAgents } from "@/providers/shared/pinnedFetch";

const { fetchPublicSystemInfo } = await (async () => {
  const previous = process.env.CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS;
  const previousDevelopment = process.env.CLIPARR_DEV_JELLYFIN_URL;
  process.env.CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS = "true";
  delete process.env.CLIPARR_DEV_JELLYFIN_URL;
  try {
    return await import("@/providers/jellyfin/shared");
  } finally {
    if (previous === undefined) {
      delete process.env.CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS;
    } else {
      process.env.CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS = previous;
    }
    if (previousDevelopment !== undefined) {
      process.env.CLIPARR_DEV_JELLYFIN_URL = previousDevelopment;
    }
  }
})();

beforeEach((context) => {
  assert.ok("mock" in context);
  context.mock.method(dns, "lookup", async () => [
    { address: "127.0.0.1", family: 4 },
  ]);
  syncBuiltinESMExports();
  context.after(() => {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  });
});
afterEach(closePooledPinnedDnsAgents);

for (const hostname of [
  "127.0.0.1",
  "localhost",
  "[::1]",
  "[::ffff:127.0.0.1]",
  ...PRIVATE_IPV4_ADDRESSES,
  `[${PRIVATE_IPV6_ADDRESS}]`,
]) {
  void test(`opted-in Jellyfin permits the initial ${hostname} destination`, async (context) => {
    context.mock.method(globalThis, "fetch", async () =>
      Response.json({ Id: "server" }),
    );
    const result = await fetchPublicSystemInfo({
      baseUrl: `http://${hostname}:8096`,
    });
    assert.equal(result.Id, "server");
  });
}

for (const address of [
  "127.0.0.1",
  "::1",
  "0:0:0:0:0:0:0:1",
  "::ffff:127.0.0.1",
]) {
  void test(`opted-in Jellyfin pins hostname DNS resolving to ${address}`, async (context) => {
    const lookup = context.mock.method(dns, "lookup", async () => [
      { address, family: address.includes(":") ? 6 : 4 },
    ]);
    syncBuiltinESMExports();
    context.mock.method(
      globalThis,
      "fetch",
      async (
        _input: Parameters<typeof fetch>[0],
        init?: RequestInit & { dispatcher?: Agent },
      ) => {
        assert.ok(init?.dispatcher instanceof Agent);
        return Response.json({ Id: "server" });
      },
    );
    await fetchPublicSystemInfo({ baseUrl: "http://jellyfin.invalid:8096" });
    assert.equal(lookup.mock.callCount(), 1);
  });
}

for (const destination of [
  "http://127.0.0.1:8097/System/Info/Public",
  "http://localhost:8096/System/Info/Public",
  "http://[::1]:8096/System/Info/Public",
  "http://[::ffff:127.0.0.1]:8096/System/Info/Public",
  "http://other.invalid:8096/System/Info/Public",
]) {
  void test(`opted-in Jellyfin rejects another loopback origin ${destination}`, async (context) => {
    let fetchCalls = 0;
    context.mock.method(globalThis, "fetch", async () => {
      fetchCalls++;
      assert.equal(fetchCalls, 1);
      return new Response(null, {
        status: 302,
        headers: { location: destination },
      });
    });
    await assert.rejects(
      fetchPublicSystemInfo({ baseUrl: "http://127.0.0.1:8096" }),
      { code: "invalid_jellyfin_server_url" },
    );
    assert.equal(fetchCalls, 1);
  });
}

for (const intermediate of [
  "http://127.0.0.1:8096/same-origin",
  "http://198.51.100.10:8096/other-origin",
]) {
  void test(`opted-in Jellyfin permits redirects returning to the initial origin via ${intermediate}`, async (context) => {
    const requests: Request[] = [];
    context.mock.method(
      globalThis,
      "fetch",
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        if (requests.length <= 2) {
          return new Response(null, {
            status: 302,
            headers: {
              location:
                requests.length === 1
                  ? intermediate
                  : "http://127.0.0.1:8096/returned",
            },
          });
        }
        return Response.json({ Id: "server" });
      },
    );
    await fetchPublicSystemInfo({ baseUrl: "http://127.0.0.1:8096" });
    assert.deepEqual(
      requests.map((request) => request.url),
      [
        "http://127.0.0.1:8096/System/Info/Public",
        intermediate,
        "http://127.0.0.1:8096/returned",
      ],
    );
    if (new URL(intermediate).origin === "http://127.0.0.1:8096") {
      assert.ok(requests[2]?.headers.has("authorization"));
    } else {
      assert.equal(requests[2]?.headers.get("authorization"), null);
    }
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
  void test(`opted-in Jellyfin still blocks ${hostname} before fetching`, async (context) => {
    context.mock.method(globalThis, "fetch", () =>
      assert.fail("Unsafe destinations must not be fetched"),
    );
    await assert.rejects(
      fetchPublicSystemInfo({ baseUrl: `http://${hostname}:8096` }),
      { code: "invalid_jellyfin_server_url" },
    );
  });
}

void test("opted-in Jellyfin rejects unsafe DNS mixed with loopback", async (context) => {
  context.mock.method(dns, "lookup", async () => [
    { address: "127.0.0.1", family: 4 },
    { address: "169.254.169.254", family: 4 },
  ]);
  syncBuiltinESMExports();
  context.mock.method(globalThis, "fetch", () =>
    assert.fail("Unsafe DNS must not be fetched"),
  );
  await assert.rejects(
    fetchPublicSystemInfo({ baseUrl: "http://jellyfin.invalid:8096" }),
    { code: "invalid_jellyfin_server_url" },
  );
});
