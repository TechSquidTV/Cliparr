import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import type { MediaSource } from "@/db/mediaSourcesRepository";
import { createDeferred } from "@/test/deferred";
import { acceptTestWebSocket } from "@/test/webSocket";

for (const scenario of [
  "pushed snapshot",
  "no snapshot",
  "cancelled",
] as const) {
  void test(
    `Jellyfin initial HTTP failure respects ${scenario}`,
    { timeout: 5000 },
    async (context) => {
      const previous = process.env.CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS;
      process.env.CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS = "true";
      const { watchCurrentlyPlaying } =
        await import("@/providers/jellyfin/live");
      if (previous === undefined) {
        delete process.env.CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS;
      } else {
        process.env.CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS = previous;
      }
      const server = createServer();
      const connected = createDeferred<(text: string) => void>();
      let peer: Duplex | undefined;
      server.on("upgrade", (request, socket) => {
        peer = socket;
        connected.resolve(acceptTestWebSocket(request, socket));
      });
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const source: MediaSource = {
        id: "source",
        providerId: "jellyfin",
        providerAccountId: "account",
        name: "Server",
        enabled: true,
        baseUrl: `http://127.0.0.1:${address.port}`,
        credentials: {
          accessToken: "test-token",
          userId: "user",
          deviceId: "device",
        },
        connection: {},
        metadata: {},
        createdAt: "",
        updatedAt: "",
      };
      const pending = createDeferred<Response>();
      const requested = createDeferred<void>();
      context.mock.method(
        globalThis,
        "fetch",
        async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const path = new URL(new Request(input, init).url).pathname;
          if (path === "/Users/Me") {
            return Response.json({
              Id: "user",
              Policy: { IsAdministrator: false },
            });
          }
          if (path === "/System/Info/Public") {
            return Response.json({ Version: "10.11.0" });
          }
          assert.equal(path, "/Sessions");
          requested.resolve();
          return pending.promise;
        },
      );
      const initial = createDeferred<void>();
      const next = createDeferred<void>();
      const controller = new AbortController();
      let snapshots = 0;
      const watching = watchCurrentlyPlaying(
        source,
        {
          snapshot() {
            snapshots++;
            initial.resolve();
          },
          progress(updates) {
            if (updates.some((update) => update.sessionId === "next")) {
              next.resolve();
            }
          },
          invalidate() {
            assert.fail("HTTP failure must not invalidate a pushed snapshot");
          },
        },
        controller.signal,
      );
      // Attach immediately so expected startup failures cannot become unhandled rejections.
      const ended = watching.then(
        () => {},
        (error: Error) => error,
      );
      try {
        const send = await connected.promise;
        await requested.promise;
        if (scenario === "pushed snapshot") {
          send(JSON.stringify({ MessageType: "Sessions", Data: [] }));
          await initial.promise;
        } else if (scenario === "cancelled") {
          controller.abort();
        }
        pending.resolve(new Response("Temporary failure", { status: 503 }));
        await setImmediate();
        if (scenario === "pushed snapshot") {
          send(
            JSON.stringify({
              MessageType: "Sessions",
              Data: [
                { Id: "next", UserId: "user", NowPlayingItem: { Id: "movie" } },
              ],
            }),
          );
          await Promise.race([
            next.promise,
            ended.then((error) => {
              throw (
                error ?? new Error("Live watcher ended before the next push")
              );
            }),
          ]);
          assert.equal(snapshots, 2);
          controller.abort();
          assert.equal(await ended, undefined);
        } else if (scenario === "no snapshot") {
          const error = await ended;
          assert.ok(error);
          assert.match(
            error.message,
            /Could not load the initial Jellyfin sessions/,
          );
          assert.equal(snapshots, 0);
        } else {
          assert.equal(await ended, undefined);
          assert.equal(snapshots, 0);
        }
      } finally {
        controller.abort();
        pending.resolve(new Response(null, { status: 503 }));
        peer?.destroy();
        await ended;
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    },
  );
}
