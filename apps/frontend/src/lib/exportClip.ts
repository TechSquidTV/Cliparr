import type { Palette } from "@techsquidtv/gifenc";
import {
  BufferTarget,
  CanvasSink,
  Conversion,
  MkvOutputFormat,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeAudio as canEncodeAudioWithBrowser,
  canEncodeVideo as canEncodeVideoWithBrowser,
} from "mediabunny";
import type {
  CanvasSinkOptions,
  ConversionOptions,
  InputVideoTrack,
  VideoCodec,
  VideoSample,
} from "mediabunny";
import {
  exportAudioCodecPriorities,
  EXPORT_AUDIO_BITRATE_BPS,
  resolveVideoEncodingPlan,
  type ExportVideoCodec,
  type VideoEncodingPlan,
} from "#/lib/exportEncodingPolicy";
import type { EditorMediaSource } from "#/lib/editorMedia";
import { createCliparrInputFromSource } from "#/lib/mediabunnyInput";
import { ensureMediabunnyCodecs } from "#/lib/mediabunnyCodecs";
import {
  assessVideoTrackDecodability,
  getTrackTimelineOffsetSeconds,
  getVideoTrackDimensions,
  isPlaybackVideoTrack,
  toSourceTimelineTime,
  videoTrackExportUnsupportedMessage,
  type VideoTrackDecodabilityAssessment,
} from "#/lib/mediabunnyTrackAccess";
import { selectPreferredPairableAudioTrack } from "#/lib/selectPreferredAudioTrack";
import type {
  MediaExportMetadata,
  PlaybackAudioSelection,
} from "#/providers/types";
import { normalizeExportVideoCodec } from "@cliparr/shared/providers";
import {
  buildMetadataTags,
  describeDiscardedTracks,
  isIsobmffExportFormat,
  patchMp4MetadataBoxes,
} from "#/lib/exportMetadata";
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
} from "#/lib/exportTypes";
import type {
  EncodeGifFrameChunkHelpers,
  GifFrameChunk,
} from "#/lib/gifFrameChunk";
import type {
  GifFrameEncoder,
  GifFrameEncoderOptions,
} from "#/lib/gifFrameEncoder";
import { getActiveSubtitleCues } from "#/lib/subtitles/getActiveSubtitleCue";
import { renderSubtitleCues } from "#/lib/subtitles/renderSubtitleCue";
import { trimSubtitleCues } from "#/lib/subtitles/trimSubtitleCues";
import type { SubtitleCue, SubtitleStyleSettings } from "#/lib/subtitles/types";

export type { ExportFormat, ExportResolution } from "#/lib/exportTypes";

export type ExportPhase = "preparing" | "encoding" | "finalizing";

export interface ExportClipOptions {
  signal?: AbortSignal;
  onPhaseChange?: (phase: ExportPhase) => void;
  mediaSource: EditorMediaSource;
  hls?: boolean;
  /** Timestamp origin captured when this source was opened in the editor. */
  timelineOffsetSeconds?: number;
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
  onVideoEncodingPlan?: (plan: ExportVideoEncodingPlan) => void;
  onProgress: (progress: number) => void;
}

export interface ExportVideoEncodingPlan {
  bitrateBps: number | null;
  codec: string | null;
  mode: "copy" | "gif" | "transcode";
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
  getActiveSubtitleCues: typeof getActiveSubtitleCues;
  renderSubtitleCues: typeof renderSubtitleCues;
  initConversion: typeof Conversion.init;
  canEncodeVideo: typeof canEncodeVideoWithBrowser;
  canEncodeAudio: typeof canEncodeAudioWithBrowser;
  buildSubtitleBurnInProcessor: typeof buildSubtitleBurnInProcessor;
}

interface GifCanvasResources {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}

type GifPalette = Palette;
type GifEncodingRuntime = {
  quantizeGifFrame: NonNullable<EncodeGifFrameChunkHelpers["quantizeGifFrame"]>;
  createGifFrameEncoder: (options?: GifFrameEncoderOptions) => GifFrameEncoder;
  concatenateGifFrameChunks: (chunks: readonly GifFrameChunk[]) => Uint8Array;
};

