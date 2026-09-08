import type {
  ExportFormat,
  ExportOutputDimensions,
  VideoExportQualityPreset,
} from "#/lib/exportTypes";
import type { ExportVideoCodec as SharedExportVideoCodec } from "@cliparr/shared/providers";

export type ExportVideoCodec = SharedExportVideoCodec;
export type ExportAudioCodec = "aac" | "mp3" | "opus" | "vorbis";

export interface VideoEncodingPlan {
  bitrateBps: number;
  codec: ExportVideoCodec;
}

export interface ResolvedVideoEncodingPlan extends VideoEncodingPlan {
  key: string;
}

export const EXPORT_AUDIO_BITRATE_BPS = 160_000;
export const EXPORT_ESTIMATE_CONTAINER_OVERHEAD = 1.03;
export const EXPORT_ENCODING_POLICY_VERSION = 1;

const REFERENCE_PIXELS = 1920 * 1080;
const REFERENCE_VIDEO_BITRATE_BPS = 3_000_000;

const VIDEO_CODEC_EFFICIENCY_FACTORS: Readonly<
  Record<ExportVideoCodec, number>
> = {
  avc: 1,
  hevc: 0.6,
  vp9: 0.6,
  av1: 0.4,
  vp8: 1.2,
};

const VIDEO_QUALITY_FACTORS: Readonly<
  Record<VideoExportQualityPreset, number>
> = {
  compact: 0.6,
  balanced: 1,
  sharp: 2,
};

const VIDEO_CODEC_PRIORITIES: Readonly<
  Record<Exclude<ExportFormat, "gif">, readonly ExportVideoCodec[]>
> = {
  mp4: ["avc", "hevc", "vp9", "av1", "vp8"],
  mov: ["avc", "hevc", "vp9", "av1", "vp8"],
  webm: ["vp9", "vp8", "av1"],
  mkv: ["avc", "vp9", "vp8", "av1", "hevc"],
};

const AUDIO_CODEC_PRIORITIES: Readonly<
  Record<Exclude<ExportFormat, "gif">, readonly ExportAudioCodec[]>
> = {
  mp4: ["aac", "mp3", "opus", "vorbis"],
  mov: ["aac", "mp3", "opus", "vorbis"],
  webm: ["opus", "vorbis"],
  mkv: ["aac", "opus", "vorbis", "mp3"],
};

// Maintainer-controlled estimate calibration ties to recorded estimate/actual metrics rather than adding a second table; it corrects only systematic variable-bitrate output-size bias and never changes the encoder target.
const VIDEO_CALIBRATION_FACTORS: Readonly<
  Partial<
    Record<
      `${Exclude<ExportFormat, "gif">}:${ExportVideoCodec}:${VideoExportQualityPreset}`,
      number
    >
  >
> = {};

export function exportVideoCodecPriorities(
  format: Exclude<ExportFormat, "gif">,
) {
  return VIDEO_CODEC_PRIORITIES[format];
}

export function exportAudioCodecPriorities(
  format: Exclude<ExportFormat, "gif">,
) {
  return AUDIO_CODEC_PRIORITIES[format];
}

export function videoEncodingPlanKey({
  format,
  outputDimensions,
  quality,
}: {
  format: Exclude<ExportFormat, "gif">;
  outputDimensions: ExportOutputDimensions;
  quality: VideoExportQualityPreset;
}) {
  return `${format}:${outputDimensions.width}x${outputDimensions.height}:${quality}`;
}

export function formatCanCopyVideoCodec(
  format: Exclude<ExportFormat, "gif">,
  codec: string | null | undefined,
) {
  if (!codec) {
    return false;
  }

  if (format === "webm") {
    return codec === "av1" || codec === "vp8" || codec === "vp9";
  }

  return (
    codec === "av1" ||
    codec === "avc" ||
    codec === "hevc" ||
    codec === "vp8" ||
    codec === "vp9"
  );
}

export function videoTargetBitrateBps({
  codec,
  outputDimensions,
  quality,
}: {
  codec: ExportVideoCodec;
  outputDimensions: ExportOutputDimensions;
  quality: VideoExportQualityPreset;
}) {
  const pixels = outputDimensions.width * outputDimensions.height;
  const scaleFactor = Math.pow(pixels / REFERENCE_PIXELS, 0.95);
  return Math.max(
    1000,
    Math.ceil(
      (REFERENCE_VIDEO_BITRATE_BPS *
        scaleFactor *
        VIDEO_CODEC_EFFICIENCY_FACTORS[codec] *
        VIDEO_QUALITY_FACTORS[quality]) /
        1000,
    ) * 1000,
  );
}

export function calibratedEstimatedVideoBitrateBps({
  format,
  codec,
  outputDimensions,
  quality,
}: {
  format: Exclude<ExportFormat, "gif">;
  codec: ExportVideoCodec;
  outputDimensions: ExportOutputDimensions;
  quality: VideoExportQualityPreset;
}) {
  const targetBitrateBps = videoTargetBitrateBps({
    codec,
    outputDimensions,
    quality,
  });
  const calibration =
    VIDEO_CALIBRATION_FACTORS[`${format}:${codec}:${quality}`] ?? 1;

  return Math.max(
    1000,
    Math.ceil((targetBitrateBps * calibration) / 1000) * 1000,
  );
}

export async function resolveVideoEncodingPlan({
  format,
  outputDimensions,
  quality,
  supportedVideoCodecs,
  canEncodeVideo,
}: {
  format: Exclude<ExportFormat, "gif">;
  outputDimensions: ExportOutputDimensions;
  quality: VideoExportQualityPreset;
  supportedVideoCodecs: readonly string[];
  canEncodeVideo: (
    codec: ExportVideoCodec,
    options: { bitrate: number; height: number; width: number },
  ) => Promise<boolean>;
}): Promise<VideoEncodingPlan> {
  for (const codec of exportVideoCodecPriorities(format)) {
    if (!supportedVideoCodecs.includes(codec)) {
      continue;
    }

    const bitrateBps = videoTargetBitrateBps({
      codec,
      outputDimensions,
      quality,
    });
    if (
      await canEncodeVideo(codec, {
        width: outputDimensions.width,
        height: outputDimensions.height,
        bitrate: bitrateBps,
      })
    ) {
      return { codec, bitrateBps };
    }
  }

  throw new Error("No compatible video encoder is available for this export.");
}
