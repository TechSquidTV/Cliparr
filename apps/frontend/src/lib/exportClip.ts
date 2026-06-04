import type { Palette, quantize } from "@techsquidtv/gifenc";
import {
  BufferTarget,
  CanvasSink,
  Conversion,
  MkvOutputFormat,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  WebMOutputFormat,
} from "mediabunny";
import type {
  CanvasSinkOptions,
  ConversionOptions,
  InputVideoTrack,
  VideoSample,
} from "mediabunny";
import type { EditorMediaSource } from "@/lib/editorMedia";
import { createCliparrInputFromSource } from "@/lib/mediabunnyInput";
import { ensureMediabunnyCodecs } from "@/lib/mediabunnyCodecs";
import {
  getTrackTimelineOffsetSeconds,
  getVideoTrackDimensions,
  toSourceTimelineTime,
} from "@/lib/mediabunnyTrackAccess";
import { selectPreferredPairableAudioTrack } from "@/lib/selectPreferredAudioTrack";
import type {
  MediaExportMetadata,
  PlaybackAudioSelection,
} from "@/providers/types";
import {
  buildMetadataTags,
  describeDiscardedTracks,
  isIsobmffExportFormat,
  patchMp4MetadataBoxes,
} from "@/lib/exportMetadata";
import {
  DEFAULT_GIF_EXPORT_PRESET,
  DEFAULT_VIDEO_EXPORT_QUALITY,
  exportFormatDurationDisabledReason,
  gifExportSettingsForPreset,
  resolveExportOutputDimensions,
  type ExportFormat,
  type ExportResolution,
  type GifExportSettings,
  type VideoExportQualityPreset,
} from "@/lib/exportTypes";
import type {
  concatenateGifFrameChunks,
  GifFrameChunk,
} from "@/lib/gifFrameChunk";
import type { createBestGifFrameEncoder } from "@/lib/gifFrameEncoder";
import { getActiveSubtitleCue } from "@/lib/subtitles/getActiveSubtitleCue";
import { renderSubtitleCue } from "@/lib/subtitles/renderSubtitleCue";
import { trimSubtitleCues } from "@/lib/subtitles/trimSubtitleCues";
import type { SubtitleCue, SubtitleStyleSettings } from "@/lib/subtitles/types";

export type { ExportFormat, ExportResolution } from "@/lib/exportTypes";

interface ExportClipOptions {
  mediaSource: EditorMediaSource;
  hls?: boolean;
  startTime: number;
  endTime: number;
  format: ExportFormat;
  resolution: ExportResolution;
  gifSettings?: GifExportSettings;
  videoQuality?: VideoExportQualityPreset;
  includeAudio: boolean;
  selectedAudioTrack?: PlaybackAudioSelection;
  metadata?: MediaExportMetadata;
  includeBurnedSubtitles?: boolean;
  subtitleCues?: readonly SubtitleCue[];
  subtitleStyleSettings?: SubtitleStyleSettings;
  onProgress: (progress: number) => void;
}

interface ExportClipRuntime {
  ensureMediabunnyCodecs: typeof ensureMediabunnyCodecs;
  createCliparrInputFromSource: typeof createCliparrInputFromSource;
  selectPreferredPairableAudioTrack: typeof selectPreferredPairableAudioTrack;
  getTrackTimelineOffsetSeconds: typeof getTrackTimelineOffsetSeconds;
  getVideoTrackDimensions: typeof getVideoTrackDimensions;
  buildMetadataTags: typeof buildMetadataTags;
  describeDiscardedTracks: typeof describeDiscardedTracks;
  patchMp4MetadataBoxes: typeof patchMp4MetadataBoxes;
  createOutputFormat: typeof createOutputFormat;
  createBufferTarget: () => BufferTarget;
  createOutput: (options: ConstructorParameters<typeof Output>[0]) => Output;
  createCanvasSink: (
    track: InputVideoTrack,
    options: CanvasSinkOptions,
  ) => CanvasSink;
  createGifCanvas: typeof createGifCanvas;
  loadGifEncodingRuntime: () => Promise<GifEncodingRuntime>;
  getActiveSubtitleCue: typeof getActiveSubtitleCue;
  renderSubtitleCue: typeof renderSubtitleCue;
  initConversion: typeof Conversion.init;
  buildSubtitleBurnInProcessor: typeof buildSubtitleBurnInProcessor;
}

interface GifCanvasResources {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}

type GifPalette = Palette;
type GifEncodingRuntime = {
  quantizeGifFrame: typeof quantize;
  createGifFrameEncoder: typeof createBestGifFrameEncoder;
  concatenateGifFrameChunks: typeof concatenateGifFrameChunks;
};

