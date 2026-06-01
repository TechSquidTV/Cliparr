declare module "gifenc" {
  export type GifPalette = Array<[number, number, number]>;

  export interface GifEncoderWriteFrameOptions {
    colorDepth?: number;
    delay?: number;
    dispose?: number;
    first?: boolean;
    palette?: GifPalette;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
  }

  export interface GifEncoder {
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    finish(): void;
    reset(): void;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: GifEncoderWriteFrameOptions,
    ): void;
  }

  export function GIFEncoder(options?: {
    auto?: boolean;
    initialCapacity?: number;
  }): GifEncoder;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: {
      clearAlpha?: boolean;
      clearAlphaColor?: number;
      clearAlphaThreshold?: number;
      format?: "rgb565" | "rgb444" | "rgba4444";
      oneBitAlpha?: boolean | number;
    },
  ): GifPalette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;
}

declare module "gifenc/dist/gifenc.esm.js" {
  export {
    GIFEncoder,
    applyPalette,
    quantize,
    type GifEncoder,
    type GifEncoderWriteFrameOptions,
    type GifPalette,
  } from "gifenc";
}
