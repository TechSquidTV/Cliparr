export type ExportFormat = "mp4" | "webm" | "mov" | "mkv" | "gif";

export type ExportResolution = "original" | "1080" | "720";

export type GifExportPreset = "compact" | "balanced" | "sharp";

type GifPaletteMode = "global" | "per-frame";
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
}

type ExportSizeEstimateBasis =
  | "codec-heuristic"
  | "hls-manifest"
  | "hls-manifest-capped"
  | "source-bitrate"
  | "gif-heuristic"
  | "source-proportional"
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
  hlsManifestBitrateKbps?: number | null;
  hlsManifestBitrateBasis?: HlsManifestBitrateBasis | null;
  includeBurnedSubtitles?: boolean;
}

export const DEFAULT_GIF_EXPORT_PRESET: GifExportPreset = "balanced";

export const gifExportPresetOptions: ReadonlyArray<{
  value: GifExportPreset;
  label: string;
  description: string;
  settings: GifExportSettings;
}> = [
  {
    value: "compact",
    label: "Compact",
    description: "360p max, 10 fps, 64 colors, stable palette.",
    settings: {
      preset: "compact",
      maxHeight: 360,
      frameRate: 10,
      maxColors: 64,
      paletteMode: "global",
    },
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "480p max, 12 fps, 128 colors, stable palette.",
    settings: {
      preset: "balanced",
      maxHeight: 480,
      frameRate: 12,
      maxColors: 128,
      paletteMode: "global",
    },
  },
  {
    value: "sharp",
    label: "Sharp",
    description: "720p max, 15 fps, 256 colors, per-frame palette.",
    settings: {
      preset: "sharp",
      maxHeight: 720,
      frameRate: 15,
      maxColors: 256,
      paletteMode: "per-frame",
    },
  },
];

const GIF_EXPORT_MAX_DURATION_SECONDS = 15;
const AUDIO_EXPORT_BITRATE_KBPS = 160;
const VIDEO_ESTIMATE_CONTAINER_OVERHEAD = 1.03;
const GIF_ESTIMATE_BASE_BYTES = 20_000;
const GIF_ESTIMATE_BYTES_PER_PIXEL_FRAME: Record<GifExportPreset, number> = {
  compact: 0.225,
  balanced: 0.255,
  sharp: 0.42,
};
const VIDEO_ESTIMATE_BITRATES_KBPS: Record<
  Exclude<ExportFormat, "gif">,
  readonly [number, number, number, number, number]
> = {
  mp4: [9_000, 5_300, 3_400, 1_700, 950],
  webm: [6_000, 3_350, 2_200, 1_100, 650],
  mov: [10_500, 6_200, 3_900, 2_000, 1_100],
  mkv: [6_500, 3_900, 2_500, 1_250, 750],
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

  return { ...option.settings };
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
      : parseInt(resolution, 10);
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
  hlsManifestBitrateKbps,
  hlsManifestBitrateBasis,
  includeBurnedSubtitles = false,
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
      basis: "gif-heuristic",
    };
  }

  if (
    resolution === "original" &&
    !includeBurnedSubtitles &&
    typeof sourceSizeBytes === "number" &&
    sourceSizeBytes > 0 &&
    typeof sourceDurationSeconds === "number" &&
    sourceDurationSeconds > 0
  ) {
    return {
      bytes: Math.round(
        sourceSizeBytes * Math.min(1, durationSeconds / sourceDurationSeconds),
      ),
      basis: "source-proportional",
    };
  }

  if (
    !includeBurnedSubtitles &&
    typeof hlsManifestBitrateKbps === "number" &&
    hlsManifestBitrateKbps > 0
  ) {
    const adjustedHlsBitrateKbps = includeAudio
      ? hlsManifestBitrateKbps
      : Math.max(
          1,
          hlsManifestBitrateKbps - audioEstimateBitrateKbps(audioBitrateKbps),
        );
    const hlsEstimate = estimateFromBitrateKbps(
      adjustedHlsBitrateKbps,
      durationSeconds,
      "hls-manifest",
    );
    const codecEstimate = estimateFromBitrateKbps(
      targetOutputBitrateKbps(format, outputDimensions.height, includeAudio),
      durationSeconds,
      "codec-heuristic",
    );

    if (
      hlsManifestBitrateBasis !== "average-bandwidth" &&
      typeof hlsEstimate.bytes === "number" &&
      typeof codecEstimate.bytes === "number" &&
      hlsEstimate.bytes > codecEstimate.bytes
    ) {
      return {
        bytes: codecEstimate.bytes,
        basis: "hls-manifest-capped",
      };
    }

    return hlsEstimate;
  }

  const metadataBitrateKbps =
    typeof sourceBitrateKbps === "number" && sourceBitrateKbps > 0
      ? sourceBitrateKbps
      : typeof videoBitrateKbps === "number" && videoBitrateKbps > 0
        ? videoBitrateKbps +
          (includeAudio &&
          typeof audioBitrateKbps === "number" &&
          audioBitrateKbps > 0
            ? audioBitrateKbps
            : 0)
        : null;

  if (
    resolution === "original" &&
    !includeBurnedSubtitles &&
    metadataBitrateKbps
  ) {
    return estimateFromBitrateKbps(
      metadataBitrateKbps,
      durationSeconds,
      "source-bitrate",
    );
  }

  return estimateFromBitrateKbps(
    targetOutputBitrateKbps(format, outputDimensions.height, includeAudio),
    durationSeconds,
    "codec-heuristic",
  );
}

function estimateFromBitrateKbps(
  bitrateKbps: number,
  durationSeconds: number,
  basis: Exclude<
    ExportSizeEstimateBasis,
    "gif-heuristic" | "source-proportional" | "unavailable"
  >,
): ExportSizeEstimate {
  return {
    bytes: Math.round(
      ((bitrateKbps * 1000) / 8) *
        durationSeconds *
        VIDEO_ESTIMATE_CONTAINER_OVERHEAD,
    ),
    basis,
  };
}

function targetOutputBitrateKbps(
  format: Exclude<ExportFormat, "gif">,
  height: number,
  includeAudio: boolean,
) {
  return (
    targetVideoBitrateKbps(format, height) +
    (includeAudio ? AUDIO_EXPORT_BITRATE_KBPS : 0)
  );
}

function audioEstimateBitrateKbps(audioBitrateKbps: number | null | undefined) {
  return typeof audioBitrateKbps === "number" && audioBitrateKbps > 0
    ? audioBitrateKbps
    : AUDIO_EXPORT_BITRATE_KBPS;
}

function targetVideoBitrateKbps(
  format: Exclude<ExportFormat, "gif">,
  height: number,
) {
  const [veryHigh, high, medium, low, compact] =
    VIDEO_ESTIMATE_BITRATES_KBPS[format];

  if (height >= 1440) {
    return veryHigh;
  }

  if (height >= 1000) {
    return high;
  }

  if (height >= 700) {
    return medium;
  }

  if (height >= 460) {
    return low;
  }

  return compact;
}
