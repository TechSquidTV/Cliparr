import type {
  GifDitherMode,
  GifPaletteFormat,
  GifPaletteMode,
  GifTemporalDitherSettings,
} from "#/lib/gifEncodingSettings";
import {
  calibratedEstimatedVideoBitrateBps,
  exportVideoCodecPriorities,
  EXPORT_AUDIO_BITRATE_BPS,
  EXPORT_ESTIMATE_CONTAINER_OVERHEAD,
  type ExportVideoCodec,
} from "#/lib/exportEncodingPolicy";

export type ExportFormat = "mp4" | "webm" | "mov" | "mkv" | "gif";

export type ExportResolution = "original" | "1080" | "720";

export type ExportQualityPreset =
  | "compact"
  | "efficient"
  | "balanced"
  | "sharp";

export type GifExportPreset = ExportQualityPreset;

export type VideoExportQualityPreset = Exclude<
  ExportQualityPreset,
  "efficient"
>;

export type HlsManifestBitrateBasis = "average-bandwidth" | "bandwidth";

export interface ExportOutputDimensions {
  width: number;
  height: number;
}

export interface GifExportSettings {
  preset: GifExportPreset;
  maxHeight: number;
  frameRate: number;
  maxColors: number;
  paletteMode: GifPaletteMode;
  paletteFormat: GifPaletteFormat;
  ditherMode: GifDitherMode;
  ditherStrength?: number;
  serpentine?: boolean;
  temporalDither?: GifTemporalDitherSettings | null;
}

type ExportSizeEstimateBasis =
  | "copy-plan"
  | "copy-fallback"
  | "transcode-plan"
  | "gif-profile"
  | "unavailable";

export interface ExportSizeEstimate {
  bytes: number | null;
  basis: ExportSizeEstimateBasis;
}

export interface EstimateExportOutputSizeOptions {
  format: ExportFormat;
  durationSeconds: number;
  outputDimensions: ExportOutputDimensions | null;
  includeAudio: boolean;
  resolution: ExportResolution;
  gifSettings?: GifExportSettings | null;
  sourceSizeBytes?: number | null;
  sourceDurationSeconds?: number | null;
  sourceBitrateKbps?: number | null;
  videoBitrateKbps?: number | null;
  audioBitrateKbps?: number | null;
  sourceCopyEligible?: boolean;
  preferredVideoCodec?: ExportVideoCodec | null;
  includeBurnedSubtitles?: boolean;
  videoQuality?: VideoExportQualityPreset | null;
}

export const DEFAULT_GIF_EXPORT_PRESET: GifExportPreset = "balanced";
export const DEFAULT_VIDEO_EXPORT_QUALITY: VideoExportQualityPreset = "sharp";
export const EXPORT_SIZE_ESTIMATE_ALGORITHM_VERSION = 2;

export const exportQualityOptions: ReadonlyArray<{
  value: ExportQualityPreset;
  label: string;
  videoDescription?: string;
  gifDescription: string;
}> = [
  {
    value: "compact",
    label: "Compact",
    videoDescription: "Smallest video file; lower bitrate.",
    gifDescription: "Smallest GIF, lighter motion/detail.",
  },
  {
    value: "efficient",
    label: "Efficient",
    gifDescription: "Smaller GIF with smooth motion/detail.",
  },
  {
    value: "balanced",
    label: "Balanced",
    videoDescription: "Smaller video file; moderate bitrate.",
    gifDescription: "Default GIF quality/size tradeoff.",
  },
  {
    value: "sharp",
    label: "Sharp",
    videoDescription: "Preserves source video when possible.",
    gifDescription: "Smoother, highest-detail GIF.",
  },
];

export const videoExportQualityOptions = exportQualityOptions.filter(
  (
    option,
  ): option is (typeof exportQualityOptions)[number] & {
    value: VideoExportQualityPreset;
    videoDescription: string;
  } => option.value !== "efficient" && Boolean(option.videoDescription),
);

const SOFT_TEMPORAL_DITHER_SETTINGS: GifTemporalDitherSettings = {
  strength: 0.45,
  decay: 0.6,
  maxError: 48,
  changeDetection: {
    pixelThreshold: 24,
  },
};

const GIF_EXPORT_PRESET_SETTINGS: Record<
  GifExportPreset,
  Omit<GifExportSettings, "preset">
