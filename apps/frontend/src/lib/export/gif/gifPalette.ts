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

function appendGifPaletteSample(
  target: Uint8ClampedArray,
  byteOffset: number,
  imageData: ImageData,
  maxPixels: number,
) {
  const source = imageData.data;
  const sourcePixelCount = Math.floor(source.length / 4);
  const availablePixels = Math.floor((target.length - byteOffset) / 4);
  const samplePixelCount = Math.min(
    sourcePixelCount,
    maxPixels,
    availablePixels,
  );

  if (samplePixelCount <= 0) {
    return byteOffset;
  }

  const stride = Math.max(1, Math.floor(sourcePixelCount / samplePixelCount));
  let writtenPixels = 0;
  let nextByteOffset = byteOffset;

  for (
    let sourcePixelIndex = 0;
    sourcePixelIndex < sourcePixelCount && writtenPixels < samplePixelCount;
    sourcePixelIndex += stride
  ) {
    const sourceOffset = sourcePixelIndex * 4;
    target[nextByteOffset] = source[sourceOffset] ?? 0;
    target[nextByteOffset + 1] = source[sourceOffset + 1] ?? 0;
    target[nextByteOffset + 2] = source[sourceOffset + 2] ?? 0;
    target[nextByteOffset + 3] = source[sourceOffset + 3] ?? 255;
    nextByteOffset += 4;
    writtenPixels += 1;
  }

  return nextByteOffset;
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
  gifRuntime: Pick<GifEncodingRuntime, "quantizeGifFrame">;
}): Promise<Palette | null> {
  const sampleFrameIndexes = selectGifPaletteSampleFrameIndexes(frameCount);
  const maxPixelsPerFrame = Math.max(
    1,
    Math.floor(
      GIF_GLOBAL_PALETTE_MAX_SAMPLE_PIXELS / sampleFrameIndexes.length,
    ),
  );
  const sampledPixels = new Uint8ClampedArray(
    GIF_GLOBAL_PALETTE_MAX_SAMPLE_PIXELS * 4,
  );
  let sampleByteOffset = 0;
  let sampledFrameCount = 0;

  for (const frameIndex of sampleFrameIndexes) {
    const imageData = await readFrameImageData(frameIndex);
    sampledFrameCount += 1;

    if (!imageData) {
      onSampleProgress?.(sampledFrameCount, sampleFrameIndexes.length);
      continue;
    }

    sampleByteOffset = appendGifPaletteSample(
      sampledPixels,
      sampleByteOffset,
      imageData,
      maxPixelsPerFrame,
    );
    onSampleProgress?.(sampledFrameCount, sampleFrameIndexes.length);
  }

  if (sampleByteOffset === 0) {
    return null;
  }

  return gifRuntime.quantizeGifFrame(
    sampledPixels.subarray(0, sampleByteOffset),
    maxColors,
    { format: paletteFormat },
  );
}
