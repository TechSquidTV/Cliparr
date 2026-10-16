import {
  createCliparrInputFromSource,
  downloadBlob,
  type EditorFileMediaSource,
  type EditorMediaSource,
  exportClip,
  type ExportClipOptions,
  type ExportFormat,
  exportFormatFor,
  exportFormats,
  getVideoTrackDimensions,
  type MediaDimensions,
  probeMediaSource,
  titleFromFileName,
} from "@cliparr/frontend/convert/engine";

export interface SourceProbeResult {
  durationSeconds: number;
  previewStartTimestampSeconds: number;
  dimensions: MediaDimensions | null;
  hasAudio: boolean;
  hasVideo: boolean;
  videoCodec?: string | null;
  videoBitrateKbps?: number | null;
}

export interface ConvertExportOptions extends Pick<
  ExportClipOptions,
  | "outputFile"
  | "metadata"
  | "format"
  | "resolution"
  | "gifSettings"
  | "videoQuality"
  | "mode"
  | "mixDownToStereo"
  | "audioPlan"
  | "onVideoEncodingPlan"
  | "onProgress"
  | "signal"
  | "onPhaseChange"
> {
  source: EditorMediaSource;
  fileName: string;
  probe: SourceProbeResult;
}

export interface ConvertExportDependencies {
  exportClip: (options: ExportClipOptions) => Promise<Blob>;
  downloadBlob: (blob: Blob, fileName: string) => void;
}

const DEFAULT_EXPORT_DEPENDENCIES: ConvertExportDependencies = {
  exportClip,
  downloadBlob,
};
const fallbackConvertedFileBaseName = "converted-media";
const knownConvertedFileExtensions = exportFormats.map(
  (option) => option.extension,
);

export function buildLocalFileSource(file: File): EditorFileMediaSource {
  return {
    kind: "file",
    role: "local-file",
    label: "Local file",
    file,
    fileName: file.name,
    mimeType: file.type || undefined,
    size: file.size,
    lastModified: file.lastModified,
  };
}

function sanitizeConvertedFileBaseName(value: string) {
  const sanitized = value
    .replaceAll(/[^\d A-Za-z._-]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();

  return sanitized || fallbackConvertedFileBaseName;
}

function trimKnownConvertedFileExtension(value: string) {
  const trimmed = value.trim();
  const lowerCaseValue = trimmed.toLowerCase();
  const matchedExtension = knownConvertedFileExtensions.find((extension) =>
    lowerCaseValue.endsWith(extension),
  );

  return matchedExtension
    ? trimmed.slice(0, -matchedExtension.length)
    : trimmed;
}

export function buildConvertedFileBaseName(fileName: string) {
  return sanitizeConvertedFileBaseName(titleFromFileName(fileName));
}

export function buildConvertedFileName(fileName: string, format: ExportFormat) {
  const baseName = buildConvertedFileBaseName(fileName);

  return `${baseName}${exportFormatFor(format).extension}`;
}

export function buildConvertedOutputFileName(
  baseName: string,
  format: ExportFormat,
) {
  return `${sanitizeConvertedFileBaseName(trimKnownConvertedFileExtension(baseName))}${exportFormatFor(format).extension}`;
}

export async function runConvertExport(
  { source, fileName, probe, ...options }: ConvertExportOptions,
  dependencies: ConvertExportDependencies = DEFAULT_EXPORT_DEPENDENCIES,
) {
  options.signal?.throwIfAborted();
  const blob = await dependencies.exportClip({
    ...options,
    mediaSource: source,
    hls: false,
    startTime: 0,
    endTime: probe.durationSeconds,
    gifSettings: options.format === "gif" ? options.gifSettings : undefined,
    videoQuality: options.format === "gif" ? undefined : options.videoQuality,
    title: titleFromFileName(fileName),
  });
  options.signal?.throwIfAborted();
  if (!options.outputFile) {
    dependencies.downloadBlob(blob, fileName);
  }
  return blob;
}

export async function probeConvertSource(
  source: EditorFileMediaSource,
  audioOnly: boolean,
  signal?: AbortSignal,
  createInput = createCliparrInputFromSource,
): Promise<SourceProbeResult> {
  signal?.throwIfAborted();
  const input = await createInput(source);
  const dispose = () => input.dispose();
  signal?.addEventListener("abort", dispose, { once: true });
  try {
    signal?.throwIfAborted();
    const {
      sourceVideoTrack: sourceVideo,
      sourceAudioTrack: audio,
      videoTrack: video,
      timelineOffsetSeconds,
      durationSeconds,
    } = await probeMediaSource(input, {
      audioOnly,
      requirePositiveDuration: true,
    });
    const dimensions = video ? await getVideoTrackDimensions(video) : null;
    const averageBitrate = video ? await video.getAverageBitrate() : null;
    const peakBitrate = video ? await video.getBitrate() : null;
    let videoBitrateKbps: number | null = null;
    if (averageBitrate && averageBitrate > 0) {
      videoBitrateKbps = Math.round(averageBitrate / 1000);
    } else if (peakBitrate && peakBitrate > 0) {
      videoBitrateKbps = Math.round(peakBitrate / 1000);
    }
    const result = {
      durationSeconds,
      previewStartTimestampSeconds: video
        ? Math.max(await video.getFirstTimestamp(), 0)
        : timelineOffsetSeconds,
      dimensions,
      hasAudio: Boolean(audio),
      hasVideo: Boolean(sourceVideo),
      videoCodec: video ? await video.getCodec() : null,
      videoBitrateKbps,
    };
    signal?.throwIfAborted();
    return result;
  } finally {
    signal?.removeEventListener("abort", dispose);
    dispose();
  }
}
