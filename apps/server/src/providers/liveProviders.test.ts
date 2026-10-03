import {
  TEST_PLEX_BASE_URL,
  useProviderFixtures,
} from "@/test/providerFixtures";
import { jellyfinPlaybackIdentity } from "@/providers/jellyfin/playback";
import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createDeferred } from "@/test/deferred";
import type { MediaSource } from "@/db/mediaSourcesRepository";
import { jellyfinSupportsLiveSessions } from "@/providers/jellyfin/live";
import {
  readPlexPlayingNotifications,
  watchCurrentlyPlaying,
} from "@/providers/plex/live";
import { readServerEvents } from "@cliparr/shared/server-events";

const source: MediaSource = {
  id: "source",
  providerId: "plex",
  providerAccountId: "account",
  name: "Server",
  enabled: true,
  baseUrl: TEST_PLEX_BASE_URL,
  connection: { baseUrlMode: "manual" },
  credentials: { accessToken: "private" },
  metadata: { owned: true, provides: ["server"] },
  createdAt: "",
  updatedAt: "",
};

void test("Jellyfin live support respects non-admin version restrictions", () => {
  assert.equal(jellyfinSupportsLiveSessions("10.10.7", false), false);
  assert.equal(jellyfinSupportsLiveSessions("10.10.7", true), true);
  assert.equal(jellyfinSupportsLiveSessions("10.11.0", false), true);
  assert.equal(jellyfinSupportsLiveSessions("12.1.0", false), true);
  assert.equal(jellyfinSupportsLiveSessions("", false), false);
});

void test("Jellyfin position and pause changes do not require metadata enrichment, but track and item changes do", () => {
  const session = {
    Id: "session",
    UserId: "user",
    NowPlayingItem: { Id: "item" },
    PlayState: { PositionTicks: 0, IsPaused: false, AudioStreamIndex: 1 },
  };
  const identity = jellyfinPlaybackIdentity([session]);
  assert.equal(
    jellyfinPlaybackIdentity([
      {
        ...session,
        PlayState: {
          ...session.PlayState,
          IsPaused: true,
          PositionTicks: 1000,
        },
      },
    ]),
    identity,
  );
  assert.notEqual(
    jellyfinPlaybackIdentity([
      { ...session, PlayState: { ...session.PlayState, AudioStreamIndex: 2 } },
    ]),
    identity,
  );
  assert.notEqual(
    jellyfinPlaybackIdentity([{ ...session, NowPlayingItem: { Id: "next" } }]),
    identity,
  );
  assert.notEqual(jellyfinPlaybackIdentity([]), identity);
});

void test("Plex parses SSE notification objects and containers without treating unrelated events as playback", () => {
  const playing = { sessionKey: "4", state: "paused", viewOffset: 1000 };
  assert.deepEqual(
    readPlexPlayingNotifications(
      JSON.stringify({ PlaySessionStateNotification: playing }),
    ),
    [playing],
  );
  assert.deepEqual(
    readPlexPlayingNotifications(
      JSON.stringify({
        NotificationContainer: { PlaySessionStateNotification: [playing] },
      }),
    ),
    [playing],
  );
  assert.deepEqual(
    readPlexPlayingNotifications('{"ActivityNotification":{}}'),
    [],
  );
});

void test("SSE decoder preserves split UTF-8, multiline JSON, CRLF and ignores heartbeats", async () => {
  const bytes = new TextEncoder().encode(
    ': heartbeat\r\nevent: playback\r\ndata: {"title":"🎬",\r\ndata: "value":1}\r\n\r\n',
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) {
        controller.enqueue(Uint8Array.of(byte));
      }
      controller.close();
    },
  });
  const events: Array<[string, string]> = [];
  await readServerEvents(stream, (name, data) => events.push([name, data]));
  assert.deepEqual(events, [["playback", '{"title":"🎬",\n"value":1}']]);
});

