import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Buffer } from "node:buffer";
import { constants, deflateRawSync } from "node:zlib";
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

for (const scenario of [
  "announced payload",
  "fragmented payload",
  "fragment count",
  "compressed payload",
] as const) {
  void test(
    `live WebSocket rejects excessive ${scenario} at the transport`,
    { timeout: 5000 },
    async (context) => {
      const server = createServer();
      const controller = new AbortController();
      let delivered = false;
      server.on("upgrade", (request, socket) => {
        const send = acceptTestWebSocket(request, socket, {
          compression: scenario === "compressed payload",
        });
        if (scenario === "announced payload") {
          // No body: reject the declared size without waiting to buffer it.
          const header = Buffer.alloc(10);
          header[0] = 0x81;
          header[1] = 127;
          header.writeBigUInt64BE(BigInt(4 * 1024 * 1024 + 1), 2);
          socket.write(header);
        } else if (scenario === "compressed payload") {
          const payload = deflateRawSync(
            Buffer.alloc(4 * 1024 * 1024 + 1, 0x61),
            {
              finishFlush: constants.Z_SYNC_FLUSH,
            },
          ).subarray(0, -4);
          send(payload, 0x81 | 0x40); // Final text frame with compression (RSV1).
        } else {
          const payload = Buffer.alloc(
            scenario === "fragment count" ? 1 : 65_535,
            0x61,
          );
          const count = scenario === "fragment count" ? 1025 : 65;
          for (let index = 0; index < count; index++) {
            // Never send FIN, so application-level message checks cannot run.
            send(payload, index === 0 ? 0x01 : 0x00);
          }
        }
      });
      server.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => {
        server.once("listening", resolve);
      });
      const address = server.address();
      assert.ok(address && typeof address === "object");
      try {
        await assert.rejects(
          readLiveWebSocket({
            url: new URL(`ws://127.0.0.1:${address.port}`),
            addresses: [],
            headers: new Headers(),
            signal: AbortSignal.any([controller.signal, context.signal]),
            onOpen() {},
            onMessage() {
              delivered = true;
            },
          }),
          /Live connection (failed|closed)/,
        );
        assert.equal(delivered, false);
      } finally {
        controller.abort();
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    },
  );
}