> = {
  compact: {
    maxHeight: 360,
    frameRate: 10,
    maxColors: 64,
    paletteMode: "global",
    paletteFormat: "rgb444",
    ditherMode: "none",
  },
  efficient: {
    maxHeight: 432,
    frameRate: 12,
    maxColors: 128,
    paletteMode: "per-frame",
    paletteFormat: "rgb565",
    ditherMode: "spatial-temporal",
    temporalDither: SOFT_TEMPORAL_DITHER_SETTINGS,
  },
  balanced: {
    maxHeight: 480,
    frameRate: 12,
    maxColors: 128,
    paletteMode: "per-frame",
    paletteFormat: "rgb565",
    ditherMode: "spatial-temporal",
    temporalDither: SOFT_TEMPORAL_DITHER_SETTINGS,
  },
  sharp: {
    maxHeight: 720,
    frameRate: 18,
    maxColors: 128,
    paletteMode: "per-frame",
    paletteFormat: "rgb565",
    ditherMode: "spatial-temporal",
    temporalDither: SOFT_TEMPORAL_DITHER_SETTINGS,
  },
};

export const gifExportPresetOptions: ReadonlyArray<{
  value: GifExportPreset;
  label: string;
  description: string;
  settings: GifExportSettings;
}> = exportQualityOptions.map((option) => ({
  value: option.value,
  label: option.label,
  description: option.gifDescription,
  settings: cloneGifExportSettings({
    preset: option.value,
    ...GIF_EXPORT_PRESET_SETTINGS[option.value],
  }),
}));

const GIF_EXPORT_MAX_DURATION_SECONDS = 15;
const GIF_ESTIMATE_BASE_BYTES = 20_000;
const GIF_ESTIMATE_BYTES_PER_PIXEL_FRAME: Record<GifExportPreset, number> = {
  compact: 0.225,
  efficient: 0.48,
  balanced: 0.48,
  sharp: 0.5,
};

export function exportFormatSupportsAudio(format: ExportFormat) {
  return format !== "gif";
}

export function gifExportSettingsForPreset(preset: GifExportPreset) {
  const option =
    gifExportPresetOptions.find((option) => option.value === preset) ??
    gifExportPresetOptions.find(
      (option) => option.value === DEFAULT_GIF_EXPORT_PRESET,
    ) ??
    gifExportPresetOptions[0];

  return cloneGifExportSettings(option.settings);
}

function cloneGifExportSettings(
  settings: GifExportSettings,
): GifExportSettings {
  return {
    ...settings,
    temporalDither: settings.temporalDither
      ? {
          ...settings.temporalDither,
          changeDetection:
            typeof settings.temporalDither.changeDetection === "object" &&
            settings.temporalDither.changeDetection !== null
              ? { ...settings.temporalDither.changeDetection }
              : settings.temporalDither.changeDetection,
        }
      : settings.temporalDither,
  };
}

export function exportQualityOptionFor(preset: ExportQualityPreset) {
  return (
    exportQualityOptions.find((option) => option.value === preset) ??
    exportQualityOptions.find(
      (option) => option.value === DEFAULT_VIDEO_EXPORT_QUALITY,
    ) ??
    exportQualityOptions[0]
  );
}

export function exportQualityOptionsForFormat(format: ExportFormat) {
  return format === "gif" ? exportQualityOptions : videoExportQualityOptions;
}

export function exportQualityDescriptionFor(
  format: ExportFormat,
  preset: ExportQualityPreset,
) {
  const option = exportQualityOptionFor(preset);

  if (format === "gif") {
    return option.gifDescription;
  }

  return option.videoDescription ?? "Preserves source video when possible.";
}

function exportFormatMaxHeight(
  format: ExportFormat,
  gifSettings?: GifExportSettings | null,
) {
  return format === "gif"
    ? (gifSettings ?? gifExportSettingsForPreset(DEFAULT_GIF_EXPORT_PRESET))
        .maxHeight
    : null;
}

function exportFormatMaxDurationSeconds(format: ExportFormat) {
  return format === "gif" ? GIF_EXPORT_MAX_DURATION_SECONDS : null;
}

export function exportFormatDurationDisabledReason(
  format: ExportFormat,
  startTime: number,
  endTime: number,
) {
  const maxDuration = exportFormatMaxDurationSeconds(format);
  if (maxDuration === null || endTime <= startTime) {
    return null;
  }

  const duration = endTime - startTime;
  return duration > maxDuration
    ? `GIF exports are limited to ${maxDuration} seconds. Trim the clip or choose WebM.`
    : null;
}

export function resolveExportOutputDimensions(
  sourceVideoDimensions: ExportOutputDimensions | null,
  resolution: ExportResolution,
  format: ExportFormat,
  gifSettings?: GifExportSettings | null,
) {
  if (
    !sourceVideoDimensions ||
    sourceVideoDimensions.width <= 0 ||
    sourceVideoDimensions.height <= 0
  ) {
    return null;
  }

  const requestedHeight =
    resolution === "original"
      ? sourceVideoDimensions.height
      : Number.parseInt(resolution, 10);
  if (!Number.isFinite(requestedHeight) || requestedHeight <= 0) {
    return sourceVideoDimensions;
  }

  const maxHeight = exportFormatMaxHeight(format, gifSettings);
  const height =
    maxHeight === null ? requestedHeight : Math.min(requestedHeight, maxHeight);
  const width = Math.max(
    1,
    Math.round(
      (sourceVideoDimensions.width / sourceVideoDimensions.height) * height,
    ),
  );

  return { width, height };
}

