/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";

import type { Palette } from "@techsquidtv/gifenc";
import {
  applyPalette,
  assembleFrameChunks,
  GIFEncoder,
  quantize,
} from "@techsquidtv/gifenc";

import { createGifFrameChunkEncoder } from "@/lib/export/gif/gifFrameChunk";
import {
  createBestGifFrameEncoder,
  defaultGifFrameWorkerCount,
  type GifFrameWorkerEncodeRequest,
} from "@/lib/export/gif/gifFrameEncoder";

void test("real GIF frame chunks include the GIF89a header and trailer", () => {
  const chunk = createGifFrameChunkEncoder().encode({
    sequenceIndex: 0,
    rgba: new Uint8ClampedArray([0, 0, 0, 255]),
    width: 1,
    height: 1,
    maxColors: 64,
    delayMs: 100,
    paletteMode: "per-frame",
    paletteFormat: "rgb565",
    ditherMode: "none",
  });
  const bytes = assembleFrameChunks([chunk], 1);

  assert.equal(new TextDecoder().decode(bytes.slice(0, 6)), "GIF89a");
  assert.equal(bytes.at(-1), 59);
});

for (const paletteMode of ["global", "per-frame"] as const) {
  void test(`parallel GIF chunks match sequential gifenc output with ${paletteMode} palettes`, () => {
    const frames = [
      new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]),
      new Uint8ClampedArray([0, 0, 255, 255, 255, 255, 0, 255]),
      new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]),
    ];
    let globalPalette: Palette | null =
      paletteMode === "global"
        ? quantize(
            new Uint8ClampedArray(frames.flatMap((frame) => [...frame])),
            64,
            { format: "rgb565" },
          )
        : null;
    const sequential = GIFEncoder();
    const encoder = createGifFrameChunkEncoder();
    const chunks = frames.map((rgba, sequenceIndex) => {
      const palette =
        paletteMode === "global" && globalPalette
          ? globalPalette
          : quantize(rgba, 64, { format: "rgb565" });
      const indexedPixels = applyPalette(rgba, palette, { format: "rgb565" });
      sequential.writeFrame(indexedPixels, 2, 1, {
        palette:
          paletteMode === "per-frame" || sequenceIndex === 0
            ? palette
            : undefined,
        delay: 100,
        repeat: 0,
      });

      const chunk = encoder.encode({
        sequenceIndex,
        rgba,
        width: 2,
        height: 1,
        maxColors: 64,
        delayMs: 100,
        globalPalette,
        paletteMode,
        paletteFormat: "rgb565",
        ditherMode: "none",
      });
      globalPalette ??= chunk.globalPalette;
      return chunk;
    });
    sequential.finish();

    assert.deepEqual(
      assembleFrameChunks(chunks.toReversed(), frames.length),
      sequential.bytes(),
    );
  });
}

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
          paletteMode: "per-frame",
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

void test("worker transfers frame ownership and preserves the pixel view", async () => {
  const previousWorker = globalThis.Worker;
  const backing = new Uint8ClampedArray([
    99, 99, 99, 99, 255, 0, 0, 255, 88, 88, 88, 88,
  ]);
  const pixels = backing.subarray(4, 8);
  const expected = createGifFrameChunkEncoder().encode({
    sequenceIndex: 0,
    rgba: pixels,
    width: 1,
    height: 1,
    maxColors: 64,
    delayMs: 100,
    paletteMode: "per-frame",
    paletteFormat: "rgb565",
    ditherMode: "none",
  });
  let received: Uint8ClampedArray | undefined;
  let transferredBuffer: ArrayBufferLike | undefined;
  let onMessage: ((event: MessageEvent) => void) | undefined;
  const worker = {
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (type === "message") {
        onMessage = listener;
      }
    },
    removeEventListener() {},
    postMessage(
      message: GifFrameWorkerEncodeRequest,
      transfer: Transferable[],
    ) {
      transferredBuffer = transfer[0] as ArrayBuffer;
      const cloned = structuredClone(message, { transfer });
      received = cloned.rgba;
      const chunk = createGifFrameChunkEncoder().encode(cloned);
      onMessage?.({
        data: {
          type: "encoded-frame",
          id: cloned.id,
          chunk,
        },
      } as MessageEvent);
    },
    terminate() {},
  };
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: function MockWorker() {
      return worker;
    },
  });

  try {
    const encoder = createBestGifFrameEncoder({
      requiresSequentialFrames: true,
    });
    const originalBuffer = pixels.buffer;
    const chunk = await encoder.encodeFrame({
      sequenceIndex: 0,
      imageData: { data: pixels } as ImageData,
      width: 1,
      height: 1,
      maxColors: 64,
      delayMs: 100,
      paletteMode: "per-frame",
      paletteFormat: "rgb565",
      ditherMode: "none",
    });
    assert.equal(transferredBuffer, originalBuffer);
    assert.equal(originalBuffer.byteLength, 0);
    assert.equal(received?.byteOffset, 4);
    assert.deepEqual([...(received ?? [])], [255, 0, 0, 255]);
    assert.deepEqual(chunk.bytes, expected.bytes);
    await assert.rejects(
      () =>
        encoder.encodeFrame({
          sequenceIndex: 1,
          imageData: { data: pixels } as ImageData,
          width: 1,
          height: 1,
          maxColors: 64,
          delayMs: 100,
          paletteMode: "per-frame",
          paletteFormat: "rgb565",
          ditherMode: "none",
        }),
      /attached ArrayBuffer/,
    );
    encoder.dispose();
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
