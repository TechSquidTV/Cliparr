import { GIFEncoder, applyPalette, quantize } from "@techsquidtv/gifenc";
import type {
  ApplyPaletteOptions,
  Palette,
  TemporalDitherState,
} from "@techsquidtv/gifenc";
import type {
  GifDitherMode,
  GifPaletteFormat,
} from "#/lib/gifEncodingSettings";

export const GIF_TRAILER_BYTE = 59;

export interface EncodeGifFrameChunkInput {
  sequenceIndex: number;
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  maxColors: number;
  delayMs: number;
  repeat?: number;
  palette?: Palette | null;
  paletteFormat: GifPaletteFormat;
  ditherMode: GifDitherMode;
  ditherStrength?: number;
  serpentine?: boolean;
  temporalDither?: TemporalDitherState | null;
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
    paletteFormat,
    ditherMode,
    ditherStrength,
    serpentine,
    temporalDither,
  }: EncodeGifFrameChunkInput,
  {
    createGifEncoder = GIFEncoder,
    quantizeGifFrame = quantize,
    applyGifPalette = applyPalette,
  }: EncodeGifFrameChunkHelpers = {},
): GifFrameChunk {
  const resolvedPalette =
    palette ?? quantizeGifFrame(rgba, maxColors, { format: paletteFormat });
  const indexedPixels = applyGifPalette(
    rgba,
    resolvedPalette,
    applyPaletteOptions({
      ditherMode,
      ditherStrength,
      height,
      paletteFormat,
      serpentine,
      temporalDither,
      width,
    }),
  );
  const gif = createGifEncoder({ auto: false });

  if (sequenceIndex === 0) {
    gif.writeHeader();
  }

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

function applyPaletteOptions({
  ditherMode,
  ditherStrength,
  height,
  paletteFormat,
  serpentine,
  temporalDither,
  width,
}: {
  ditherMode: GifDitherMode;
  ditherStrength?: number;
  height: number;
  paletteFormat: GifPaletteFormat;
  serpentine?: boolean;
  temporalDither?: TemporalDitherState | null;
  width: number;
}): ApplyPaletteOptions {
  if (ditherMode === "none") {
    return { format: paletteFormat };
  }

  return {
    format: paletteFormat,
    dither: "floyd-steinberg",
    ditherStrength,
    height,
    serpentine,
    temporalDither:
      ditherMode === "spatial-temporal" ? temporalDither : undefined,
    width,
  };
}

export function concatenateGifFrameChunks(
  chunks: readonly GifFrameChunk[],
): Uint8Array {
  if (chunks.length === 0) {
    return new Uint8Array();
  }

  const orderedChunks = chunks.toSorted(
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
