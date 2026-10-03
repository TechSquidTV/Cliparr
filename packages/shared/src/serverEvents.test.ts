import assert from "node:assert/strict";
import test from "node:test";
import { readServerEvents } from "#server-events";

function streamFromChunks(chunks: Uint8Array[]) {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index] as Uint8Array);
      index += 1;
    },
  });
}

function textChunks(...parts: string[]) {
  const encoder = new TextEncoder();
  return parts.map((part) => encoder.encode(part));
}

async function collectEvents(chunks: Uint8Array[]) {
  const events: { event: string; data: string }[] = [];
  let activityCalls = 0;
  await readServerEvents(
    streamFromChunks(chunks),
    (event, data) => {
      events.push({ event, data });
    },
    () => {
      activityCalls += 1;
    },
  );
  return { events, activityCalls };
}

void test("parses named events with default type", async () => {
  const { events } = await collectEvents(
    textChunks("event: status\ndata: hello\n\n"),
  );
  assert.deepEqual(events, [{ event: "status", data: "hello" }]);
});

void test("uses message as the default event type", async () => {
  const { events } = await collectEvents(textChunks("data: ping\n\n"));
  assert.deepEqual(events, [{ event: "message", data: "ping" }]);
});

void test("joins multiline data and handles CRLF", async () => {
  const { events } = await collectEvents(
    textChunks("data: line one\r\ndata: line two\r\n\r\n"),
  );
  assert.deepEqual(events, [{ event: "message", data: "line one\nline two" }]);
});

void test("ignores comments and resets state between events", async () => {
  const { events } = await collectEvents(
    textChunks(": comment\n\ndata: a\n\ndata: b\n\n"),
  );
  assert.deepEqual(events, [
    { event: "message", data: "a" },
    { event: "message", data: "b" },
  ]);
});

void test("handles events split across chunks and split UTF-8", async () => {
  const encoder = new TextEncoder();
  // "héllo" with é encoded as the two UTF-8 bytes C3 A9; split the byte
  // stream between those two bytes so the decoder must hold a partial
  // character across chunks.
  const bytes = encoder.encode("data: h\u00E9llo\n\n");
  const splitAt = bytes.indexOf(195) + 1;
  assert.ok(splitAt > 0 && splitAt < bytes.length);
  const { events } = await collectEvents([
    bytes.slice(0, splitAt),
    bytes.slice(splitAt),
  ]);
  assert.deepEqual(events, [{ event: "message", data: "h\u00E9llo" }]);
});

void test("handles many lines without quadratic slowdown", async () => {
  const lines: string[] = [];
  for (let index = 0; index < 5000; index++) {
    lines.push(`data: line-${index}`);
  }
  const { events } = await collectEvents(textChunks(`${lines.join("\n")}\n\n`));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, "message");
  assert.ok(events[0]?.data.startsWith("line-0\nline-1"));
  assert.ok(events[0]?.data.endsWith("line-4999"));
});

void test("calls onActivity for each chunk", async () => {
  const { activityCalls } = await collectEvents(
    textChunks("data: a\n\n", "data: b\n\n"),
  );
  assert.equal(activityCalls, 2);
});

void test("rejects events exceeding the size limit", async () => {
  const big = new Uint8Array(4 * 1024 * 1024 + 1).fill(0x61);
  await assert.rejects(collectEvents([big]), /Event exceeds size limit/);
});

void test("data without trailing blank line is not emitted", async () => {
  const { events } = await collectEvents(textChunks("data: incomplete"));
  assert.deepEqual(events, []);
});

void test("handles a long line fragmented into thousands of tiny chunks", async () => {
  const value = "x".repeat(100_000);
  const fragments = [
    "data: ",
    ...Array.from({ length: 10_000 }, () => "x".repeat(10)),
    "\r",
    "\n",
    "\n",
  ];
  const { events } = await collectEvents(textChunks(...fragments));
  assert.deepEqual(events, [{ event: "message", data: value }]);
});

void test("enforces the pending-line and accumulated-data limits across chunks", async () => {
  const limit = 4 * 1024 * 1024;
  await assert.rejects(
    collectEvents(textChunks("x".repeat(limit), "x")),
    /Event exceeds size limit/,
  );
  await assert.rejects(
    collectEvents(
      textChunks(
        `data: ${"x".repeat(limit / 2)}\n`,
        `data: ${"x".repeat(limit / 2)}\n`,
      ),
    ),
    /Event exceeds size limit/,
  );
});

void test("cancels and releases the stream on callback failure", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: a\n\n"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const reason = new Error("callback failed");
  await assert.rejects(
    readServerEvents(body, () => {
      throw reason;
    }),
    (error: Error) => error === reason,
  );
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});
