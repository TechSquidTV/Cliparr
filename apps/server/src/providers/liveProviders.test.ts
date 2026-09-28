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

void test("Plex coalesces changes, skips progress fetches, accepts keepalives and detects stalled streams", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const source: MediaSource = {
    id: "source",
    providerId: "plex",
    providerAccountId: "account",
    name: "Server",
    enabled: true,
    baseUrl: "https://plex.example",
    connection: { baseUrlMode: "manual" },
    credentials: { accessToken: "private" },
    metadata: { owned: true, provides: ["server"] },
    createdAt: "",
    updatedAt: "",
  };
  const pending = createDeferred<Response>();
  let discoveryRequests = 0;
  let snapshots = 0;
  let progress = 0;
  let events: ReadableStreamDefaultController<Uint8Array> | undefined;
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
            request.signal.addEventListener(
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
      progress() {
        progress++;
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
    context.mock.timers.tick(44_000);
    events?.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
    await setImmediate();
    context.mock.timers.tick(44_000);
    await setImmediate();
    assert.equal(discoveryRequests, 4, "keepalives do not query sessions");
    const rejected = assert.rejects(watching, /stopped responding/);
    context.mock.timers.tick(1000);
    await rejected;
  } finally {
    controller.abort();
    await watching.catch(() => {});
  }
});
