/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";

import type { Palette } from "@techsquidtv/gifenc";
import {
  applyPalette,
  assembleFrameChunks,
  createTemporalDither,
  GIFEncoder,
  quantize,
} from "@techsquidtv/gifenc";

import { gifExportSettingsForPreset } from "@/lib/export/exportTypes";
import {
  createGifFrameChunkEncoder,
  type GifEncoderJob,
} from "@/lib/export/gif/gifFrameChunk";
import {
  createBestGifFrameEncoder,
  defaultGifFrameWorkerCount,
  type GifFrameWorkerEncodeRequest,
} from "@/lib/export/gif/gifFrameEncoder";

const job: GifEncoderJob = {
  ...gifExportSettingsForPreset("compact"),
  width: 1,
  height: 1,
  paletteMode: "per-frame",
  globalPalette: null,
};

void test("real GIF frame chunks include the GIF89a header and trailer", () => {
  const chunk = createGifFrameChunkEncoder(job).encode({
    sequenceIndex: 0,
    rgba: new Uint8ClampedArray([0, 0, 0, 255]),
    delayMs: 100,
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
    const globalPalette: Palette | null =
      paletteMode === "global"
        ? quantize(
            new Uint8ClampedArray(frames.flatMap((frame) => [...frame])),
            64,
            { format: "rgb565" },
          )
        : null;
    const sequential = GIFEncoder();
    const encoder = createGifFrameChunkEncoder({
      ...job,
      paletteMode,
      globalPalette,
      width: 2,
      paletteFormat: "rgb565",
    });
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

      return encoder.encode({ sequenceIndex, rgba, delayMs: 100 });
    });
    sequential.finish();

    assert.deepEqual(
      assembleFrameChunks(chunks.toReversed(), frames.length),
      sequential.bytes(),
    );
  });
}

void test("per-frame palettes preserve temporal history across frames", () => {
  const settings = {
    ...gifExportSettingsForPreset("balanced"),
    width: 8,
    height: 1,
    maxColors: 2,
    globalPalette: null,
  };
  // A small change in the first gray pixel moves a later pixel across a dither boundary.
  const frames = [0, 4].map(
    (first) =>
      new Uint8ClampedArray(
        [first, 255, 120, 120, 120, 120, 255, 0].flatMap((gray) => [
          gray,
          gray,
          gray,
          255,
        ]),
      ),
  );
  const format = settings.paletteFormat;
  const history = createTemporalDither({
    width: settings.width,
    height: settings.height,
    format,
    ...settings.temporalDither,
  });
  const options = {
    width: settings.width,
    height: settings.height,
    format,
    dither: true,
    temporalDither: history,
  };
  const reference = GIFEncoder();
  const encoder = createGifFrameChunkEncoder(settings);
  const chunks = frames.map((rgba, sequenceIndex) => {
    const palette = quantize(rgba, settings.maxColors, { format });
    const indexed = applyPalette(rgba, palette, options);
    if (sequenceIndex === 1) {
      history.reset();
      assert.notDeepEqual(indexed, applyPalette(rgba, palette, options));
    }
    reference.writeFrame(indexed, settings.width, settings.height, {
      palette,
      delay: 100,
    });
    return encoder.encode({ sequenceIndex, rgba, delayMs: 100 });
  });
  reference.finish();
  encoder.dispose();
  assert.deepEqual(
    assembleFrameChunks(chunks, frames.length),
    reference.bytes(),
  );
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
    const encoder = createBestGifFrameEncoder(job);

    await assert.rejects(
      () =>
        encoder.encodeFrame({
          sequenceIndex: 0,
          rgba: new Uint8ClampedArray(4),
          delayMs: 100,
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

void test("initializes each worker once and transfers only the frame pixel view", async (t) => {
  t.mock.getter(navigator, "hardwareConcurrency", () => 3);
  const previousWorker = globalThis.Worker;
  const messages: GifFrameWorkerEncodeRequest[][] = [];
  function MockWorker() {
    const worker = new EventTarget();
    const requests: GifFrameWorkerEncodeRequest[] = [];
    messages.push(requests);
    let chunks: ReturnType<typeof createGifFrameChunkEncoder> | undefined;
    return Object.assign(worker, {
      postMessage(
        message: GifFrameWorkerEncodeRequest,
        transfer: Transferable[],
      ) {
        const request = structuredClone(message, { transfer });
        requests.push(request);
        if (request.job) {
          chunks = createGifFrameChunkEncoder(request.job);
        }
        assert.ok(chunks);
        const chunk = chunks.encode(request);
        queueMicrotask(() =>
          worker.dispatchEvent(
            new MessageEvent("message", {
              data: { type: "encoded-frame", chunk },
            }),
          ),
        );
      },
      terminate() {},
    });
  }
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: MockWorker,
  });

  const encoder = createBestGifFrameEncoder(job);
  try {
    const reference = createGifFrameChunkEncoder(job);
    const backing = new Uint8ClampedArray([
      99, 99, 99, 99, 255, 0, 0, 255, 88, 88, 88, 88,
    ]);
    const first = {
      sequenceIndex: 0,
      rgba: backing.subarray(4, 8),
      delayMs: 100,
    };
    const expected = reference.encode(first);
    const result = await encoder.encodeFrame(first);
    assert.deepEqual(result, expected);
    assert.equal(backing.buffer.byteLength, 0);
    const received = messages[0][0].rgba;
    assert.equal(received.byteOffset, 4);
    assert.deepEqual([...received], [255, 0, 0, 255]);
    await assert.rejects(
      () => encoder.encodeFrame(first),
      /attached ArrayBuffer/,
    );

    for (let sequenceIndex = 1; sequenceIndex <= 4; sequenceIndex += 1) {
      const frame = {
        sequenceIndex,
        rgba: new Uint8ClampedArray([0, sequenceIndex, 0, 255]),
        delayMs: 100,
      };
      const expectedChunk = reference.encode(frame);
      assert.deepEqual(await encoder.encodeFrame(frame), expectedChunk);
    }
    assert.equal(messages.length, 2);
    assert.equal(messages[0][0].job?.globalPalette, null);
    assert.deepEqual(messages[1][0].job?.globalPalette, expected.globalPalette);
    for (const requests of messages) {
      assert.ok(requests[0].job);
      assert.ok(requests.length >= 2);
      for (const request of requests.slice(1)) {
        assert.deepEqual(Object.keys(request).toSorted(), [
          "delayMs",
          "rgba",
          "sequenceIndex",
        ]);
      }
    }
  } finally {
    encoder.dispose();
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
