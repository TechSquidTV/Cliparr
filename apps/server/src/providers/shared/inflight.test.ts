import assert from "node:assert/strict";
import test from "node:test";
import { dedupeInflightFetch } from "@/providers/shared/inflight";

void test("concurrent callers share one fetch", async () => {
  const inflight = new Map<string, Promise<string>>();
  let fetchCalls = 0;
  let release!: (value: string) => void;
  const gate = new Promise<string>((resolve) => {
    release = resolve;
  });

  const first = dedupeInflightFetch(inflight, "key", () => {
    fetchCalls += 1;
    return gate;
  });
  const second = dedupeInflightFetch(inflight, "key", () => {
    fetchCalls += 1;
    return Promise.resolve("second");
  });

  assert.equal(fetchCalls, 1);
  release("shared");
  assert.deepEqual(await Promise.all([first, second]), ["shared", "shared"]);
  assert.equal(inflight.size, 0);
});

void test("different keys fetch independently", async () => {
  const inflight = new Map<string, Promise<string>>();
  let fetchCalls = 0;
  const fetch = (value: string) => () => {
    fetchCalls += 1;
    return Promise.resolve(value);
  };

  const [a, b] = await Promise.all([
    dedupeInflightFetch(inflight, "a", fetch("A")),
    dedupeInflightFetch(inflight, "b", fetch("B")),
  ]);

  assert.deepEqual([a, b], ["A", "B"]);
  assert.equal(fetchCalls, 2);
});

void test("rejection is not cached and the next call retries", async () => {
  const inflight = new Map<string, Promise<string>>();
  let fetchCalls = 0;

  await assert.rejects(
    dedupeInflightFetch(inflight, "key", () => {
      fetchCalls += 1;
      return Promise.reject(new Error("boom"));
    }),
    /boom/,
  );
  assert.equal(inflight.size, 0);

  const value = await dedupeInflightFetch(inflight, "key", () => {
    fetchCalls += 1;
    return Promise.resolve("recovered");
  });
  assert.equal(value, "recovered");
  assert.equal(fetchCalls, 2);
});

void test("a stale map entry is never removed by a later fetch", async () => {
  const inflight = new Map<string, Promise<string>>();
  let releaseFirst!: (value: string) => void;
  const firstGate = new Promise<string>((resolve) => {
    releaseFirst = resolve;
  });

  const first = dedupeInflightFetch(inflight, "key", () => firstGate);
  // Simulate the entry being replaced (e.g. after cleanup raced a new call).
  const replacement = Promise.resolve("replacement");
  inflight.set("key", replacement);

  releaseFirst("first");
  assert.equal(await first, "first");
  // Cleanup must not delete the newer entry.
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(inflight.get("key"), replacement);
});
