/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  GIF_TRAILER_BYTE,
  concatenateGifFrameChunks,
  encodeGifFrameChunk,
} from "@/lib/gifFrameChunk";
import {
  copyImageDataBuffer,
  createBestGifFrameEncoder,
  createInlineGifFrameEncoder,
  defaultGifFrameWorkerCount,
} from "@/lib/gifFrameEncoder";
import type { GIFEncoderInstance } from "@techsquidtv/gifenc";

void test("encodes GIF frame chunks without a trailer", () => {
  const calls: Array<{
    auto?: boolean;
    delay?: number;
    first?: boolean;
    header?: boolean;
    format?: string;
    maxColors?: number;
    repeat?: number;
    temporalDitherPresent?: boolean;
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
      paletteFormat: "rgb565",
      ditherMode: "spatial",
    },
    {
      createGifEncoder: (options) => {
        calls.push({ auto: options?.auto });

        return createMockGifEncoder({
          bytes: () => new Uint8Array([1, 2, 3]),
          bytesView: () => new Uint8Array([1, 2, 3]),
          writeHeader: () => {
            calls.push({ header: true });
          },
          writeFrame: (_index, _width, _height, writeOptions) => {
            calls.push({
              delay: writeOptions?.delay,
              first: writeOptions?.first,
              repeat: writeOptions?.repeat,
            });
          },
        });
      },
      quantizeGifFrame: (_rgba, maxColors) => {
        calls.push({ maxColors });
        return palette;
      },
      applyGifPalette: (_rgba, appliedPalette, options) => {
        assert.equal(appliedPalette, palette);
        if (typeof options !== "string") {
          calls.push({
            format: options?.format,
            temporalDitherPresent: Boolean(options?.temporalDither),
          });
        }
        return new Uint8Array([0]);
      },
    },
  );

  assert.equal(chunk.sequenceIndex, 0);
  assert.deepEqual([...chunk.bytes], [1, 2, 3]);
  assert.deepEqual(calls, [
    { maxColors: 64 },
    {
      format: "rgb565",
      temporalDitherPresent: false,
    },
    { auto: false },
    { header: true },
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

void test("real GIF frame chunks include the GIF89a header and trailer", () => {
  const chunk = encodeGifFrameChunk({
    sequenceIndex: 0,
    rgba: new Uint8ClampedArray([0, 0, 0, 255]),
    width: 1,
    height: 1,
    maxColors: 64,
    delayMs: 100,
    paletteFormat: "rgb565",
    ditherMode: "none",
  });
  const bytes = concatenateGifFrameChunks([chunk]);

  assert.equal(new TextDecoder().decode(bytes.slice(0, 6)), "GIF89a");
  assert.equal(bytes.at(-1), GIF_TRAILER_BYTE);
});

void test("inline GIF frame encoder uses the shared chunk encoder contract", async () => {
  let temporalDitherPresent = false;
  const encoder = createInlineGifFrameEncoder({
    createGifEncoder: () =>
      createMockGifEncoder({
        bytes: () => new Uint8Array([9]),
        bytesView: () => new Uint8Array([9]),
        writeFrame: () => {},
      }),
    quantizeGifFrame: () => [[0, 0, 0]],
    applyGifPalette: (_rgba, _palette, options) => {
      if (typeof options !== "string") {
        temporalDitherPresent = Boolean(options?.temporalDither);
      }

      return new Uint8Array([0]);
    },
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
    paletteFormat: "rgb565",
    ditherMode: "spatial-temporal",
    temporalDither: {
      strength: 0.45,
      decay: 0.6,
      maxError: 48,
      changeDetection: {
        pixelThreshold: 24,
      },
    },
  });

  assert.equal(encoder.concurrency, 1);
  assert.equal(chunk.sequenceIndex, 2);
  assert.deepEqual([...chunk.bytes], [9]);
  assert.equal(temporalDitherPresent, true);
});

void test("worker GIF frame encoder rejects when postMessage throws", async () => {
  const previousWorker = globalThis.Worker;
  const postMessageError = new Error("Worker cannot accept frame data.");
  let terminated = false;

  const throwingWorker = {
    addEventListener() {},
    removeEventListener() {},
    postMessage() {
      throw postMessageError;
    },
    terminate() {
      terminated = true;
    },
  } as unknown as Worker;

  function ThrowingWorker() {
    return throwingWorker;
  }

  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: ThrowingWorker,
  });

  try {
    const encoder = createBestGifFrameEncoder();

    await assert.rejects(
      () =>
        encoder.encodeFrame({
          sequenceIndex: 0,
          imageData: {
            data: new Uint8ClampedArray(4),
          } as ImageData,
          width: 1,
          height: 1,
          maxColors: 64,
          delayMs: 100,
          paletteFormat: "rgb565",
          ditherMode: "none",
        }),
      postMessageError,
    );

    encoder.dispose();

    assert.equal(terminated, true);
  } finally {
    if (previousWorker) {
      Object.defineProperty(globalThis, "Worker", {
        configurable: true,
        value: previousWorker,
      });
    } else {
      Reflect.deleteProperty(globalThis, "Worker");
    }
  }
});

void test("bounds GIF frame worker count", () => {
  assert.equal(defaultGifFrameWorkerCount(0), 1);
  assert.equal(defaultGifFrameWorkerCount(2), 2);
  assert.equal(defaultGifFrameWorkerCount(99), 4);
});

void test("copies image data before worker transfer", () => {
  const data = new Uint8ClampedArray([1, 2, 3, 4]);
  const buffer = copyImageDataBuffer(data);
  const copiedData = new Uint8ClampedArray(buffer);

  assert.notEqual(buffer, data.buffer);
  assert.deepEqual([...copiedData], [1, 2, 3, 4]);

  data[0] = 99;

  assert.deepEqual([...copiedData], [1, 2, 3, 4]);
});

function createMockGifEncoder(
  overrides: Partial<GIFEncoderInstance> = {},
): GIFEncoderInstance {
  return {
    buffer: new ArrayBuffer(0),
    bytes: () => new Uint8Array(),
    bytesView: () => new Uint8Array(),
    finish: () => {},
    reset: () => {},
    stream: {} as GIFEncoderInstance["stream"],
    writeFrame: () => {},
    writeHeader: () => {},
    ...overrides,
  };
}
