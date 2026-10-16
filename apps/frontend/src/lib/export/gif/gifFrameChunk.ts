import type {
  ApplyPaletteOptions,
  Palette,
  RGBAInput,
  TemporalDitherState,
} from "@techsquidtv/gifenc";
import { applyPalette, GIFEncoder, quantize } from "@techsquidtv/gifenc";

import type {
  GifDitherMode,
  GifPaletteFormat,
} from "#/lib/export/gif/gifEncodingSettings";

export interface EncodeGifFrameChunkInput {
  sequenceIndex: number;
  rgba: RGBAInput;
  width: number;
  height: number;
  maxColors: number;
  delayMs: number;
  repeat?: number;
  globalPalette?: Palette | null;
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
    globalPalette,
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
    globalPalette ??
    quantizeGifFrame(rgba, maxColors, { format: paletteFormat });
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
  // Only the first independent chunk writes the header and global table.
  const gif = createGifEncoder({ auto: sequenceIndex === 0 });

  gif.writeFrame(indexedPixels, width, height, {
    repeat,
    delay: delayMs,
    // Omitting later palettes lets gifenc reuse the first chunk's global table.
    palette:
      sequenceIndex === 0 || !globalPalette ? resolvedPalette : undefined,
  });

  return {
    sequenceIndex,
    bytes: gif.bytes(),
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
  const gif = GIFEncoder({ auto: false, initialCapacity: byteLength });

  for (const chunk of orderedChunks) {
    gif.stream.writeBytesView(chunk.bytes);
  }

  gif.finish();

  return gif.bytesView();
}
