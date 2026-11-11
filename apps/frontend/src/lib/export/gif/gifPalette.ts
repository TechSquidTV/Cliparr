import type { Palette } from "@techsquidtv/gifenc";

import type { GifExportSettings } from "#/lib/export/exportTypes";
import type { GifEncodingRuntime } from "#/lib/export/gif/gifEncodingRuntime";

const GIF_GLOBAL_PALETTE_SAMPLE_FRAME_LIMIT = 24;
const GIF_GLOBAL_PALETTE_MAX_SAMPLE_PIXELS = 120_000;

function selectGifPaletteSampleFrameIndexes(frameCount: number) {
  if (frameCount <= GIF_GLOBAL_PALETTE_SAMPLE_FRAME_LIMIT) {
    return Array.from({ length: frameCount }, (_value, index) => index);
  }

  const lastFrameIndex = frameCount - 1;
  return Array.from(
    { length: GIF_GLOBAL_PALETTE_SAMPLE_FRAME_LIMIT },
    (_value, sampleIndex) =>
      Math.round(
        (sampleIndex * lastFrameIndex) /
          (GIF_GLOBAL_PALETTE_SAMPLE_FRAME_LIMIT - 1),
      ),
  );
}

export async function buildGifGlobalPalette({
  frameCount,
  maxColors,
  paletteFormat,
  onSampleProgress,
  readFrameImageData,
  gifRuntime,
}: {
  frameCount: number;
  maxColors: number;
  paletteFormat: GifExportSettings["paletteFormat"];
  onSampleProgress?: (sampledFrames: number, totalSampleFrames: number) => void;
  readFrameImageData: (frameIndex: number) => Promise<ImageData | null>;
  gifRuntime: Pick<GifEncodingRuntime, "createPaletteSampler">;
}): Promise<Palette | null> {
  const sampleFrameIndexes = selectGifPaletteSampleFrameIndexes(frameCount);
  const maxPixelsPerFrame = Math.max(
    1,
    Math.floor(
      GIF_GLOBAL_PALETTE_MAX_SAMPLE_PIXELS / sampleFrameIndexes.length,
    ),
  );
  const sampler = gifRuntime.createPaletteSampler(
    GIF_GLOBAL_PALETTE_MAX_SAMPLE_PIXELS,
    maxPixelsPerFrame,
  );
  for (const [index, frameIndex] of sampleFrameIndexes.entries()) {
    const imageData = await readFrameImageData(frameIndex);
    sampler.addFrame(imageData?.data);
    onSampleProgress?.(index + 1, sampleFrameIndexes.length);
  }

  const palette = sampler.quantize(maxColors, { format: paletteFormat });
  return palette.length > 0 ? palette : null;
}