const GIF_GLOBAL_PALETTE_SAMPLE_FRAME_LIMIT = 24;
const GIF_GLOBAL_PALETTE_MAX_SAMPLE_PIXELS = 120_000;

function createOutputFormat(format: ExportFormat) {
  switch (format) {
    case "mp4": {
      return new Mp4OutputFormat({ fastStart: "in-memory" });
    }
    case "webm": {
      return new WebMOutputFormat();
    }
    case "mov": {
      return new MovOutputFormat({ fastStart: "in-memory" });
    }
    case "mkv": {
      return new MkvOutputFormat();
    }
    case "gif": {
      throw new Error("GIF export uses a dedicated encoder.");
    }
  }
}

export function createGifCanvas(
  width: number,
  height: number,
): GifCanvasResources {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Could not create a GIF rendering canvas.");
  }

  return { canvas, context };
}

function configureGifCanvasContext(context: CanvasRenderingContext2D) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
}

function assertVideoTrackDecodableForExport(
  decodability: VideoTrackDecodabilityAssessment,
) {
  if (decodability.codec === null || !decodability.canDecode) {
    throw new Error(videoTrackExportUnsupportedMessage(decodability));
  }
}

async function videoExportRequiresSourceDecode({
  track,
  sourceVideoDimensions,
  outputDimensions,
  outputFormat,
  videoQualityOptions,
  trimStart,
  shouldBurnSubtitles,
  decodability,
}: {
  track: InputVideoTrack;
  sourceVideoDimensions: { width: number; height: number } | null;
  outputDimensions: { width: number; height: number } | null;
  outputFormat: ReturnType<typeof createOutputFormat>;
  videoQualityOptions: VideoQualityConversionOptions;
  trimStart: number;
  shouldBurnSubtitles: boolean;
  decodability: VideoTrackDecodabilityAssessment;
}) {
  if (
    videoQualityOptions.forceTranscode ||
    videoQualityOptions.bitrate !== undefined ||
    shouldBurnSubtitles
  ) {
    return true;
  }

  if (
    decodability.codec === null ||
    !outputFormat.getSupportedVideoCodecs().includes(decodability.codec)
  ) {
    return true;
  }

  if (
    sourceVideoDimensions &&
    outputDimensions &&
    (sourceVideoDimensions.width !== outputDimensions.width ||
      sourceVideoDimensions.height !== outputDimensions.height)
  ) {
    return true;
  }

  return (await track.getFirstTimestamp()) < trimStart;
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

    const activeCues = getActiveSubtitleCues(cues, sample.timestamp);
    if (activeCues.length > 0) {
      renderSubtitleCues(context, activeCues, styleSettings, width, height);
    }

    return canvas;
  };
}

export async function exportClip(options: ExportClipOptions) {
  return exportClipWithRuntime(options, defaultExportClipRuntime);
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
  getActiveSubtitleCues,
  renderSubtitleCues,
  initConversion: (options) => Conversion.init(options),
  canEncodeVideo: canEncodeVideoWithBrowser,
  canEncodeAudio: canEncodeAudioWithBrowser,
  buildSubtitleBurnInProcessor,
};

