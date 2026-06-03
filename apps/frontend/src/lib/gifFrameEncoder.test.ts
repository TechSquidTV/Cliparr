/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  GIF_TRAILER_BYTE,
  concatenateGifFrameChunks,
  encodeGifFrameChunk,
} from "@/lib/gifFrameChunk";
import {
  createInlineGifFrameEncoder,
  defaultGifFrameWorkerCount,
} from "@/lib/gifFrameEncoder";

void test("encodes GIF frame chunks without a trailer", () => {
  const calls: Array<{
    auto?: boolean;
    delay?: number;
    first?: boolean;
    maxColors?: number;
    repeat?: number;
  }> = [];
  const palette = [[0, 0, 0]] satisfies Array<[number, number, number]>;
  const chunk = encodeGifFrameChunk(
    {
      sequenceIndex: 0,
      rgba: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
      maxColors: 64,
      delayMs: 100,
    },
    {
      createGifEncoder: (options) => {
        calls.push({ auto: options?.auto });

        return {
          bytes: () => new Uint8Array([1, 2, 3]),
          bytesView: () => new Uint8Array([1, 2, 3]),
          finish: () => undefined,
          reset: () => undefined,
          writeFrame: (_index, _width, _height, writeOptions) => {
            calls.push({
              delay: writeOptions?.delay,
              first: writeOptions?.first,
              repeat: writeOptions?.repeat,
            });
          },
        };
      },
      quantizeGifFrame: (_rgba, maxColors) => {
        calls.push({ maxColors });
        return palette;
      },
      applyGifPalette: (_rgba, appliedPalette) => {
        assert.equal(appliedPalette, palette);
        return new Uint8Array([0]);
      },
    },
  );

  assert.equal(chunk.sequenceIndex, 0);
  assert.deepEqual([...chunk.bytes], [1, 2, 3]);
  assert.deepEqual(calls, [
    { maxColors: 64 },
    { auto: false },
    {
      delay: 100,
      first: true,
      repeat: 0,
    },
  ]);
});

void test("concatenates GIF frame chunks in sequence order with a trailer", () => {
  const bytes = concatenateGifFrameChunks([
    { sequenceIndex: 1, bytes: new Uint8Array([3, 4]) },
    { sequenceIndex: 0, bytes: new Uint8Array([1, 2]) },
  ]);

  assert.deepEqual([...bytes], [1, 2, 3, 4, GIF_TRAILER_BYTE]);
});

void test("inline GIF frame encoder uses the shared chunk encoder contract", async () => {
  const encoder = createInlineGifFrameEncoder({
    createGifEncoder: () => ({
      bytes: () => new Uint8Array([9]),
      bytesView: () => new Uint8Array([9]),
      finish: () => undefined,
      reset: () => undefined,
      writeFrame: () => undefined,
    }),
    quantizeGifFrame: () => [[0, 0, 0]],
    applyGifPalette: () => new Uint8Array([0]),
  });

  const chunk = await encoder.encodeFrame({
    sequenceIndex: 2,
    imageData: {
      data: new Uint8ClampedArray(4),
    } as ImageData,
    width: 1,
    height: 1,
    maxColors: 128,
    delayMs: 83.33,
  });

  assert.equal(encoder.concurrency, 1);
  assert.equal(chunk.sequenceIndex, 2);
  assert.deepEqual([...chunk.bytes], [9]);
});

void test("bounds GIF frame worker count", () => {
  assert.equal(defaultGifFrameWorkerCount(0), 1);
  assert.equal(defaultGifFrameWorkerCount(2), 2);
  assert.equal(defaultGifFrameWorkerCount(99), 4);
});
