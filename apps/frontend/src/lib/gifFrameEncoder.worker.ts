import { createGifTemporalDitherResolver } from "#/lib/gifEncodingSettings";
import {
  encodeGifFrameChunk,
  type EncodeGifFrameChunkInput,
} from "#/lib/gifFrameChunk";
import type {
  GifFrameWorkerEncodeRequest,
  GifFrameWorkerEncodeResponse,
} from "#/lib/gifFrameEncoder";

type GifFrameWorkerGlobal = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<GifFrameWorkerEncodeRequest>) => void,
  ): void;
  postMessage(
    message: GifFrameWorkerEncodeResponse,
    transfer?: Transferable[],
  ): void | boolean;
};

const workerScope = globalThis as unknown as GifFrameWorkerGlobal;
const temporalDitherResolver = createGifTemporalDitherResolver();

workerScope.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type !== "encode-frame") {
    return;
  }

  try {
    const chunk = encodeGifFrameChunk({
      sequenceIndex: message.sequenceIndex,
      rgba: new Uint8ClampedArray(message.rgba),
      width: message.width,
      height: message.height,
      maxColors: message.maxColors,
      delayMs: message.delayMs,
      palette: message.palette,
      paletteFormat: message.paletteFormat,
      ditherMode: message.ditherMode,
      ditherStrength: message.ditherStrength,
      serpentine: message.serpentine,
      temporalDither: temporalDitherResolver.resolve(message),
    } satisfies EncodeGifFrameChunkInput);
    const bytes = new ArrayBuffer(chunk.bytes.byteLength);
    new Uint8Array(bytes).set(chunk.bytes);

    workerScope.postMessage(
      {
        type: "encoded-frame",
        id: message.id,
        sequenceIndex: chunk.sequenceIndex,
        bytes,
      },
      [bytes],
    );
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      id: message.id,
      message:
        error instanceof Error ? error.message : "GIF frame encoding failed.",
    });
  }
});
