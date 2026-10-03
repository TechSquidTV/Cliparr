import assert from "node:assert/strict";
import test from "node:test";
import { createPlaybackResolverCache } from "@/playback/resolverCache";
import type {
  CurrentlyPlayingEntry,
  PlaybackResolver,
} from "@/providers/types";
import type { ProviderSessionRecord } from "@/session/store";

interface Row {
  id: string;
  state: string;
}

interface Prepared {
  rowId: string;
}

function testSession(id: string): ProviderSessionRecord {
  return {
    id,
    providerId: "plex",
    providerAccountId: "account",
    userToken: "token",
    mediaHandles: new Map(),
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

function testEntry(row: Row): CurrentlyPlayingEntry {
  return {
    viewer: { id: "viewer", providerId: "plex", name: "Viewer" },
    item: {
      id: row.id,
      playbackSessionId: row.id,
      source: { id: "source", name: "Source", providerId: "plex" },
      title: row.id,
      type: "video",
      duration: 0,
      playheadSeconds: 0,
      playerTitle: "player",
      playerState: row.state,
    },
  };
}

void test("prepareMany batches uncached rows into one call", async () => {
  const prepareManyCalls: string[][] = [];
  const resolve = createPlaybackResolverCache<Row, Prepared>({
    key: (row) => row.id,
    prepareMany: async (rows) => {
      prepareManyCalls.push(rows.map((row) => row.id));
      return rows.map((row) => ({ rowId: row.id }));
    },
    bind: (row, prepared) => {
      assert.equal(prepared.rowId, row.id);
      return Promise.resolve(testEntry(row));
    },
    update: (entry, row) => ({
      ...entry,
      item: { ...entry.item, playerState: row.state },
    }),
  });

  const rows = [
    { id: "a", state: "playing" },
    { id: "b", state: "paused" },
    { id: "c", state: "playing" },
  ];
  const entries = await resolve(rows)(testSession("s1"));

  assert.equal(prepareManyCalls.length, 1);
  assert.deepEqual(prepareManyCalls[0], ["a", "b", "c"]);
  assert.deepEqual(
    entries.map((entry) => entry.item.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    entries.map((entry) => entry.item.playerState),
    ["playing", "paused", "playing"],
  );
});

void test("prepareMany only covers missing keys on later reconciles", async () => {
  const prepareManyCalls: string[][] = [];
  const resolve = createPlaybackResolverCache<Row, Prepared>({
    key: (row) => row.id,
    prepareMany: async (rows) => {
      prepareManyCalls.push(rows.map((row) => row.id));
      return rows.map((row) => ({ rowId: row.id }));
    },
    bind: (row) => Promise.resolve(testEntry(row)),
    update: (entry, row) => ({
      ...entry,
      item: { ...entry.item, playerState: row.state },
    }),
  });

  const first: PlaybackResolver = resolve([
    { id: "a", state: "playing" },
    { id: "b", state: "playing" },
  ]);
  await first(testSession("s1"));
  assert.deepEqual(prepareManyCalls, [["a", "b"]]);

  // "a" is cached; only "c" needs preparation, and "b" is pruned.
  const second: PlaybackResolver = resolve([
    { id: "a", state: "paused" },
    { id: "c", state: "playing" },
  ]);
  const entries = await second(testSession("s1"));
  assert.deepEqual(prepareManyCalls, [["a", "b"], ["c"]]);
  assert.deepEqual(
    entries.map((entry) => entry.item.id),
    ["a", "c"],
  );
  // The cached entry for "a" is refreshed through update(), not re-prepared.
  assert.equal(
    entries.find((entry) => entry.item.id === "a")?.item.playerState,
    "paused",
  );
});

void test("duplicate keys share one batched preparation", async () => {
  let prepareManyCalls = 0;
  const resolve = createPlaybackResolverCache<Row, Prepared>({
    key: (row) => row.id,
    prepareMany: async (rows) => {
      prepareManyCalls += 1;
      return rows.map((row) => ({ rowId: row.id }));
    },
    bind: (row) => Promise.resolve(testEntry(row)),
    update: (entry) => entry,
  });

  const entries = await resolve([
    { id: "a", state: "playing" },
    { id: "a", state: "paused" },
  ])(testSession("s1"));

  assert.equal(prepareManyCalls, 1);
  assert.equal(entries.length, 2);
});

void test("batch failure rejects rows and retry uses one fresh batch", async () => {
  let attempts = 0;
  const resolve = createPlaybackResolverCache<Row, Prepared>({
    key: (row) => row.id,
    prepareMany: async (rows) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("batch failed");
      }
      return rows.map((row) => ({ rowId: row.id }));
    },
    bind: (row) => Promise.resolve(testEntry(row)),
    update: (entry) => entry,
  });

  const rows = [
    { id: "a", state: "playing" },
    { id: "b", state: "playing" },
  ];
  await assert.rejects(resolve(rows)(testSession("s1")), /batch failed/);
  assert.equal(attempts, 1);

  // The failed batch is dropped; retry keeps the batched preparation strategy.
  const entries = await resolve(rows)(testSession("s1"));
  assert.equal(attempts, 2);
  assert.equal(entries.length, 2);
});

void test("short prepareMany result raises a clear error", async () => {
  const resolve = createPlaybackResolverCache<Row, Prepared>({
    key: (row) => row.id,
    prepareMany: async () => [],
    bind: (row) => Promise.resolve(testEntry(row)),
    update: (entry) => entry,
  });

  await assert.rejects(
    resolve([{ id: "a", state: "playing" }])(testSession("s1")),
    /Batched playback preparation returned an invalid result count/,
  );
});

void test("preparation is lazy and shared while bindings belong to each session", async () => {
  let preparations = 0;
  const bindings: ProviderSessionRecord[] = [];
  const resolve = createPlaybackResolverCache<Row, Prepared>({
    key: (row) => row.id,
    prepareMany: async (rows) => {
      preparations += 1;
      return rows.map((row) => ({ rowId: row.id }));
    },
    bind: async (row, _prepared, session) => {
      bindings.push(session);
      return testEntry(row);
    },
    update: (entry) => entry,
  });
  const resolver = resolve([{ id: "a", state: "playing" }]);
  assert.equal(preparations, 0);
  const first = testSession("s1");
  const second = testSession("s2");
  await Promise.all([resolver(first), resolver(second), resolver(first)]);
  assert.equal(preparations, 1);
  assert.deepEqual(bindings, [first, second]);
});