export function formatExportByteSize(bytes: number) {
  const safeBytes = Math.max(0, bytes);
  const kib = safeBytes / 1024;
  const mib = kib / 1024;

  if (mib >= 1) {
    return `${mib < 10 ? mib.toFixed(1) : Math.round(mib).toString()} MB`;
  }

  return `${Math.max(1, Math.round(kib))} KB`;
}

export function estimateExportOutputSize({
  format,
  durationSeconds,
  outputDimensions,
  includeAudio,
  resolution,
  gifSettings,
  sourceSizeBytes,
  sourceDurationSeconds,
  sourceBitrateKbps,
  videoBitrateKbps,
  audioBitrateKbps,
  sourceCopyEligible = false,
  preferredVideoCodec,
  includeBurnedSubtitles = false,
  videoQuality,
}: EstimateExportOutputSizeOptions): ExportSizeEstimate {
  if (durationSeconds <= 0 || !outputDimensions) {
    return { bytes: null, basis: "unavailable" };
  }

  if (format === "gif") {
    const settings =
      gifSettings ?? gifExportSettingsForPreset(DEFAULT_GIF_EXPORT_PRESET);
    const frameCount = Math.max(
      1,
      Math.ceil(durationSeconds * settings.frameRate),
    );
    const bytes =
      outputDimensions.width *
        outputDimensions.height *
        frameCount *
        GIF_ESTIMATE_BYTES_PER_PIXEL_FRAME[settings.preset] +
      GIF_ESTIMATE_BASE_BYTES;

    return {
      bytes: Math.round(bytes),
      basis: "gif-profile",
    };
  }

  const resolvedVideoQuality = videoQuality ?? DEFAULT_VIDEO_EXPORT_QUALITY;

  if (
    sourceCopyEligible &&
    resolvedVideoQuality === "sharp" &&
    resolution === "original" &&
    !includeBurnedSubtitles
  ) {
    const metadataBitrateKbps = copyPlanBitrateKbps({
      sourceBitrateKbps,
      videoBitrateKbps,
      audioBitrateKbps,
      includeAudio,
    });

    if (metadataBitrateKbps !== null) {
      return estimateFromBitrateKbps(
        metadataBitrateKbps,
        durationSeconds,
        "copy-plan",
      );
    }

    if (
      typeof sourceSizeBytes === "number" &&
      sourceSizeBytes > 0 &&
      typeof sourceDurationSeconds === "number" &&
      sourceDurationSeconds > 0
    ) {
      return {
        bytes: Math.round(
          sourceSizeBytes *
            Math.min(1, durationSeconds / sourceDurationSeconds),
        ),
        basis: "copy-fallback",
      };
    }
  }

  const codec = preferredVideoCodec ?? exportVideoCodecPriorities(format)[0];
  const videoBitrateBps = calibratedEstimatedVideoBitrateBps({
    format,
    codec,
    outputDimensions,
    quality: resolvedVideoQuality,
  });

  return estimateFromBitrateKbps(
    (videoBitrateBps + (includeAudio ? EXPORT_AUDIO_BITRATE_BPS : 0)) / 1000,
    durationSeconds,
    "transcode-plan",
  );
}

function estimateFromBitrateKbps(
  bitrateKbps: number,
  durationSeconds: number,
  basis: Exclude<
    ExportSizeEstimateBasis,
    "gif-profile" | "copy-fallback" | "unavailable"
  >,
): ExportSizeEstimate {
  return {
    bytes: Math.round(
      ((bitrateKbps * 1000) / 8) *
        durationSeconds *
        EXPORT_ESTIMATE_CONTAINER_OVERHEAD,
    ),
    basis,
  };
}

function copyPlanBitrateKbps({
  sourceBitrateKbps,
  videoBitrateKbps,
  audioBitrateKbps,
  includeAudio,
}: Pick<
  EstimateExportOutputSizeOptions,
  "sourceBitrateKbps" | "videoBitrateKbps" | "audioBitrateKbps" | "includeAudio"
>): number | null {
  const outputAudioBitrateKbps = includeAudio
    ? EXPORT_AUDIO_BITRATE_BPS / 1000
    : 0;

  if (typeof videoBitrateKbps === "number" && videoBitrateKbps > 0) {
    return videoBitrateKbps + outputAudioBitrateKbps;
  }

  if (typeof sourceBitrateKbps !== "number" || sourceBitrateKbps <= 0) {
    return null;
  }

  if (typeof audioBitrateKbps !== "number" || audioBitrateKbps <= 0) {
    return sourceBitrateKbps;
  }

  return Math.max(
    1,
    sourceBitrateKbps - audioBitrateKbps + outputAudioBitrateKbps,
  );
}