void test(
  "Plex coalesces changes, skips progress fetches, accepts keepalives and detects stalled streams",
  { timeout: 5000 },
  async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });

    const pending = createDeferred<Response>();
    let discoveryRequests = 0;
    let snapshots = 0;
    let progress = 0;
    let lastProgressSize = 0;
    let events: ReadableStreamDefaultController<Uint8Array> | undefined;
    let eventStreamSignal: AbortSignal | undefined;
    const controller = new AbortController();
    context.mock.method(
      globalThis,
      "fetch",
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const request = new Request(input, init);
        assert.equal(request.headers.get("X-Plex-Token"), "private");
        if (new URL(request.url).pathname === "/status/sessions") {
          discoveryRequests++;
          if (discoveryRequests === 2) {
            return pending.promise;
          }
          return Response.json({ MediaContainer: { Metadata: [] } });
        }
        assert.equal(
          new URL(request.url).pathname,
          "/:/eventsource/notifications",
        );
        return new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              events = stream;
              eventStreamSignal = init?.signal ?? request.signal;
              eventStreamSignal.addEventListener(
                "abort",
                () => stream.error(new Error("aborted")),
                { once: true },
              );
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    );
    const watching = watchCurrentlyPlaying(
      source,
      {
        snapshot() {
          snapshots++;
        },
        progress(updates) {
          progress++;
          lastProgressSize = updates.length;
        },
        invalidate() {},
      },
      controller.signal,
    ).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        throw error;
      }
    });
    const send = (state: string, viewOffset: number) =>
      events?.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ PlaySessionStateNotification: { sessionKey: "session", ratingKey: "movie", state, viewOffset } })}\n\n`,
        ),
      );
    try {
      await setImmediate();
      assert.ok(events);
      assert.equal(discoveryRequests, 2);
      send("playing", 0);
      await setImmediate();
      pending.resolve(Response.json({ MediaContainer: { Metadata: [] } }));
      await setImmediate();
      assert.equal(discoveryRequests, 3);
      assert.equal(snapshots, 1);
      for (let position = 1; position <= 5; position++) {
        send("playing", position * 1000);
      }
      await setImmediate();
      assert.equal(discoveryRequests, 3);
      assert.equal(progress, 6);
      send("stopped", 6000);
      await setImmediate();
      assert.equal(discoveryRequests, 4);
      assert.equal(snapshots, 2);
      const beforeBatch = progress;
      events.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({
            NotificationContainer: {
              PlaySessionStateNotification: Array.from(
                { length: 20 },
                (_, index) => ({
                  sessionKey: `batch-${index}`,
                  ratingKey: "movie",
                  state: "playing",
                  viewOffset: 1000,
                }),
              ),
            },
          })}\n\n`,
        ),
      );
      await setImmediate();
      assert.equal(discoveryRequests, 5, "one batch triggers one refresh");
      assert.equal(
        progress,
        beforeBatch + 1,
        "one batch emits one progress event",
      );
      assert.equal(lastProgressSize, 20);
      context.mock.timers.tick(44_000);
      events?.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
      await setImmediate();
      context.mock.timers.tick(44_000);
      await setImmediate();
      assert.equal(discoveryRequests, 5, "keepalives do not query sessions");
      assert.ok(eventStreamSignal);
      assert.equal(eventStreamSignal.aborted, false);
      const rejected = assert.rejects(watching, /stopped responding/);
      context.mock.timers.tick(1000);
      assert.equal(eventStreamSignal.aborted, true);
      await rejected;
    } finally {
      controller.abort();
      pending.resolve(Response.json({ MediaContainer: { Metadata: [] } }));
      await watching.catch(() => {});
    }
  },
);

for (const phase of ["initial discovery", "snapshot refresh"] as const) {
  void test(
    `Plex cancellation aborts HTTP during ${phase}`,
    { timeout: 5000 },
    async (context) => {
      const controller = new AbortController();
      const pending = createDeferred<Response>();
      const requested = createDeferred<AbortSignal>();
      context.after(() => {
        controller.abort();
        pending.resolve(Response.json({ MediaContainer: { Metadata: [] } }));
      });
      let requests = 0;
      context.mock.method(
        globalThis,
        "fetch",
        async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const request = new Request(input, init);
          if (new URL(request.url).pathname === "/status/sessions") {
            requests++;
            if (requests === (phase === "initial discovery" ? 1 : 2)) {
              requested.resolve(request.signal);
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
            }
            return Response.json({ MediaContainer: { Metadata: [] } });
          }
          return new Response(
            new ReadableStream<Uint8Array>({
              start(stream) {
                request.signal.addEventListener(
                  "abort",
                  () => stream.error(new Error("Stream aborted")),
                  { once: true },
                );
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        },
      );
      const ended = watchCurrentlyPlaying(
        {
          ...source,
          connection: {
            baseUrlMode: "auto",
            selectedConnectionId: "primary",
            connections: [
              { id: "primary", uri: source.baseUrl },
              { id: "secondary", uri: "https://fallback.example" },
            ],
          },
        },
        { snapshot() {}, progress() {}, invalidate() {} },
        controller.signal,
      ).then(
        () => {},
        (error: Error) => error,
      );
      try {
        const signal = await requested.promise;
        controller.abort();
        assert.equal(signal.aborted, true);
        await ended;
        assert.equal(
          requests,
          phase === "initial discovery" ? 1 : 2,
          "cancellation must not try another connection",
        );
      } finally {
        controller.abort();
        pending.resolve(Response.json({ MediaContainer: { Metadata: [] } }));
        await ended;
      }
    },
  );
}

useProviderFixtures();