export async function exportClipWithRuntime(
  {
    signal,
    onPhaseChange,
    mediaSource,
    hls,
    timelineOffsetSeconds,
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
    onVideoEncodingPlan,
    onProgress,
  }: ExportClipOptions,
  runtime: ExportClipRuntime,
) {
  const options = {
    signal,
    onPhaseChange,
    mediaSource,
    hls,
    timelineOffsetSeconds,
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
    onVideoEncodingPlan,
    onProgress,
  };

  signal?.throwIfAborted();
  onPhaseChange?.("preparing");

  if (format === "gif") {
    onVideoEncodingPlan?.({ bitrateBps: null, codec: null, mode: "gif" });
    return exportGifClipWithRuntime(options, runtime);
  }

  await runtime.ensureMediabunnyCodecs();

  signal?.throwIfAborted();
  const input = await runtime.createCliparrInputFromSource(mediaSource, {
    hls,
  });

  const disposeOnAbort = () => input.dispose();
  signal?.addEventListener("abort", disposeOnAbort, { once: true });

  try {
    signal?.throwIfAborted();
    const sourceVideoTrack = await input.getPrimaryVideoTrack({
      filter: isPlaybackVideoTrack,
    });

    const sourceAudioTracks = await input.getAudioTracks();
    const preferredAudioTrack = await runtime.selectPreferredPairableAudioTrack(
      sourceVideoTrack,
      sourceAudioTracks,
      selectedAudioTrack,
    );
    const sourceHasAudio = sourceAudioTracks.length > 0;

    const { start: trimStart, end: trimEnd } = await resolveExportTrim(
      { startTime, endTime, timelineOffsetSeconds },
      [sourceVideoTrack, preferredAudioTrack],
      runtime,
    );

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
    const resolvedVideoQuality = videoQuality ?? DEFAULT_VIDEO_EXPORT_QUALITY;
    let videoQualityOptions: VideoQualityConversionOptions =
      resolvedVideoQuality === "sharp" ? {} : { forceTranscode: true };
    let videoRequiresTranscode = !sourceVideoTrack;
    let sourceVideoCodec: ExportVideoCodec | null = null;
    let targetVideoPlan: VideoEncodingPlan | null = null;
    if (sourceVideoTrack) {
      const decodability = await assessVideoTrackDecodability(sourceVideoTrack);
      videoRequiresTranscode = await videoExportRequiresSourceDecode({
        track: sourceVideoTrack,
        sourceVideoDimensions,
        outputDimensions,
        outputFormat,
        videoQualityOptions,
        trimStart,
        shouldBurnSubtitles,
        decodability,
      });
      if (videoRequiresTranscode) {
        assertVideoTrackDecodableForExport(decodability);
      } else {
        sourceVideoCodec = normalizeExportVideoCodec(decodability.codec);
      }
    }

    if (videoRequiresTranscode && outputDimensions) {
      targetVideoPlan = await resolveVideoEncodingPlan({
        format,
        outputDimensions,
        quality: resolvedVideoQuality,
        supportedVideoCodecs: outputFormat.getSupportedVideoCodecs(),
        canEncodeVideo: runtime.canEncodeVideo,
      });
      videoQualityOptions = videoQualityConversionOptions(targetVideoPlan);
    }

    onVideoEncodingPlan?.({
      bitrateBps: targetVideoPlan?.bitrateBps ?? null,
      codec: targetVideoPlan?.codec ?? sourceVideoCodec,
      mode: videoRequiresTranscode ? "transcode" : "copy",
    });

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

    let audioOptions: ConversionOptions["audio"];
    if (includeAudio && preferredAudioTrack) {
      const audioCodec = await resolveAudioCodec({
        format,
        outputFormat,
        canEncodeAudio: runtime.canEncodeAudio,
      });
      const baseAudioOptions = {
        forceTranscode: true,
        numberOfChannels: 2,
        codec: audioCodec,
        bitrate: EXPORT_AUDIO_BITRATE_BPS,
      } as const;

      audioOptions = (track) => ({
        ...baseAudioOptions,
        discard: track.id !== preferredAudioTrack.id,
      });
    } else {
      audioOptions = {
        discard: true,
      };
    }

    const conversionOptions: ConversionOptions = {
      input,
      output,
      audio: audioOptions,
      trim: {
        start: trimStart,
        end: trimEnd,
      },
      showWarnings: false,
    };

    if (metadataTags) {
      conversionOptions.tags = metadataTags;
    }

    if (sourceVideoTrack) {
      conversionOptions.video = (track) => ({
        discard: track.id !== sourceVideoTrack.id,
        ...videoQualityOptions,
        ...(resolution === "original"
          ? {}
          : {
              height: Number.parseInt(resolution, 10),
              fit: "contain" as const,
            }),
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
        height: Number.parseInt(resolution, 10),
        fit: "contain",
      };
    }

    signal?.throwIfAborted();
    const conversion = await runtime.initConversion(conversionOptions);
    let cancellation: Promise<void> | undefined;
    const cancelConversion = () => {
      cancellation ??= conversion.cancel().catch(() => {});
    };
    signal?.addEventListener("abort", cancelConversion, { once: true });
    try {
      if (signal?.aborted) {
        cancelConversion();
        signal.throwIfAborted();
      }
      if (!conversion.isValid) {
        const discardedDetails = await runtime.describeDiscardedTracks(
          conversion.discardedTracks,
        );
        const suffix = discardedDetails ? ` ${discardedDetails}` : "";
        throw new Error(`Conversion is invalid.${suffix}`);
      }

      const dropsAudio =
        includeAudio &&
        sourceHasAudio &&
        !conversion.utilizedTracks.some((track) => track.isAudioTrack());
      const dropsVideo =
        sourceVideoTrack &&
        !conversion.utilizedTracks.some(
          (track) => track.isVideoTrack() && track.id === sourceVideoTrack.id,
        );
      if (dropsAudio || dropsVideo) {
        const discardedDetails = await runtime.describeDiscardedTracks(
          conversion.discardedTracks,
        );
        const suffix = discardedDetails
          ? ` ${discardedDetails}`
          : " Mediabunny did not report a discarded-track reason.";
        throw new Error(
          `Export would drop the source ${dropsAudio ? "audio" : "video"} track.${suffix}`,
        );
      }

      conversion.onProgress = (progress) => {
        if (!signal?.aborted) {
          onProgress(progress);
          if (progress >= 1) {
            onPhaseChange?.("finalizing");
          }
        }
      };

      onPhaseChange?.("encoding");
      await conversion.execute();
      signal?.throwIfAborted();
      onPhaseChange?.("finalizing");

      if (!target.buffer) {
        throw new Error("Export did not produce a video buffer");
      }

      if (isIsobmffExportFormat(format)) {
        runtime.patchMp4MetadataBoxes(new Uint8Array(target.buffer));
      }

      // The conversion plan preserves the selected video and requested audio;
      // reparsing the completed file adds memory pressure for long exports.
      const blob = new Blob([target.buffer], { type: outputFormat.mimeType });

      return blob;
    } finally {
      signal?.removeEventListener("abort", cancelConversion);
      await cancellation;
    }
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener("abort", disposeOnAbort);
    input.dispose();
  }
}

interface VideoQualityConversionOptions {
  bitrate?: number;
  codec?: VideoCodec;
  forceTranscode?: boolean;
}

function videoQualityConversionOptions(
  plan: VideoEncodingPlan,
): VideoQualityConversionOptions {
  return {
    forceTranscode: true,
    codec: plan.codec,
    bitrate: plan.bitrateBps,
  };
}

async function resolveAudioCodec({
  format,
  outputFormat,
  canEncodeAudio,
}: {
  format: Exclude<ExportFormat, "gif">;
  outputFormat: ReturnType<typeof createOutputFormat>;
  canEncodeAudio: typeof canEncodeAudioWithBrowser;
}) {
  const supportedCodecs = outputFormat.getSupportedAudioCodecs();

  for (const codec of exportAudioCodecPriorities(format)) {
    if (!supportedCodecs.includes(codec)) {
      continue;
    }

    if (
      await canEncodeAudio(codec, {
        numberOfChannels: 2,
        bitrate: EXPORT_AUDIO_BITRATE_BPS,
      })
    ) {
      return codec;
    }
  }

  throw new Error("No compatible audio encoder is available for this export.");
}

async function resolveExportTrim(
  {
    startTime,
    endTime,
    timelineOffsetSeconds,
  }: Pick<ExportClipOptions, "startTime" | "endTime" | "timelineOffsetSeconds">,
  tracks: Parameters<typeof getTrackTimelineOffsetSeconds>[0],
  runtime: Pick<ExportClipRuntime, "getTrackTimelineOffsetSeconds">,
) {
  const availableOffset = await runtime.getTrackTimelineOffsetSeconds(tracks);
  const offset = timelineOffsetSeconds ?? availableOffset;
  if (!Number.isFinite(offset) || offset < 0) {
    throw new Error(
      "The source timeline offset must be a finite, non-negative number.",
    );
  }
  const start = toSourceTimelineTime(startTime, offset);
  if (
    timelineOffsetSeconds !== undefined &&
    start + 0.000001 < availableOffset
  ) {
    throw new Error(
      "The selected range is no longer available in this live stream. Choose a later range or reopen the stream.",
    );
  }
  return { start, end: toSourceTimelineTime(endTime, offset) };
}

async function exportGifClipWithRuntime(
  {
    signal,
    onPhaseChange,
    mediaSource,
    hls,
    timelineOffsetSeconds,
    startTime,
    endTime,
    resolution,
    gifSettings,
    selectedAudioTrack,
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

  signal?.throwIfAborted();
  const input = await runtime.createCliparrInputFromSource(mediaSource, {
    hls,
  });

  const disposeOnAbort = () => input.dispose();
  signal?.addEventListener("abort", disposeOnAbort, { once: true });

  try {
    signal?.throwIfAborted();
    const sourceVideoTrack = await input.getPrimaryVideoTrack({
      filter: isPlaybackVideoTrack,
    });

    if (!sourceVideoTrack) {
      throw new Error("GIF export requires a video track.");
    }

    assertVideoTrackDecodableForExport(
      await assessVideoTrackDecodability(sourceVideoTrack),
    );

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
    const sourceAudioTracks = await input.getAudioTracks();
    const preferredAudioTrack = await runtime.selectPreferredPairableAudioTrack(
      sourceVideoTrack,
      sourceAudioTracks,
      selectedAudioTrack,
    );
    const { start: trimStart, end: trimEnd } = await resolveExportTrim(
      { startTime, endTime, timelineOffsetSeconds },
      [sourceVideoTrack, preferredAudioTrack],
      runtime,
    );
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
      signal?.throwIfAborted();
      const clipTimestamp = frameIndex / resolvedGifSettings.frameRate;
      const displayTimestamp = startTime + clipTimestamp;
      const sourceTimestamp = Math.min(trimEnd, trimStart + clipTimestamp);
      const frame = await videoSink.getCanvas(sourceTimestamp);
      signal?.throwIfAborted();

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
        const activeCues = runtime.getActiveSubtitleCues(
          clippedSubtitleCues,
          displayTimestamp - startTime,
        );

        if (activeCues.length > 0) {
          runtime.renderSubtitleCues(
            context,
            activeCues,
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
    signal?.throwIfAborted();
    onPhaseChange?.("encoding");
    const frameEncoder = gifRuntime.createGifFrameEncoder({
      requiresSequentialFrames: requiresSequentialFrameEncoding,
    });
    const cancelFrameEncoder = () => frameEncoder.dispose();
    signal?.addEventListener("abort", cancelFrameEncoder, { once: true });
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
          signal?.throwIfAborted();
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
        signal?.throwIfAborted();
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
      signal?.throwIfAborted();
      const settledFrameEncodingError = frameEncodingError;
      if (settledFrameEncodingError) {
        throwGifFrameEncodingError(settledFrameEncodingError);
      }
    } finally {
      signal?.removeEventListener("abort", cancelFrameEncoder);
      frameEncoder.dispose();
    }

    if (encodedFrameCount === 0) {
      throw new Error("GIF export did not produce any frames.");
    }

    signal?.throwIfAborted();
    onPhaseChange?.("finalizing");
    const bytes = gifRuntime.concatenateGifFrameChunks(gifChunks);
    if (bytes.length === 0) {
      throw new Error("GIF export did not produce an image buffer.");
    }

    return new Blob([copyToArrayBuffer(bytes)], { type: "image/gif" });
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener("abort", disposeOnAbort);
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
    import("#/lib/gifFrameEncoder"),
    import("#/lib/gifFrameChunk"),
  ]);

  return {
    quantizeGifFrame: gifenc.quantize,
    createGifFrameEncoder: gifFrameEncoder.createBestGifFrameEncoder,
    concatenateGifFrameChunks: gifFrameChunk.concatenateGifFrameChunks,
  };
}
