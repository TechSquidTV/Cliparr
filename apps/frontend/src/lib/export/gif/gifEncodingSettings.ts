import type {
  ApplyPaletteOptions,
  Format,
  TemporalDitherOptions,
} from "@techsquidtv/gifenc";

export interface GifEncodingSettings extends Pick<
  ApplyPaletteOptions,
  "ditherStrength" | "serpentine"
> {
  maxColors: number;
  paletteMode: "global" | "per-frame";
  paletteFormat: Format;
  ditherMode: "none" | "spatial" | "spatial-temporal";
  temporalDither?: Omit<
    TemporalDitherOptions,
    "width" | "height" | "format" | "decay" | "maxError"
  > | null;
}
