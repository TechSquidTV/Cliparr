import type {
  FrameChunk,
  Palette,
  PaletteMapper,
  RGBAInput,
  TemporalDitherState,
} from "@techsquidtv/gifenc";
import {
  applyPalette,
  createPaletteMapper,
  createTemporalDitherSequence,
  encodeFrameChunk,
  quantize,
} from "@techsquidtv/gifenc";

import type {
  GifDitherMode,
  GifPaletteFormat,
  GifPaletteMode,
  GifTemporalDitherSettings,
} from "#/lib/export/gif/gifEncodingSettings";

export interface EncodeGifFrameChunkInput {
  sequenceIndex: number;
  rgba: RGBAInput;
  width: number;
  height: number;
  maxColors: number;
  delayMs: number;
  paletteMode: GifPaletteMode;
  globalPalette?: Palette | null;
  paletteFormat: GifPaletteFormat;
  ditherMode: GifDitherMode;
  ditherStrength?: number;
  serpentine?: boolean;
  temporalDither?: GifTemporalDitherSettings | null;
}

// One encoder serves one export with fixed dimensions, settings and global table.
export function createGifFrameChunkEncoder() {
  let mapper: PaletteMapper | undefined;
  const sequence = createTemporalDitherSequence();
  let history: TemporalDitherState | undefined;
  function encode({
    sequenceIndex,
    rgba,
    width,
    height,
    maxColors,
    delayMs,
    globalPalette,
    paletteMode,
    paletteFormat,
    ditherMode,
    ditherStrength,
    serpentine,
    temporalDither,
  }: EncodeGifFrameChunkInput): FrameChunk {
    const useLocalPalette = sequenceIndex > 0 && paletteMode === "per-frame";
    const resolvedPalette =
      globalPalette && !useLocalPalette
        ? globalPalette
        : quantize(rgba, maxColors, { format: paletteFormat });
    if (paletteMode === "global" && ditherMode === "none") {
      mapper ??= createPaletteMapper(resolvedPalette, {
        format: paletteFormat,
      });
    }
    if (ditherMode === "spatial-temporal") {
      history ??= sequence.start({
        width,
        height,
        format: paletteFormat,
        ...temporalDither,
      });
    }
    const indexedPixels = mapper
      ? mapper.map(rgba)
      : applyPalette(rgba, resolvedPalette, {
          format: paletteFormat,
          dither: ditherMode === "none" ? false : "floyd-steinberg",
          ditherStrength,
          height,
          serpentine,
          temporalDither: history,
          width,
        });
    return encodeFrameChunk(indexedPixels, width, height, {
      sequenceIndex,
      globalPalette: globalPalette ?? resolvedPalette,
      palette: useLocalPalette ? resolvedPalette : undefined,
      delay: delayMs,
    });
  }

  return {
    encode,
    dispose() {
      sequence.end();
      history = undefined;
      mapper = undefined;
    },
  };
}
