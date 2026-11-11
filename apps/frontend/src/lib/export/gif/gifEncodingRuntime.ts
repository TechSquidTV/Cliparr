import type {
  assembleFrameChunks,
  createPaletteSampler,
  frameDelay,
} from "@techsquidtv/gifenc";

import type { createBestGifFrameEncoder } from "#/lib/export/gif/gifFrameEncoder";

export type GifEncodingRuntime = {
  createPaletteSampler: typeof createPaletteSampler;
  frameDelay: typeof frameDelay;
  assembleFrameChunks: typeof assembleFrameChunks;
  createGifFrameEncoder: typeof createBestGifFrameEncoder;
};

export async function loadGifEncodingRuntime(): Promise<GifEncodingRuntime> {
  const [gifenc, gifFrameEncoder] = await Promise.all([
    import("@techsquidtv/gifenc"),
    import("#/lib/export/gif/gifFrameEncoder"),
  ]);

  return {
    createPaletteSampler: gifenc.createPaletteSampler,
    frameDelay: gifenc.frameDelay,
    assembleFrameChunks: gifenc.assembleFrameChunks,
    createGifFrameEncoder: gifFrameEncoder.createBestGifFrameEncoder,
  };
}
