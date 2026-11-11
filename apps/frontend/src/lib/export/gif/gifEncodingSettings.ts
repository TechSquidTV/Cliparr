import type { Format, TemporalDitherOptions } from "@techsquidtv/gifenc";

export type GifPaletteMode = "global" | "per-frame";
export type GifPaletteFormat = Format;
export type GifDitherMode = "none" | "spatial" | "spatial-temporal";

export type GifTemporalDitherSettings = Omit<
  TemporalDitherOptions,
  "width" | "height" | "format" | "decay" | "maxError"
>;
