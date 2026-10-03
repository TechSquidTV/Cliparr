import {
  PRIVATE_IPV4_ADDRESSES,
  MAPPED_PRIVATE_IPV4_HOST,
} from "@/test/networkPolicyFixtures";
import {
  TEST_PLEX_BASE_URL,
  useProviderFixtures,
} from "@/test/providerFixtures";
import assert from "node:assert/strict";
import test from "node:test";
import { requestPlexPmsIdentity } from "@/providers/plex/pmsClient";
import { assertAllowedMediaHandleRequestUrl } from "@/providers/shared/mediaProxy";
import { isUnsafeRemoteHostname } from "@/providers/shared/networkPolicy";

void test("loopback allowance changes only loopback address classification", () => {
  for (const hostname of [
    "localhost",
    "plex.localhost",
    "LOCALHOST.",
    "127.0.0.1",
    "127.255.255.255",
    "::1",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
  ]) {
    assert.equal(
      isUnsafeRemoteHostname(hostname, { allowPrivate: true }),
      true,
      hostname,
    );
    assert.equal(
      isUnsafeRemoteHostname(hostname, {
        allowPrivate: true,
        allowLoopback: true,
      }),
      false,
      hostname,
    );
  }
  for (const hostname of [
    "metadata",
    "metadata.azure.internal",
    "metadata.google.internal",
    "169.254.169.254",
    "::ffff:a9fe:a9fe",
    "0.0.0.0",
    "::",
    "224.0.0.1",
    "fe80::1",
    "ff02::1",
  ]) {
    assert.equal(
      isUnsafeRemoteHostname(hostname, {
        allowPrivate: true,
        allowLoopback: true,
      }),
      true,
      hostname,
    );
  }
});

void test("Plex loopback opt-in leaves local URL proxy protection intact", async () => {
  const previous = process.env.CLIPARR_ALLOW_LOOPBACK_PLEX_URLS;
  process.env.CLIPARR_ALLOW_LOOPBACK_PLEX_URLS = "true";
  try {
    await assert.rejects(
      assertAllowedMediaHandleRequestUrl({
        providerId: "local-url",
        baseUrl: "http://127.0.0.1:32400",
        path: "http://127.0.0.1:32400/identity",
      }),
      { code: "media_proxy_unsafe_url" },
    );
  } finally {
    if (previous === undefined) {
      delete process.env.CLIPARR_ALLOW_LOOPBACK_PLEX_URLS;
    } else {
      process.env.CLIPARR_ALLOW_LOOPBACK_PLEX_URLS = previous;
    }
  }
});

void test("PMS redirects and media references share the unsafe-address policy", async () => {
  const context = { baseUrl: TEST_PLEX_BASE_URL, token: "test-token" };
  const options = {
    clientIdentifier: "test",
    product: "Cliparr",
    timeoutMs: 1000,
  };
  const originalFetch = globalThis.fetch;
  try {
    for (const hostname of [
      "0.1.2.3",
      "240.0.0.1",
      "255.255.255.255",
      PRIVATE_IPV4_ADDRESSES[0],
      MAPPED_PRIVATE_IPV4_HOST,
      "[::1]",
      "metadata.google.internal",
    ]) {
      const target = `http://${hostname}/identity`;
      let requests = 0;
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        assert.equal(new URL(request.url).origin, context.baseUrl);
        requests += 1;
        return new Response(null, {
          status: 302,
          headers: { location: target },
        });
      };
      await assert.rejects(requestPlexPmsIdentity(context, options), {
        code: "plex_unsafe_redirect",
      });
      assert.equal(requests, 1);
      await assert.rejects(
        assertAllowedMediaHandleRequestUrl({
          providerId: "plex",
          baseUrl: context.baseUrl,
          path: target,
        }),
        { code: "media_proxy_unsafe_url" },
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

useProviderFixtures();