const GIF_GLOBAL_PALETTE_SAMPLE_FRAME_LIMIT = 24;
const GIF_GLOBAL_PALETTE_MAX_SAMPLE_PIXELS = 120_000;

function createOutputFormat(format: ExportFormat) {
  switch (format) {
    case "mp4":
      return new Mp4OutputFormat({ fastStart: "in-memory" });
    case "webm":
      return new WebMOutputFormat();
    case "mov":
      return new MovOutputFormat({ fastStart: "in-memory" });
    case "mkv":
      return new MkvOutputFormat();
    case "gif":
      throw new Error("GIF export uses a dedicated encoder.");
  }
}

function createGifCanvas(width: number, height: number): GifCanvasResources {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a GIF rendering canvas.");
  }

  return { canvas, context };
}

function configureGifCanvasContext(context: CanvasRenderingContext2D) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
}

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

async function buildGifGlobalPalette({
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
}): Promise<GifPalette | null> {
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

function buildSubtitleBurnInProcessor(
  cues: readonly SubtitleCue[],
  styleSettings: SubtitleStyleSettings,
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a subtitle rendering canvas.");
  }

  return (sample: VideoSample) => {
    const width = Math.max(1, sample.displayWidth);
    const height = Math.max(1, sample.displayHeight);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.clearRect(0, 0, width, height);
    sample.draw(context, 0, 0, width, height);

    const activeCue = getActiveSubtitleCue(cues, sample.timestamp);
    if (activeCue) {
      renderSubtitleCue(context, activeCue, styleSettings, width, height);
    }

    return canvas;
  };
}

export async function exportClip({
  mediaSource,
  hls,
  startTime,
  endTime,
  format,
  resolution,
  gifSettings,
  videoQuality,
  includeAudio,
  selectedAudioTrack,
  metadata,
  includeBurnedSubtitles = false,
  subtitleCues = [],
  subtitleStyleSettings,
  onProgress,
}: ExportClipOptions) {
  return exportClipWithRuntime(
    {
      mediaSource,
      hls,
      startTime,
      endTime,
      format,
      resolution,
      gifSettings,
      videoQuality,
      includeAudio,
      selectedAudioTrack,
      metadata,
      includeBurnedSubtitles,
      subtitleCues,
      subtitleStyleSettings,
      onProgress,
    },
    defaultExportClipRuntime,
  );
}

const defaultExportClipRuntime: ExportClipRuntime = {
  ensureMediabunnyCodecs,
  createCliparrInputFromSource,
  selectPreferredPairableAudioTrack,
  getTrackTimelineOffsetSeconds,
  getVideoTrackDimensions,
  buildMetadataTags,
  describeDiscardedTracks,
  patchMp4MetadataBoxes,
  createOutputFormat,
  createBufferTarget: () => new BufferTarget(),
  createOutput: (options) => new Output(options),
  createCanvasSink: (track, options) => new CanvasSink(track, options),
  createGifCanvas,
  loadGifEncodingRuntime,
  getActiveSubtitleCue,
  renderSubtitleCue,
  initConversion: (options) => Conversion.init(options),
  buildSubtitleBurnInProcessor,
};

