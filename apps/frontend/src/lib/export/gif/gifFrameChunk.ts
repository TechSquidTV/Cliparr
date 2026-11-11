import type { FrameChunk, Palette } from "@techsquidtv/gifenc";
import {
  applyPalette,
  createPaletteMapper,
  createTemporalDitherSequence,
  encodeFrameChunk,
  quantize,
} from "@techsquidtv/gifenc";

import type { GifEncodingSettings } from "#/lib/export/gif/gifEncodingSettings";
import type { PixelDimensions } from "#/lib/mediaDimensions";

export interface GifEncoderJob extends GifEncodingSettings, PixelDimensions {
  globalPalette: Palette | null;
}

export interface GifFrameInput {
  sequenceIndex: number;
  rgba: Uint8ClampedArray;
  delayMs: number;
}

export function createGifFrameChunkEncoder({
  width,
  height,
  maxColors,
  globalPalette: initialPalette,
  paletteMode,
  paletteFormat,
  ditherMode,
  ditherStrength,
  serpentine,
  temporalDither,
}: GifEncoderJob) {
  let globalPalette = initialPalette;
  const mapper =
    globalPalette && paletteMode === "global" && ditherMode === "none"
      ? createPaletteMapper(globalPalette, { format: paletteFormat })
      : null;
  const sequence = createTemporalDitherSequence();
  const paletteOptions = {
    format: paletteFormat,
    width,
    height,
    dither: ditherMode !== "none",
    ditherStrength,
    serpentine,
    temporalDither:
      ditherMode === "spatial-temporal"
        ? sequence.start({
            width,
            height,
            format: paletteFormat,
            ...temporalDither,
          })
        : null,
  };
  return {
    encode({ sequenceIndex, rgba, delayMs }: GifFrameInput): FrameChunk {
      const useLocalPalette = sequenceIndex > 0 && paletteMode === "per-frame";
      const palette =
        globalPalette && !useLocalPalette
          ? globalPalette
          : quantize(rgba, maxColors, { format: paletteFormat });
      globalPalette ??= palette;
      const indexed = mapper
        ? mapper.map(rgba)
        : applyPalette(rgba, palette, paletteOptions);
      return encodeFrameChunk(indexed, width, height, {
        sequenceIndex,
        globalPalette,
        palette: useLocalPalette ? palette : undefined,
        delay: delayMs,
      });
    },
    dispose() {
      sequence.end();
    },
  };
}
