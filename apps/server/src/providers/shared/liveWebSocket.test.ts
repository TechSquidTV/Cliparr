import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { createDeferred } from "@/test/deferred";
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
        const key = request.headers["sec-websocket-key"];
        assert.equal(typeof key, "string");
        const accept = createHash("sha1")
          .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest("base64");
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        const payload = Buffer.from('{"ready":true}');
        if (!silent) {
          socket.write(
            Buffer.concat([Buffer.from([0x81, payload.length]), payload]),
          );
        }
        socket.on("error", () => {});
        // Deliberately ignore the close frame to exercise forced termination.
        socket.on("data", () => {});
        socket.on("close", () => {
          peerClosed.resolve();
        });
        socket.on("end", () => socket.destroy());
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
