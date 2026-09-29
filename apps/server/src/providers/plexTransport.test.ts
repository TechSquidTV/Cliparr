import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { eventsourceGetSlash } from "@cliparr/plex/pms";
import { createPlexPmsSdkClient } from "@/providers/plex/pmsClient";

void test(
  "generated PMS streaming remains unbuffered and cancels after headers and GC",
  { timeout: 10_000 },
  async () => {
    let disconnected = false;
    const server = createServer((request, response) => {
      assert.equal(request.url, "/:/eventsource/notifications");
      assert.equal(request.headers["x-plex-token"], "server-token");
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(": heartbeat\n\n");
      response.on("close", () => {
        disconnected = true;
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const controller = new AbortController();
    try {
      // Return only the body so the generated Request and result can be collected.
      const body = await (async () => {
        const result = await eventsourceGetSlash({
          client: createPlexPmsSdkClient(
            {
              baseUrl: `http://127.0.0.1:${address.port}`,
              token: "server-token",
            },
            {
              clientIdentifier: "contract-test",
              product: "Cliparr",
              timeoutMs: 1,
            },
            controller.signal,
          ),
          parseAs: "stream",
          headers: { Accept: "text/event-stream" },
        });
        assert.equal(result.response?.status, 200);
        return result.response?.body;
      })();
      assert.ok(body);
      const reader = body.getReader();
      const firstChunk = await reader.read();
      assert.match(new TextDecoder().decode(firstChunk.value), /heartbeat/);
      assert.ok(globalThis.gc, "Run with --expose-gc");
      for (let index = 0; index < 8; index += 1) {
        globalThis.gc();
        await setImmediate();
      }
      assert.equal(disconnected, false);
      controller.abort();
      await assert.rejects(reader.read(), { name: "AbortError" });
      for (let index = 0; index < 100; index += 1) {
        if (disconnected) {
          break;
        }
        await setImmediate();
      }
      assert.equal(disconnected, true);
    } finally {
      controller.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  },
);

void test("generated PMS request preserves cancellation before headers", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await eventsourceGetSlash({
    client: createPlexPmsSdkClient(
      { baseUrl: "http://127.0.0.1:1", token: "server-token" },
      {
        clientIdentifier: "contract-test",
        product: "Cliparr",
        timeoutMs: 5000,
      },
      controller.signal,
    ),
    parseAs: "stream",
  });
  assert.equal(result.response, undefined);
  assert.ok(result.error instanceof Error);
  assert.equal(result.error.name, "AbortError");
});