export async function exportClipWithRuntime(
  {
    mediaSource,
    hls,
    startTime,
    endTime,
    format,
    resolution,
    gifSettings,
    videoQuality,
    includeAudio,
    selectedAudioTrack,
    metadata,
    includeBurnedSubtitles = false,
    subtitleCues = [],
    subtitleStyleSettings,
    onProgress,
  }: ExportClipOptions,
  runtime: ExportClipRuntime,
) {
  const options = {
    mediaSource,
    hls,
    startTime,
    endTime,
    format,
    resolution,
    gifSettings,
    videoQuality,
    includeAudio,
    selectedAudioTrack,
    metadata,
    includeBurnedSubtitles,
    subtitleCues,
    subtitleStyleSettings,
    onProgress,
  };

  if (format === "gif") {
    return exportGifClipWithRuntime(options, runtime);
  }

  await runtime.ensureMediabunnyCodecs();

  const input = await runtime.createCliparrInputFromSource(mediaSource, {
    hls,
  });

  try {
    const sourceVideoTrack = await input.getPrimaryVideoTrack({
      filter: async (track) => !(await track.hasOnlyKeyPackets()),
    });
    const sourceAudioTracks = await input.getAudioTracks();
    const preferredAudioTrack = await runtime.selectPreferredPairableAudioTrack(
      sourceVideoTrack,
      sourceAudioTracks,
      selectedAudioTrack,
    );
    const sourceHasAudio = sourceAudioTracks.length > 0;

    const timelineOffsetSeconds = await runtime.getTrackTimelineOffsetSeconds([
      sourceVideoTrack,
      includeAudio ? preferredAudioTrack : undefined,
    ]);
    const trimStart = toSourceTimelineTime(startTime, timelineOffsetSeconds);
    const trimEnd = toSourceTimelineTime(endTime, timelineOffsetSeconds);

    const sourceVideoDimensions = sourceVideoTrack
      ? await runtime.getVideoTrackDimensions(sourceVideoTrack)
      : null;
    const outputDimensions = resolveExportOutputDimensions(
      sourceVideoDimensions,
      resolution,
      format,
    );
    const outputHeight = outputDimensions?.height;
    const clippedSubtitleCues =
      includeBurnedSubtitles && subtitleCues.length > 0
        ? trimSubtitleCues(subtitleCues, startTime, endTime)
        : [];
    const shouldBurnSubtitles = clippedSubtitleCues.length > 0;

    if (includeBurnedSubtitles && !subtitleStyleSettings) {
      throw new Error("Subtitle burn-in was requested without style settings.");
    }

    if (includeBurnedSubtitles && !sourceVideoTrack) {
      throw new Error("Subtitle burn-in requires a video track.");
    }

    const outputFormat = runtime.createOutputFormat(format);
    const target = runtime.createBufferTarget();
    const metadataTags = await runtime.buildMetadataTags(
      metadata,
      startTime,
      endTime,
      outputHeight,
      format,
    );
    const output = runtime.createOutput({
      format: outputFormat,
      target,
    });

    const baseAudioOptions = {
      // Let Mediabunny choose the first encodable codec supported by the
      // target container instead of forcing AAC for every export format.
      forceTranscode: true,
      numberOfChannels: 2,
      bitrate: 160_000,
    } as const;

    const conversionOptions: ConversionOptions = {
      input,
      output,
      audio: includeAudio
        ? preferredAudioTrack
          ? (track) => ({
              ...baseAudioOptions,
              discard: track.id !== preferredAudioTrack.id,
            })
          : baseAudioOptions
        : {
            discard: true,
          },
      trim: {
        start: trimStart,
        end: trimEnd,
      },
      showWarnings: false,
    };

    if (metadataTags) {
      conversionOptions.tags = metadataTags;
    }

    const videoQualityOptions = videoQualityConversionOptions(videoQuality);

    if (sourceVideoTrack) {
      conversionOptions.video = (track) => ({
        discard: track.id !== sourceVideoTrack.id,
        ...videoQualityOptions,
        ...(resolution !== "original"
          ? {
              height: parseInt(resolution, 10),
              fit: "contain" as const,
            }
          : {}),
        ...(shouldBurnSubtitles && subtitleStyleSettings
          ? {
              forceTranscode: true,
              process: runtime.buildSubtitleBurnInProcessor(
                clippedSubtitleCues,
                subtitleStyleSettings,
              ),
            }
          : {}),
      });
    } else if (resolution !== "original") {
      conversionOptions.video = {
        ...videoQualityOptions,
        height: parseInt(resolution, 10),
        fit: "contain",
      };
    }

    const conversion = await runtime.initConversion(conversionOptions);
    const utilizedAudioTracks = conversion.utilizedTracks.filter((track) =>
      track.isAudioTrack(),
    );

    if (!conversion.isValid) {
      const discardedDetails = await runtime.describeDiscardedTracks(
        conversion.discardedTracks,
      );
      const suffix = discardedDetails ? ` ${discardedDetails}` : "";
      throw new Error(`Conversion is invalid.${suffix}`);
    }

    if (includeAudio && sourceHasAudio && utilizedAudioTracks.length === 0) {
      const discardedDetails = await runtime.describeDiscardedTracks(
        conversion.discardedTracks,
      );
      const suffix = discardedDetails
        ? ` ${discardedDetails}`
        : " Mediabunny did not report a discarded-track reason.";
      throw new Error(`Export would drop the source audio track.${suffix}`);
    }

    conversion.onProgress = (progress) => onProgress(progress);

    await conversion.execute();

    if (!target.buffer) {
      throw new Error("Export did not produce a video buffer");
    }

    if (isIsobmffExportFormat(format)) {
      runtime.patchMp4MetadataBoxes(new Uint8Array(target.buffer));
    }

    // Conversion.init already proved that at least one audio track made it into the
    // output plan; reparsing the completed file adds memory pressure for long exports.
    const blob = new Blob([target.buffer], { type: outputFormat.mimeType });

    return blob;
  } finally {
    input.dispose();
  }
}

