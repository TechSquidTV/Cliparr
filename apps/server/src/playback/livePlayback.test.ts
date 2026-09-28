import { createDeferred } from "@/test/deferred";
import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import type {
  PlaybackSnapshot,
  PlaybackStreamEvent,
} from "@cliparr/shared/providers";
import { createLivePlaybackHub } from "@/playback/livePlayback";
import { notifyPlaybackStateChange } from "@/playback/stateChanges";
import { plexProvider } from "@/providers/plex/provider";
import type {
  CurrentlyPlayingEntry,
  PlaybackObserver,
} from "@/providers/types";
import type { MediaSource } from "@/db/mediaSourcesRepository";
import type { ProviderSessionRecord } from "@/session/store";
import { createApiError } from "@/http/errors";

const source: MediaSource = {
  id: "source",
  providerId: "plex",
  providerAccountId: "account",
  name: "Server",
  enabled: true,
  baseUrl: "https://example.test",
  connection: {},
  credentials: { accessToken: "secret" },
  metadata: {},
  createdAt: "",
  updatedAt: "",
};

function session(id: string): ProviderSessionRecord {
  return {
    id,
    providerId: "plex",
    providerAccountId: "account",
    userToken: "private-token",
    mediaHandles: new Map(),
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

function entry(id: string, owner: string): CurrentlyPlayingEntry {
  return {
    viewer: { id: "viewer", providerId: "plex", name: "Viewer" },
    item: {
      id,
      playbackSessionId: id,
      source: { id: source.id, name: source.name, providerId: "plex" },
      title: id,
      type: "movie",
      duration: 60,
      playerState: "playing",
      playerTitle: "Player",
      mediaUrl: `/api/media/${owner}/${id}`,
    },
  };
}

function latest(events: PlaybackStreamEvent[]): PlaybackSnapshot {
  const event = events.findLast((event) => event.type === "snapshot");
  assert.equal(event?.type, "snapshot");
  return event.snapshot;
}

function setup() {
  let sources = [source];
  const connections: Array<{
    observer: PlaybackObserver;
    signal: AbortSignal;
  }> = [];
  const provider = {
    ...plexProvider,
    supportsCurrentlyPlayingSource: () => true,
    watchCurrentlyPlaying: (
      _source: MediaSource,
      observer: PlaybackObserver,
      signal: AbortSignal,
    ) => {
      connections.push({ observer, signal });
      return new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  };
  const hub = createLivePlaybackHub({
    listSources: () => sources,
    provider: () => provider,
  });
  return {
    hub,
    connections,
    provider,
    replaceSources: (next: MediaSource[]) => {
      sources = next;
      notifyPlaybackStateChange({ type: "sources" });
    },
  };
}

void test("shares upstream subscriptions and same-session normalization without sharing media handles across sessions", async () => {
  const { hub, connections } = setup();
  const first: PlaybackStreamEvent[] = [];
  const second: PlaybackStreamEvent[] = [];
  const third: PlaybackStreamEvent[] = [];
  const stopFirst = hub.subscribe(session("one"), (event) => first.push(event));
  const stopSecond = hub.subscribe(session("one"), (event) =>
    second.push(event),
  );
  const stopThird = hub.subscribe(session("two"), (event) => third.push(event));
  try {
    assert.equal(connections.length, 1);
    assert.equal(latest(first).loading, true);
    const calls: string[] = [];
    connections[0].observer.snapshot(async (owner) => {
      calls.push(owner.id);
      return [entry("movie", owner.id)];
    });
    await setImmediate();
    assert.deepEqual(calls, ["one", "two"]);
    assert.equal(
      latest(first).viewers[0].items[0].mediaUrl,
      "/api/media/one/movie",
    );
    assert.equal(
      latest(third).viewers[0].items[0].mediaUrl,
      "/api/media/two/movie",
    );
    assert.equal(JSON.stringify(first).includes("secret"), false);
    connections[0].observer.progress([
      {
        sourceId: source.id,
        sessionId: "movie",
        playerState: "paused",
        playheadSeconds: 12,
      },
    ]);
    assert.equal(first.at(-1)?.type, "progress");
    assert.equal(calls.length, 2);
    stopFirst();
    stopSecond();
    assert.equal(connections[0].signal.aborted, false);
  } finally {
    stopFirst();
    stopSecond();
    stopThird();
  }
  assert.equal(connections[0].signal.aborted, true);
});

void test("new snapshots and progress win over in-flight discovery; removed sources cannot reappear", async () => {
  const { hub, connections, replaceSources } = setup();
  const events: PlaybackStreamEvent[] = [];
  const stop = hub.subscribe(session("one"), (event) => events.push(event));
  try {
    const pending = createDeferred<CurrentlyPlayingEntry[]>();
    connections[0].observer.snapshot(() => pending.promise);
    connections[0].observer.snapshot(async () => [entry("new", "one")]);
    connections[0].observer.progress([
      {
        sourceId: source.id,
        sessionId: "new",
        playerState: "paused",
        playheadSeconds: 22,
      },
    ]);
    pending.resolve([entry("old", "one")]);
    await setImmediate();
    assert.equal(latest(events).viewers[0].items[0].id, "new");
    assert.equal(latest(events).viewers[0].items[0].playheadSeconds, 22);
    const obsolete = createDeferred<CurrentlyPlayingEntry[]>();
    connections[0].observer.snapshot(() => obsolete.promise);
    replaceSources([]);
    await setImmediate();
    obsolete.resolve([entry("obsolete", "one")]);
    await setImmediate();
    assert.deepEqual(latest(events).viewers, []);
    assert.equal(connections[0].signal.aborted, true);
  } finally {
    stop();
  }
});

void test("source credential changes restart the stream and revoked sessions close their subscribers", async () => {
  const { hub, connections, replaceSources } = setup();
  const events: PlaybackStreamEvent[] = [];
  const stop = hub.subscribe(session("one"), (event) => events.push(event));
  try {
    replaceSources([
      { ...source, credentials: { accessToken: "replacement" } },
    ]);
    await setImmediate();
    assert.equal(connections.length, 2);
    assert.equal(connections[0].signal.aborted, true);
    notifyPlaybackStateChange({ type: "session", sessionId: "one" });
    await setImmediate();
    assert.equal(events.at(-1)?.type, "unauthorized");
    assert.equal(connections[1].signal.aborted, true);
    hub.retry();
    assert.equal(connections.length, 2);
  } finally {
    stop();
  }
});

void test("permission invalidation clears existing data and prevents older work restoring it", async () => {
  const { hub, connections } = setup();
  const events: PlaybackStreamEvent[] = [];
  const stop = hub.subscribe(session("one"), (event) => events.push(event));
  try {
    connections[0].observer.snapshot(async () => [entry("existing", "one")]);
    await setImmediate();
    assert.equal(latest(events).viewers[0].items[0].id, "existing");
    const pending = createDeferred<CurrentlyPlayingEntry[]>();
    connections[0].observer.snapshot(() => pending.promise);
    connections[0].observer.invalidate();
    assert.deepEqual(latest(events).viewers, []);
    pending.resolve([entry("private", "one")]);
    await setImmediate();
    assert.deepEqual(latest(events).viewers, []);
  } finally {
    stop();
  }
});

void test("unsupported live sessions have an explicit error and no automatic polling fallback", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { hub, provider } = setup();
  let attempts = 0;
  provider.watchCurrentlyPlaying = async () => {
    attempts++;
    throw createApiError(422, "live_sessions_unsupported", "Upgrade Jellyfin");
  };
  const events: PlaybackStreamEvent[] = [];
  const stop = hub.subscribe(session("one"), (event) => events.push(event));
  try {
    await setImmediate();
    assert.equal(latest(events).sources[0].state, "unsupported");
    assert.equal(latest(events).loading, false);
    context.mock.timers.tick(45_000);
    await setImmediate();
    assert.equal(attempts, 1);
  } finally {
    stop();
  }
});

void test("failed preparation retries automatically without restarting healthy upstream subscriptions", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { hub, connections } = setup();
  const events: PlaybackStreamEvent[] = [];
  const stop = hub.subscribe(session("retry-owner"), (event) =>
    events.push(event),
  );
  let attempts = 0;
  try {
    connections[0].observer.snapshot(async () => {
      if (++attempts === 1) {
        throw new Error("Temporary metadata failure");
      }
      return [entry("recovered", "retry-owner")];
    });
    await setImmediate();
    assert.equal(latest(events).sources[0].state, "error");
    context.mock.timers.tick(1000);
    await setImmediate();
    assert.equal(latest(events).sources[0].state, "live");
    assert.equal(latest(events).viewers[0].items[0].id, "recovered");
    assert.equal(attempts, 2);
    hub.retry();
    assert.equal(connections.length, 1);
  } finally {
    stop();
  }
});

void test("manual retry restarts only failed sources and preparation retries stop after unsubscribe", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { hub, connections, provider, replaceSources } = setup();
  const originalWatch = provider.watchCurrentlyPlaying;
  let failedSourceAttempts = 0;
  provider.watchCurrentlyPlaying = (source, observer, signal) => {
    if (source.id === "failed") {
      if (++failedSourceAttempts === 1) {
        return Promise.reject(
          createApiError(422, "live_sessions_unsupported", "Upgrade"),
        );
      }
      observer.snapshot(async () => []);
    }
    return originalWatch(source, observer, signal);
  };
  replaceSources([source, { ...source, id: "failed" }]);
  const events: PlaybackStreamEvent[] = [];
  const stop = hub.subscribe(session("retry-owner"), (event) =>
    events.push(event),
  );
  context.after(stop);
  let attempts = 0;
  connections[0].observer.snapshot(async () => {
    attempts++;
    throw new Error("Temporary metadata failure");
  });
  await setImmediate();
  hub.retry();
  await setImmediate();
  assert.equal(failedSourceAttempts, 2);
  assert.equal(
    latest(events).sources.find((source) => source.sourceId === "failed")
      ?.state,
    "live",
  );
  assert.equal(connections.length, 2);
  assert.equal(connections[0].signal.aborted, false);
  assert.equal(attempts, 2);
  stop();
  context.mock.timers.tick(30_000);
  await setImmediate();
  assert.equal(attempts, 2);
  assert.equal(
    connections.every((connection) => connection.signal.aborted),
    true,
  );
});
