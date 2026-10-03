import {
  TEST_JELLYFIN_BASE_URL,
  TEST_PUBLIC_ADDRESS,
  mockProviderDns,
} from "@/test/providerFixtures";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import type { MediaSource } from "@/db/mediaSourcesRepository";
import { createDeferred } from "@/test/deferred";
import { acceptTestWebSocket } from "@/test/webSocket";

function createSource(baseUrl: string): MediaSource {
  return {
    id: "source",
    providerId: "jellyfin",
    providerAccountId: "account",
    name: "Server",
    enabled: true,
    baseUrl,
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
}

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
      const source = createSource(`http://127.0.0.1:${address.port}`);
      const pending = createDeferred<Response>();
      const requested = createDeferred<void>();
      let sessionRequestSignal: AbortSignal | undefined;
      context.mock.method(
        globalThis,
        "fetch",
        async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const request = new Request(input, init);
          const path = new URL(request.url).pathname;
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
          sessionRequestSignal = request.signal;
          requested.resolve();
          return Promise.race([
            pending.promise,
            new Promise<Response>((_resolve, reject) => {
              request.signal.addEventListener(
                "abort",
                () => reject(new Error("Request aborted")),
                { once: true },
              );
            }),
          ]);
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
          assert.equal(sessionRequestSignal?.aborted, true);
          assert.equal(await ended, undefined);
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

void test(
  "Jellyfin cancellation aborts both startup HTTP requests",
  { timeout: 5000 },
  async (context) => {
    context.after(mockProviderDns(context.mock));
    const { watchCurrentlyPlaying } = await import("@/providers/jellyfin/live");
    const controller = new AbortController();
    const pending = createDeferred<Response>();
    const requested = createDeferred<void>();
    const signals = new Map<string, AbortSignal>();
    context.after(() => {
      controller.abort();
      pending.resolve(Response.json({}));
    });
    context.mock.method(
      globalThis,
      "fetch",
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const request = new Request(input, init);
        signals.set(new URL(request.url).pathname, request.signal);
        if (signals.size === 2) {
          requested.resolve();
        }
        return Promise.race([
          pending.promise,
          new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener(
              "abort",
              () => reject(new Error("Request aborted")),
              { once: true },
            );
          }),
        ]);
      },
    );
    const ended = watchCurrentlyPlaying(
      createSource(TEST_JELLYFIN_BASE_URL),
      { snapshot() {}, progress() {}, invalidate() {} },
      controller.signal,
    ).then(
      () => {},
      (error: Error) => error,
    );
    try {
      await requested.promise;
      controller.abort();
      assert.deepEqual([...signals.keys()].toSorted(), [
        "/System/Info/Public",
        "/Users/Me",
      ]);
      for (const signal of signals.values()) {
        assert.equal(signal.aborted, true);
      }
      assert.equal(await ended, controller.signal.reason);
    } finally {
      controller.abort();
      pending.resolve(Response.json({}));
      await ended;
    }
  },
);

void test(
  "cancelling Jellyfin live startup interrupts WebSocket DNS validation",
  { timeout: 1000 },
  async (context) => {
    const { watchCurrentlyPlaying } = await import("@/providers/jellyfin/live");
    const entered = createDeferred<void>();
    const pending = createDeferred<LookupAddress[]>();
    const controller = new AbortController();
    const reason = new Error("Live connection cancelled");
    let resolutions = 0;
    context.mock.method(dns, "lookup", () => {
      resolutions++;
      // The two concurrent startup HTTP requests share their DNS lookup.
      if (resolutions === 1) {
        return Promise.resolve([{ address: TEST_PUBLIC_ADDRESS, family: 4 }]);
      }
      entered.resolve();
      return pending.promise;
    });
    syncBuiltinESMExports();
    let fetchCalls = 0;
    context.mock.method(
      globalThis,
      "fetch",
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        fetchCalls++;
        const path = new URL(new Request(input, init).url).pathname;
        return Response.json(
          path === "/Users/Me"
            ? { Id: "user", Policy: { IsAdministrator: false } }
            : { Version: "10.11.0" },
        );
      },
    );
    context.after(() => {
      controller.abort();
      pending.resolve([]);
      context.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const watching = watchCurrentlyPlaying(
      createSource("http://jellyfin.invalid:8096"),
      {
        snapshot() {
          assert.fail("No snapshot before connecting");
        },
        progress() {
          assert.fail("No progress before connecting");
        },
        invalidate() {
          assert.fail("No invalidation before connecting");
        },
      },
      controller.signal,
    );
    const rejected = assert.rejects(
      watching,
      (error: Error) => error === reason,
    );
    await entered.promise;
    controller.abort(reason);
    await rejected;
    pending.resolve([{ address: TEST_PUBLIC_ADDRESS, family: 4 }]);
    await setImmediate();
    assert.equal(fetchCalls, 2);
    assert.equal(resolutions, 2);
  },
);
