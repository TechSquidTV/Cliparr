import assert from "node:assert/strict";
import test from "node:test";
import { requestPlexPmsIdentity } from "@/providers/plex/pmsClient";
import { assertAllowedMediaHandleRequestUrl } from "@/providers/shared/mediaProxy";

void test("PMS redirects and media references share the unsafe-address policy", async () => {
  const context = { baseUrl: "http://192.168.1.50:32400", token: "test-token" };
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
      "10.0.0.1",
      "[::ffff:a00:1]",
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
