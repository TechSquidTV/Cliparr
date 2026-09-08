import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { createServer } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { Agent } from "undici";
import { fetchWithPinnedDns } from "@/providers/shared/pinnedFetch";
import { fetchMediaHandleRequest } from "@/providers/shared/mediaProxy";
import { isApiError } from "@/http/errors";
import { requestPlexPmsIdentity } from "@/providers/plex/pmsClient";
import { fetchPublicSystemInfo } from "@/providers/jellyfin/shared";
import { authenticateWithCredentials } from "@/providers/jellyfin/auth";

void test("connects to pinned addresses while preserving the URL hostname", async () => {
  let requestHost: string | undefined;
  const server = createServer((request, response) => {
    requestHost = request.headers.host;
    response.end("pinned response");
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
      { address: resolutions === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 },
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
      baseUrl: "http://plex.local:32400",
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

void test("fails closed when a hostname has no validated addresses", async () => {
  await assert.rejects(
    fetchWithPinnedDns(new URL("https://empty.invalid/media"), {}, []),
    /No validated IP addresses/,
  );
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
      return [{ address: "93.184.216.34", family: 4 }];
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
        if (new URL(request.url).hostname === `${provider}.local`) {
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
          { baseUrl: "http://plex.local", token: "provider-token" },
          {
            clientIdentifier: "test",
            product: "Cliparr",
            timeoutMs: 3000,
          },
        );
      } else {
        await fetchPublicSystemInfo({ baseUrl: "http://jellyfin.local" });
      }
      assert.equal(resolutions, provider === "jellyfin" ? 2 : 1);
      assert.equal(requests, 2);
    } finally {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
}

for (const address of ["93.184.216.34", "192.168.1.50"]) {
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
        address: resolutions < 3 ? "93.184.216.34" : "169.254.169.254",
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
