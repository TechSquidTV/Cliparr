export type GifEncodingRuntime = Awaited<
  ReturnType<typeof loadGifEncodingRuntime>
>;

export async function loadGifEncodingRuntime() {
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
