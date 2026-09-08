import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test, { type TestContext } from "node:test";
import { fetchMediaHandleRequest } from "@/providers/shared/mediaProxy";
import type { MediaHandle } from "@/providers/types";

const handle: MediaHandle = {
  id: "lifecycle",
  providerId: "plex",
  sourceId: "source-1",
  baseUrl: "http://192.168.1.50:32400",
  path: "/video.mp4",
  token: "token",
  lastAccessedAt: 0,
};

function mockStreamingFetch(context: TestContext) {
  let signal: AbortSignal | null | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let cancelled = false;
  context.mock.method(
    globalThis,
    "fetch",
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      signal = init?.signal;
      assert.ok(signal);
      const body = new ReadableStream<Uint8Array>({
        start(nextController) {
          controller = nextController;
          signal?.addEventListener(
            "abort",
            () => nextController.error(signal?.reason),
            { once: true },
          );
        },
        cancel() {
          cancelled = true;
        },
      });
      const response = new Response(body, {
        status: 206,
        headers: { "content-type": "video/mp4" },
      });
      Object.defineProperties(response, {
        url: { value: "https://cdn.example.com/final/video.mp4" },
        redirected: { value: true },
      });
      return response;
    },
  );
  return {
    get signal() {
      assert.ok(signal);
      return signal;
    },
    get cancelled() {
      return cancelled;
    },
    enqueue(value: number) {
      assert.ok(controller);
      controller.enqueue(new Uint8Array([value]));
    },
    close() {
      assert.ok(controller);
      controller.close();
    },
  };
}

void test("times out a stalled response body after headers arrive", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const upstream = mockStreamingFetch(context);
  const caller = new AbortController();
  const response = await fetchMediaHandleRequest(handle, {
    timeoutMs: 100,
    signal: caller.signal,
  });
  const rejected = assert.rejects(response.text(), { name: "TimeoutError" });
  context.mock.timers.tick(100);
  await rejected;
  assert.equal(upstream.signal.aborted, true);
  assert.equal(getEventListeners(caller.signal, "abort").length, 0);
});

void test("forwards caller cancellation while the response body is being read", async (context) => {
  const upstream = mockStreamingFetch(context);
  const caller = new AbortController();
  const response = await fetchMediaHandleRequest(handle, {
    signal: caller.signal,
  });
  const reason = new Error("Editor closed");
  const rejected = assert.rejects(
    response.text(),
    (error: Error) => error === reason,
  );
  caller.abort(reason);
  await rejected;
  assert.equal(upstream.signal.reason, reason);
  assert.equal(getEventListeners(caller.signal, "abort").length, 0);
});

void test("resets the body idle timeout on each chunk and cleans up at EOF", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const upstream = mockStreamingFetch(context);
  const caller = new AbortController();
  const response = await fetchMediaHandleRequest(handle, {
    timeoutMs: 100,
    signal: caller.signal,
  });
  assert.equal(response.url, "https://cdn.example.com/final/video.mp4");
  assert.equal(response.redirected, true);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  const reader = response.body?.getReader();
  assert.ok(reader);
  for (const value of [1, 2, 3]) {
    context.mock.timers.tick(80);
    upstream.enqueue(value);
    const chunk = await reader.read();
    assert.deepEqual(chunk.value, new Uint8Array([value]));
    assert.equal(upstream.signal.aborted, false);
  }
  upstream.close();
  const end = await reader.read();
  assert.equal(end.done, true);
  context.mock.timers.tick(1000);
  caller.abort();
  assert.equal(upstream.signal.aborted, false);
  assert.equal(getEventListeners(caller.signal, "abort").length, 0);
});

void test("cancelling a response body cancels upstream and releases its timer", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const upstream = mockStreamingFetch(context);
  const caller = new AbortController();
  const response = await fetchMediaHandleRequest(handle, {
    timeoutMs: 100,
    signal: caller.signal,
  });
  await response.body?.cancel();
  context.mock.timers.tick(1000);
  caller.abort();
  assert.equal(upstream.cancelled, true);
  assert.equal(upstream.signal.aborted, false);
  assert.equal(getEventListeners(caller.signal, "abort").length, 0);
});

void test("releases timeout and abort listeners immediately for bodyless responses", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let upstreamSignal: AbortSignal | null | undefined;
  context.mock.method(
    globalThis,
    "fetch",
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      upstreamSignal = init?.signal;
      return new Response(null, { status: 204 });
    },
  );
  const caller = new AbortController();
  const response = await fetchMediaHandleRequest(handle, {
    timeoutMs: 100,
    signal: caller.signal,
  });
  assert.equal(response.status, 204);
  context.mock.timers.tick(1000);
  caller.abort();
  assert.equal(upstreamSignal?.aborted, false);
  assert.equal(getEventListeners(caller.signal, "abort").length, 0);
});
