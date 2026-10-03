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
  const initialCount = first.length;
  const stopSecond = hub.subscribe(session("one"), (event) =>
    second.push(event),
  );
  const stopThird = hub.subscribe(session("two"), (event) => third.push(event));
  try {
    assert.equal(first.length, initialCount);
    assert.equal(second.length, 1);
    assert.equal(third.length, 1);
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

void test("isolates live snapshots, progress, preparation and retry by provider account", async () => {
  const { hub, connections, replaceSources } = setup();
  const foreignSource = {
    ...source,
    id: "foreign",
    providerAccountId: "other-account",
  };
  replaceSources([source, foreignSource]);
  const first: PlaybackStreamEvent[] = [];
  const second: PlaybackStreamEvent[] = [];
  const stopFirst = hub.subscribe(session("one"), (event) => first.push(event));
  const stopSecond = hub.subscribe(
    { ...session("two"), providerAccountId: "other-account" },
    (event) => second.push(event),
  );
  try {
    assert.equal(connections.length, 2);
    const owners: string[] = [];
    connections[0].observer.snapshot(async (owner) => {
      owners.push(owner.providerAccountId);
      return [entry("own-movie", owner.id)];
    });
    connections[1].observer.snapshot(async (owner) => {
      owners.push(owner.providerAccountId);
      const foreignEntry = entry("foreign-movie", owner.id);
      foreignEntry.item.source.id = foreignSource.id;
      return [foreignEntry];
    });
    await setImmediate();
    assert.deepEqual(owners, ["account", "other-account"]);
    assert.deepEqual(
      latest(first).sources.map((status) => status.sourceId),
      [source.id],
    );
    assert.deepEqual(
      latest(second).sources.map((status) => status.sourceId),
      [foreignSource.id],
    );
    assert.equal(latest(first).viewers[0].items[0].id, "own-movie");
    assert.equal(latest(second).viewers[0].items[0].id, "foreign-movie");
    const secondCount = second.length;
    connections[0].observer.progress([
      {
        sourceId: source.id,
        sessionId: "own-movie",
        playerState: "paused",
        playheadSeconds: 1,
      },
    ]);
    assert.equal(second.length, secondCount);
    assert.equal(first.at(-1)?.type, "progress");
    stopFirst();
    assert.equal(connections[0].signal.aborted, true);
    assert.equal(connections[1].signal.aborted, false);
    assert.deepEqual(
      latest(second).sources.map((status) => status.sourceId),
      [foreignSource.id],
    );
    // Invalidating one account must not expose its errors to another dashboard.
    let foreignAttempts = 0;
    connections[1].observer.snapshot(async () => {
      foreignAttempts++;
      throw new Error("Foreign error");
    });
    await setImmediate();
    const resumed: PlaybackStreamEvent[] = [];
    const stopResumed = hub.subscribe(session("three"), (event) =>
      resumed.push(event),
    );
    try {
      assert.deepEqual(latest(resumed).sourceErrors, []);
      assert.deepEqual(latest(resumed).viewers, []);
      hub.retry("account");
      await setImmediate();
      assert.equal(foreignAttempts, 1);
      assert.equal(connections[1].signal.aborted, false);
    } finally {
      stopResumed();
    }
  } finally {
    stopFirst();
    stopSecond();
  }
});

void test("subscription admission bounds fanout and releases slots on disconnect and revocation", async (context) => {
  let sourceReads = 0;
  const hub = createLivePlaybackHub({
    listSources: () => {
      sourceReads++;
      return [];
    },
    provider: () => {},
  });
  let snapshots = 0;
  let revocations = 0;
  const listener = (event: PlaybackStreamEvent) => {
    if (event.type === "snapshot") {
      snapshots++;
    } else if (event.type === "unauthorized") {
      revocations++;
    }
  };
  const stops: Array<() => void> = [];
  context.after(() => {
    for (const stop of stops) {
      stop();
    }
  });
  const limitError = { status: 429, code: "live_connection_limit" };
  for (let index = 0; index < 128; index++) {
    stops.push(hub.subscribe(session(String(Math.floor(index / 8))), listener));
    if (index === 7) {
      assert.throws(() => hub.subscribe(session("0"), listener), limitError);
    }
  }
  assert.equal(snapshots, 128);
  assert.equal(sourceReads, 1);
  assert.throws(() => hub.subscribe(session("overflow"), listener), limitError);
  assert.equal(snapshots, 128);
  stops[0]();
  stops[0]();
  stops.push(hub.subscribe(session("replacement"), listener));
  assert.throws(() => hub.subscribe(session("overflow"), listener), limitError);
  notifyPlaybackStateChange({ type: "session", sessionId: "1" });
  await setImmediate();
  assert.equal(revocations, 8);
  // Revocation alone must free these slots, before any client closes its stream.
  for (let index = 0; index < 8; index++) {
    stops.push(hub.subscribe(session("after-revocation"), listener));
  }
  assert.throws(() => hub.subscribe(session("overflow"), listener), limitError);
  for (let index = 8; index < 16; index++) {
    stops[index]();
  }
  assert.throws(() => hub.subscribe(session("overflow"), listener), limitError);
});

void test("expired dashboards release admission slots and unchanged sources do not rebroadcast", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { hub, replaceSources } = setup();
  const events: PlaybackStreamEvent[] = [];
  const stops: Array<() => void> = [];
  context.after(() => {
    for (const stop of stops) {
      stop();
    }
  });
  for (let index = 0; index < 8; index++) {
    stops.push(
      hub.subscribe(session("expires"), (event) => events.push(event)),
    );
  }
  const renamedSource = { ...source, name: "Renamed Server" };
  replaceSources([renamedSource]);
  await setImmediate();
  assert.equal(latest(events).sources[0].sourceName, renamedSource.name);
  const before = events.length;
  replaceSources([renamedSource]);
  await setImmediate();
  assert.equal(events.length, before);
  context.mock.timers.tick(60_001);
  assert.equal(
    events.filter((event) => event.type === "unauthorized").length,
    8,
  );
  for (let index = 0; index < 8; index++) {
    stops.push(hub.subscribe(session("expires"), () => {}));
  }
  // Closing an expired stream must not release its replacement's slot.
  for (let index = 0; index < 8; index++) {
    stops[index]();
  }
  assert.throws(() => hub.subscribe(session("expires"), () => {}), {
    status: 429,
  });
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
    hub.retry("account");
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

void test("progress broadcasts only changes and preserves omitted positions for later subscribers", async (context) => {
  const { hub, connections } = setup();
  const events: PlaybackStreamEvent[] = [];
  const stop = hub.subscribe(session("one"), (event) => events.push(event));
  context.after(stop);
  const observer = connections[0].observer;
  observer.snapshot(async () => [entry("movie", "one")]);
  await setImmediate();
  events.length = 0;
  const update = {
    sourceId: source.id,
    sessionId: "movie",
    playerState: "playing",
    playheadSeconds: 12,
  };
  observer.progress([update]);
  for (let index = 0; index < 100; index++) {
    observer.progress([update]);
  }
  observer.progress([]);
  assert.equal(events.length, 1);
  observer.progress([{ ...update, playheadSeconds: undefined }]);
  assert.equal(
    events.length,
    1,
    "omitted positions do not erase the last playhead",
  );
  observer.progress([
    { ...update, playerState: "paused", playheadSeconds: undefined },
  ]);
  assert.deepEqual(events.at(-1), {
    type: "progress",
    updates: [{ ...update, playerState: "paused" }],
  });
  const later: PlaybackStreamEvent[] = [];
  context.after(hub.subscribe(session("one"), (event) => later.push(event)));
  assert.equal(latest(later).viewers[0].items[0].playheadSeconds, 12);
  assert.equal(latest(later).viewers[0].items[0].playerState, "paused");
  observer.progress([
    { ...update, playerState: "paused" },
    { ...update, sessionId: "other", playheadSeconds: 0 },
  ]);
  assert.deepEqual(events.at(-1), {
    type: "progress",
    updates: [{ ...update, sessionId: "other", playheadSeconds: 0 }],
  });
  observer.progress([{ ...update, playerState: "paused", playheadSeconds: 0 }]);
  assert.deepEqual(events.at(-1), {
    type: "progress",
    updates: [{ ...update, playerState: "paused", playheadSeconds: 0 }],
  });
  // A new snapshot resets the baseline: the same progress must be delivered again.
  observer.snapshot(async () => [entry("movie", "one")]);
  await setImmediate();
  events.length = 0;
  observer.progress([{ ...update, playerState: "paused", playheadSeconds: 0 }]);
  assert.equal(events.length, 1);
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
    hub.retry("account");
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
  hub.retry("account");
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
