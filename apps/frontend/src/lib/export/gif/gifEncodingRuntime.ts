import type {
  EncodeGifFrameChunkHelpers,
  GifFrameChunk,
} from "#/lib/export/gif/gifFrameChunk";
import type {
  GifFrameEncoder,
  GifFrameEncoderOptions,
} from "#/lib/export/gif/gifFrameEncoder";

export type GifEncodingRuntime = {
  quantizeGifFrame: NonNullable<EncodeGifFrameChunkHelpers["quantizeGifFrame"]>;
  createGifFrameEncoder: (options?: GifFrameEncoderOptions) => GifFrameEncoder;
  concatenateGifFrameChunks: (chunks: readonly GifFrameChunk[]) => Uint8Array;
};

export async function loadGifEncodingRuntime(): Promise<GifEncodingRuntime> {
  const [gifenc, gifFrameEncoder, gifFrameChunk] = await Promise.all([
    import("@techsquidtv/gifenc"),
    import("#/lib/export/gif/gifFrameEncoder"),
    import("#/lib/export/gif/gifFrameChunk"),
  ]);

  return {
    quantizeGifFrame: gifenc.quantize,
    createGifFrameEncoder: gifFrameEncoder.createBestGifFrameEncoder,
    concatenateGifFrameChunks: gifFrameChunk.concatenateGifFrameChunks,
  };
}
