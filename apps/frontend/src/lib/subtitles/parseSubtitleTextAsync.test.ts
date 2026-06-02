/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSubtitleTextAsync,
  type SubtitleParseWorker,
} from "@/lib/subtitles/parseSubtitleTextAsync";
import type { SubtitleCue } from "@/lib/subtitles/types";

const srtText = `1
00:00:01,000 --> 00:00:02,500
Hello from subtitles
`;

const workerCue: SubtitleCue = {
  id: "worker-cue",
  startTime: 3,
  endTime: 4,
  text: "Parsed off-thread",
  lines: ["Parsed off-thread"],
};

function createFakeSubtitleParseWorker(response?: unknown) {
  let postedMessage: unknown;
  let terminated = false;
  const listeners = new Map<"message" | "error", Set<EventListener>>();

  const emit = (type: "message" | "error", event: Event) => {
    for (const listener of listeners.get(type) ?? []) {
      listener(event);
    }
  };

  const worker: SubtitleParseWorker = {
    addEventListener(type, listener) {
      const typeListeners = listeners.get(type) ?? new Set<EventListener>();
      typeListeners.add(listener);
      listeners.set(type, typeListeners);
    },
    postMessage(message) {
      postedMessage = message;
      if (!response) {
        return;
      }

      queueMicrotask(() => {
        emit("message", { data: response } as MessageEvent);
      });
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    terminate() {
      terminated = true;
    },
  };

  return {
    get postedMessage() {
      return postedMessage;
    },
    get terminated() {
      return terminated;
    },
    worker,
  };
}

void test("parses subtitle text through a worker when available", async () => {
  const fakeWorker = createFakeSubtitleParseWorker({
    ok: true,
    cues: [workerCue],
  });

  const cues = await parseSubtitleTextAsync(
    srtText,
    "srt",
    undefined,
    () => fakeWorker.worker,
  );

  assert.deepEqual(cues, [workerCue]);
  assert.deepEqual(fakeWorker.postedMessage, { format: "srt", text: srtText });
  assert.equal(fakeWorker.terminated, true);
});

void test("falls back to the main-thread parser when worker creation fails", async () => {
  const cues = await parseSubtitleTextAsync(srtText, "srt", undefined, () => {
    throw new Error("Workers are unavailable");
  });

  assert.deepEqual(cues, [
    {
      id: "1",
      startTime: 1,
      endTime: 2.5,
      text: "Hello from subtitles",
      lines: ["Hello from subtitles"],
    },
  ]);
});

void test("terminates the subtitle parsing worker when aborted", async () => {
  const fakeWorker = createFakeSubtitleParseWorker();
  const abortController = new AbortController();
  const parsePromise = parseSubtitleTextAsync(
    srtText,
    "srt",
    abortController.signal,
    () => fakeWorker.worker,
  );

  abortController.abort();

  await assert.rejects(parsePromise, { name: "AbortError" });
  assert.equal(fakeWorker.terminated, true);
});
