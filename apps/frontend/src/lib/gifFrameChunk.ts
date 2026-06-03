import { GIFEncoder, applyPalette, quantize } from "gifenc/dist/gifenc.esm.js";
import type { GifPalette } from "gifenc/dist/gifenc.esm.js";

export const GIF_TRAILER_BYTE = 0x3b;

export interface EncodeGifFrameChunkInput {
  sequenceIndex: number;
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  maxColors: number;
  delayMs: number;
  repeat?: number;
  palette?: GifPalette | null;
}

export interface EncodeGifFrameChunkHelpers {
  createGifEncoder?: typeof GIFEncoder;
  quantizeGifFrame?: typeof quantize;
  applyGifPalette?: typeof applyPalette;
}

export interface GifFrameChunk {
  sequenceIndex: number;
  bytes: Uint8Array;
}

export function encodeGifFrameChunk(
  {
    sequenceIndex,
    rgba,
    width,
    height,
    maxColors,
    delayMs,
    repeat = 0,
    palette,
  }: EncodeGifFrameChunkInput,
  {
    createGifEncoder = GIFEncoder,
    quantizeGifFrame = quantize,
    applyGifPalette = applyPalette,
  }: EncodeGifFrameChunkHelpers = {},
): GifFrameChunk {
  const resolvedPalette = palette ?? quantizeGifFrame(rgba, maxColors);
  const indexedPixels = applyGifPalette(rgba, resolvedPalette);
  const gif = createGifEncoder({ auto: false });

  gif.writeFrame(indexedPixels, width, height, {
    first: sequenceIndex === 0,
    repeat,
    delay: delayMs,
    palette: resolvedPalette,
  });

  return {
    sequenceIndex,
    bytes: copyBytes(gif.bytesView()),
  };
}

export function concatenateGifFrameChunks(
  chunks: readonly GifFrameChunk[],
): Uint8Array {
  if (chunks.length === 0) {
    return new Uint8Array();
  }

  const orderedChunks = [...chunks].sort(
    (left, right) => left.sequenceIndex - right.sequenceIndex,
  );
  const byteLength =
    orderedChunks.reduce((total, chunk) => total + chunk.bytes.byteLength, 0) +
    1;
  const bytes = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of orderedChunks) {
    bytes.set(chunk.bytes, offset);
    offset += chunk.bytes.byteLength;
  }

  bytes[offset] = GIF_TRAILER_BYTE;

  return bytes;
}

function copyBytes(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return copy;
}
