import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createDeferred } from "@/test/deferred";
import { acceptTestWebSocket } from "@/test/webSocket";
import { readLiveWebSocket } from "@/providers/shared/liveWebSocket";

for (const scenario of [
  { hostname: "127.0.0.1", silent: false },
  { hostname: "validated.example", silent: false },
  { hostname: "127.0.0.1", silent: true },
]) {
  const { hostname, silent } = scenario;
  void test(
    `live WebSocket pins ${hostname} and terminates ${silent ? "stalled" : "cancelled"} connections`,
    { timeout: 5000 },
    async () => {
      const server = createServer();
      const controller = new AbortController();
      let received = "";
      const peerClosed = createDeferred<void>();
      server.on("upgrade", (request, socket) => {
        assert.equal(request.url, "/jellyfin/socket");
        assert.equal(
          request.headers.authorization,
          'MediaBrowser Token="private"',
        );
        const send = acceptTestWebSocket(request, socket);
        if (!silent) {
          send('{"ready":true}');
        }
        socket.on("close", () => {
          peerClosed.resolve();
        });
      });
      server.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => {
        server.once("listening", resolve);
      });
      const address = server.address();
      assert.ok(address && typeof address === "object");
      try {
        const watching = readLiveWebSocket({
          url: new URL(`ws://${hostname}:${address.port}/jellyfin/socket`),
          addresses: hostname === "127.0.0.1" ? [] : ["127.0.0.1"],
          headers: new Headers({
            Authorization: 'MediaBrowser Token="private"',
          }),
          signal: controller.signal,
          receiveTimeoutMs: 40,
          onOpen() {},
          onMessage(text) {
            received = text;
            controller.abort();
          },
        });
        if (silent) {
          await assert.rejects(watching, /stopped responding/);
        } else {
          await watching;
          assert.equal(received, '{"ready":true}');
        }
        await peerClosed.promise;
      } finally {
        controller.abort();
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    },
  );
}