function videoQualityConversionOptions(
  videoQuality: VideoExportQualityPreset = DEFAULT_VIDEO_EXPORT_QUALITY,
) {
  switch (videoQuality) {
    case "compact":
      return {
        forceTranscode: true,
        bitrate: QUALITY_LOW,
      } as const;
    case "balanced":
      return {
        forceTranscode: true,
        bitrate: QUALITY_MEDIUM,
      } as const;
    case "sharp":
      return {};
  }
}

async function exportGifClipWithRuntime(
  {
    mediaSource,
    hls,
    startTime,
    endTime,
    resolution,
    gifSettings,
    includeBurnedSubtitles = false,
    subtitleCues = [],
    subtitleStyleSettings,
    onProgress,
  }: ExportClipOptions,
  runtime: ExportClipRuntime,
) {
  const durationDisabledReason = exportFormatDurationDisabledReason(
    "gif",
    startTime,
    endTime,
  );
  if (durationDisabledReason) {
    throw new Error(durationDisabledReason);
  }

  await runtime.ensureMediabunnyCodecs();
  const resolvedGifSettings =
    gifSettings ?? gifExportSettingsForPreset(DEFAULT_GIF_EXPORT_PRESET);

  const input = await runtime.createCliparrInputFromSource(mediaSource, {
    hls,
  });

  try {
    const sourceVideoTrack = await input.getPrimaryVideoTrack({
      filter: async (track) => !(await track.hasOnlyKeyPackets()),
    });

    if (!sourceVideoTrack) {
      throw new Error("GIF export requires a video track.");
    }

    if (includeBurnedSubtitles && !subtitleStyleSettings) {
      throw new Error("Subtitle burn-in was requested without style settings.");
    }

    const sourceVideoDimensions =
      await runtime.getVideoTrackDimensions(sourceVideoTrack);
    const outputDimensions = resolveExportOutputDimensions(
      sourceVideoDimensions,
      resolution,
      "gif",
      resolvedGifSettings,
    );
    if (!outputDimensions) {
      throw new Error("GIF export could not determine the video dimensions.");
    }

    const gifRuntime = await runtime.loadGifEncodingRuntime();
    const timelineOffsetSeconds = await runtime.getTrackTimelineOffsetSeconds([
      sourceVideoTrack,
    ]);
    const trimStart = toSourceTimelineTime(startTime, timelineOffsetSeconds);
    const trimEnd = toSourceTimelineTime(endTime, timelineOffsetSeconds);
    const clippedSubtitleCues =
      includeBurnedSubtitles && subtitleCues.length > 0
        ? trimSubtitleCues(subtitleCues, startTime, endTime)
        : [];
    const shouldBurnSubtitles = clippedSubtitleCues.length > 0;
    const frameCount = Math.max(
      1,
      Math.ceil((endTime - startTime) * resolvedGifSettings.frameRate),
    );
    const frameDelayMs = 1000 / resolvedGifSettings.frameRate;
    const videoSink = runtime.createCanvasSink(sourceVideoTrack, {
      poolSize: 2,
      fit: "contain",
      alpha: await sourceVideoTrack.canBeTransparent(),
      height: outputDimensions.height,
    });
    const { context } = runtime.createGifCanvas(
      outputDimensions.width,
      outputDimensions.height,
    );
    configureGifCanvasContext(context);
    let encodedFrameCount = 0;
    const paletteProgressShare =
      resolvedGifSettings.paletteMode === "global" ? 0.12 : 0;

    const readRenderedFrameImageData = async (frameIndex: number) => {
      const clipTimestamp = frameIndex / resolvedGifSettings.frameRate;
      const displayTimestamp = startTime + clipTimestamp;
      const sourceTimestamp = Math.min(trimEnd, trimStart + clipTimestamp);
      const frame = await videoSink.getCanvas(sourceTimestamp);

      if (!frame) {
        return null;
      }

      context.clearRect(0, 0, outputDimensions.width, outputDimensions.height);
      context.drawImage(
        frame.canvas,
        0,
        0,
        outputDimensions.width,
        outputDimensions.height,
      );

      if (shouldBurnSubtitles && subtitleStyleSettings) {
        const activeCue = runtime.getActiveSubtitleCue(
          clippedSubtitleCues,
          displayTimestamp - startTime,
        );

        if (activeCue) {
          runtime.renderSubtitleCue(
            context,
            activeCue,
            subtitleStyleSettings,
            outputDimensions.width,
            outputDimensions.height,
          );
        }
      }

      return context.getImageData(
        0,
        0,
        outputDimensions.width,
        outputDimensions.height,
      );
    };

    const globalPalette =
      resolvedGifSettings.paletteMode === "global"
        ? await buildGifGlobalPalette({
            frameCount,
            maxColors: resolvedGifSettings.maxColors,
            paletteFormat: resolvedGifSettings.paletteFormat,
            onSampleProgress: (sampledFrames, totalSampleFrames) => {
              onProgress(
                (sampledFrames / totalSampleFrames) * paletteProgressShare,
              );
            },
            readFrameImageData: readRenderedFrameImageData,
            gifRuntime,
          })
        : null;

    const requiresSequentialFrameEncoding =
      resolvedGifSettings.ditherMode === "spatial-temporal";
    const frameEncoder = gifRuntime.createGifFrameEncoder({
      requiresSequentialFrames: requiresSequentialFrameEncoding,
    });
    const gifChunks: GifFrameChunk[] = [];
    const inFlightFrames = new Set<Promise<void>>();
    let processedFrameCount = 0;
    let frameEncodingError: Error | null = null;
    const maxInFlightFrames = requiresSequentialFrameEncoding
      ? 1
      : Math.max(1, frameEncoder.concurrency * 2);

    const reportFrameProgress = () => {
      onProgress(
        paletteProgressShare +
          (processedFrameCount / frameCount) * (1 - paletteProgressShare),
      );
    };

    const enqueueFrame = (imageData: ImageData) => {
      const sequenceIndex = encodedFrameCount;
      encodedFrameCount += 1;

      const framePromise = frameEncoder
        .encodeFrame({
          sequenceIndex,
          imageData,
          width: outputDimensions.width,
          height: outputDimensions.height,
          maxColors: resolvedGifSettings.maxColors,
          delayMs: frameDelayMs,
          palette: globalPalette,
          paletteFormat: resolvedGifSettings.paletteFormat,
          ditherMode: resolvedGifSettings.ditherMode,
          ditherStrength: resolvedGifSettings.ditherStrength,
          serpentine: resolvedGifSettings.serpentine,
          temporalDither: resolvedGifSettings.temporalDither,
        })
        .then((chunk) => {
          gifChunks[chunk.sequenceIndex] = chunk;
          processedFrameCount += 1;
          reportFrameProgress();
        })
        .catch((error: unknown) => {
          frameEncodingError ??= toGifFrameEncodingError(error);
        })
        .finally(() => {
          inFlightFrames.delete(framePromise);
        });

      inFlightFrames.add(framePromise);
    };

    const waitForFrameEncoderSlot = async () => {
      while (inFlightFrames.size >= maxInFlightFrames) {
        await Promise.race(inFlightFrames);
        if (frameEncodingError) {
          throwGifFrameEncodingError(frameEncodingError);
        }
      }
    };

    try {
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const imageData = await readRenderedFrameImageData(frameIndex);

        if (!imageData) {
          processedFrameCount += 1;
          reportFrameProgress();
          continue;
        }

        enqueueFrame(imageData);
        await waitForFrameEncoderSlot();
      }

      await Promise.all(inFlightFrames);
      const settledFrameEncodingError = frameEncodingError;
      if (settledFrameEncodingError) {
        throwGifFrameEncodingError(settledFrameEncodingError);
      }
    } finally {
      frameEncoder.dispose();
    }

    if (encodedFrameCount === 0) {
      throw new Error("GIF export did not produce any frames.");
    }

    const bytes = gifRuntime.concatenateGifFrameChunks(gifChunks);
    if (bytes.length === 0) {
      throw new Error("GIF export did not produce an image buffer.");
    }

    return new Blob([copyToArrayBuffer(bytes)], { type: "image/gif" });
  } finally {
    input.dispose();
  }
}

function toGifFrameEncodingError(error: unknown) {
  return error instanceof Error
    ? error
    : new Error("GIF frame encoding failed.");
}

function throwGifFrameEncodingError(error: Error): never {
  throw new Error(error.message, { cause: error });
}

function copyToArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  return buffer;
}

async function loadGifEncodingRuntime(): Promise<GifEncodingRuntime> {
  const [gifenc, gifFrameEncoder, gifFrameChunk] = await Promise.all([
    import("@techsquidtv/gifenc"),
    import("@/lib/gifFrameEncoder"),
    import("@/lib/gifFrameChunk"),
  ]);

  return {
    quantizeGifFrame: gifenc.quantize,
    createGifFrameEncoder: gifFrameEncoder.createBestGifFrameEncoder,
    concatenateGifFrameChunks: gifFrameChunk.concatenateGifFrameChunks,
  };
}
