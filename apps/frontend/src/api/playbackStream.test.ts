import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { subscribePlaybackStream } from "@/api/playbackStream";
import {
  applyPlaybackProgress,
  type PlaybackStreamEvent,
  type ViewerPlaybackGroup,
} from "@cliparr/shared/providers";

function mockPlaybackStream(context: TestContext) {
  const requests: AbortSignal[] = [];
  let body: ReadableStreamDefaultController<Uint8Array> | undefined;
  context.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      const signal = init.signal;
      assert.ok(signal);
      requests.push(signal);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            body = controller;
            signal.addEventListener(
              "abort",
              () => controller.error(new Error("aborted")),
              { once: true },
            );
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  );
  return {
    requests,
    send(event: string, data: string) {
      assert.ok(body);
      body.enqueue(
        new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`),
      );
    },
    disconnect() {
      assert.ok(body);
      body.error(new Error("connection lost"));
    },
  };
}

void test("stream updates arrive without repeat fetches and cancellation stops reconnecting", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const stream = mockPlaybackStream(context);
  const events: PlaybackStreamEvent[] = [];
  const stop = subscribePlaybackStream({
    onConnection() {},
    onEvent: (event) => events.push(event),
    onUnauthorized() {
      assert.fail("unexpected auth failure");
    },
    onRedirect: () => false,
  });
  const snapshot: PlaybackStreamEvent = {
    type: "snapshot",
    snapshot: { viewers: [], sourceErrors: [], sources: [], loading: false },
  };
  try {
    await setImmediate();
    stream.send("playback", JSON.stringify(snapshot));
    await setImmediate();
    assert.deepEqual(events, [snapshot]);
    context.mock.timers.tick(30_000);
    await setImmediate();
    assert.equal(stream.requests.length, 1);
    stream.disconnect();
    await setImmediate();
    context.mock.timers.tick(1000);
    await setImmediate();
    assert.equal(stream.requests.length, 2);
  } finally {
    stop();
  }
  assert.equal(stream.requests.at(-1)?.aborted, true);
  await setImmediate();
  context.mock.timers.tick(120_000);
  await setImmediate();
  assert.equal(stream.requests.length, 2);
});

void test("heartbeats keep an idle stream open, while silence aborts and reconnects it", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const stream = mockPlaybackStream(context);
  const stop = subscribePlaybackStream({
    onConnection() {},
    onEvent() {
      assert.fail("heartbeat is not a playback event");
    },
    onUnauthorized() {
      assert.fail("unexpected auth failure");
    },
    onRedirect: () => false,
  });
  try {
    await setImmediate();
    for (let count = 0; count < 4; count++) {
      context.mock.timers.tick(30_000);
      stream.send("heartbeat", "{}");
      await setImmediate();
      assert.equal(stream.requests.length, 1);
      assert.equal(stream.requests[0].aborted, false);
    }
    context.mock.timers.tick(45_000);
    await setImmediate();
    assert.equal(stream.requests[0].aborted, true);
    context.mock.timers.tick(1000);
    await setImmediate();
    assert.equal(stream.requests.length, 2);
  } finally {
    stop();
  }
});

for (const mode of ["http", "stream"] as const) {
  void test(`expired authentication via ${mode} ends the stream without reconnect loops`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    let failures = 0;
    const stream = mockPlaybackStream(context);
    const fetchMock =
      mode === "http"
        ? context.mock.method(
            globalThis,
            "fetch",
            async () => new Response(null, { status: 401 }),
          )
        : undefined;
    const stop = subscribePlaybackStream({
      onConnection() {},
      onEvent() {
        assert.fail("expired authentication must not update playback");
      },
      onUnauthorized() {
        failures++;
      },
      onRedirect: () => false,
    });
    try {
      await setImmediate();
      if (mode === "stream") {
        stream.send("playback", JSON.stringify({ type: "unauthorized" }));
        await setImmediate();
        assert.equal(stream.requests[0].aborted, true);
      }
      context.mock.timers.tick(120_000);
      await setImmediate();
      assert.equal(failures, 1);
      assert.equal(
        fetchMock ? fetchMock.mock.callCount() : stream.requests.length,
        1,
      );
    } finally {
      stop();
    }
  });
}

void test("progress updates match provider sessions without replacing metadata or crossing sources", () => {
  const viewers: ViewerPlaybackGroup[] = [
    {
      viewer: { id: "viewer", name: "Viewer", providerId: "jellyfin" },
      items: [
        {
          id: "source:session:item:media",
          playbackSessionId: "session",
          source: { id: "source", name: "Server", providerId: "jellyfin" },
          title: "Movie",
          type: "movie",
          duration: 60,
          playerState: "playing",
          playerTitle: "Player",
          mediaUrl: "/api/media/private-handle",
        },
      ],
    },
  ];
  viewers[0].items.push({
    ...viewers[0].items[0],
    id: "other-session",
    playbackSessionId: "other-session",
  });
  const result = applyPlaybackProgress(viewers, [
    {
      sourceId: "other",
      sessionId: "session",
      playerState: "paused",
      playheadSeconds: 30,
    },
  ]);
  assert.equal(result[0].items[0], viewers[0].items[0]);
  const updated = applyPlaybackProgress(viewers, [
    {
      sourceId: "source",
      sessionId: "session",
      playerState: "paused",
      playheadSeconds: 30,
    },
  ]);
  assert.equal(updated[0].items[0].playheadSeconds, 30);
  assert.equal(updated[0].items[0].playerState, "paused");
  assert.equal(updated[0].items[1], viewers[0].items[1]);
  assert.equal(updated[0].items[0].mediaUrl, "/api/media/private-handle");
  assert.equal(viewers[0].items[0].playerState, "playing");
});

void test("browser offline events suspend retries and online events resubscribe immediately", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const browserWindow = Object.assign(new EventTarget(), {
    navigator: { onLine: true },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browserWindow,
  });
  const stream = mockPlaybackStream(context);
  const states: string[] = [];
  const stop = subscribePlaybackStream({
    onEvent() {},
    onConnection: (state) => states.push(state),
    onUnauthorized() {},
    onRedirect: () => false,
  });
  try {
    await setImmediate();
    browserWindow.navigator.onLine = false;
    browserWindow.dispatchEvent(new Event("offline"));
    await setImmediate();
    assert.equal(states.at(-1), "reconnecting");
    context.mock.timers.tick(120_000);
    await setImmediate();
    assert.equal(stream.requests.length, 1);
    browserWindow.navigator.onLine = true;
    browserWindow.dispatchEvent(new Event("online"));
    await setImmediate();
    assert.equal(stream.requests.length, 2);
  } finally {
    stop();
    if (previous) {
      Object.defineProperty(globalThis, "window", previous);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});
