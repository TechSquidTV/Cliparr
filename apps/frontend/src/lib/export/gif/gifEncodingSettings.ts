import { createTemporalDither } from "@techsquidtv/gifenc";
import type {
  Format,
  TemporalDitherOptions,
  TemporalDitherState,
} from "@techsquidtv/gifenc";

export type GifPaletteMode = "global" | "per-frame";
export type GifPaletteFormat = Format;
export type GifDitherMode = "none" | "spatial" | "spatial-temporal";

export type GifTemporalDitherSettings = Omit<
  TemporalDitherOptions,
  "width" | "height" | "format"
>;

export interface GifTemporalDitherFrameSettings {
  ditherMode: GifDitherMode;
  height: number;
  paletteFormat: GifPaletteFormat;
  temporalDither?: GifTemporalDitherSettings | null;
  width: number;
}

export function createGifTemporalDitherResolver() {
  let temporalDither: TemporalDitherState | null = null;
  let temporalDitherKey = "";

  return {
    resolve(settings: GifTemporalDitherFrameSettings) {
      if (settings.ditherMode !== "spatial-temporal") {
        temporalDither = null;
        temporalDitherKey = "";
        return null;
      }

      const nextKey = gifTemporalDitherStateKey(settings);

      if (!temporalDither || temporalDitherKey !== nextKey) {
        temporalDither = createTemporalDither({
          width: settings.width,
          height: settings.height,
          format: settings.paletteFormat,
          ...settings.temporalDither,
        });
        temporalDitherKey = nextKey;
      }

      return temporalDither;
    },
  };
}

function gifTemporalDitherStateKey({
  height,
  paletteFormat,
  temporalDither,
  width,
}: GifTemporalDitherFrameSettings) {
  return JSON.stringify({
    height,
    paletteFormat,
    temporalDither: temporalDither ?? null,
    width,
  });
}
