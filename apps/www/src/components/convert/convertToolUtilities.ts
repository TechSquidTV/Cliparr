import {
  createCliparrInputFromSource,
  isPlaybackVideoTrack,
  selectPreferredPairableAudioTrack,
  getTrackTimelineOffsetSeconds,
  getVideoTrackDimensions,
  downloadBlob,
  exportClip,
  exportFormatFor,
  exportFormats,
  titleFromFileName,
  type EditorFileMediaSource,
  type EditorMediaSource,
  type ExportClipOptions,
  type ExportFormat,
  type MediaDimensions,
} from "@cliparr/frontend/convert";

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
  dependencies.downloadBlob(blob, fileName);
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
    // Match export's track pairing without checking video decoding or dimensions.
    const sourceVideo = await input.getPrimaryVideoTrack({
      filter: isPlaybackVideoTrack,
    });
    const audio = await selectPreferredPairableAudioTrack(
      sourceVideo,
      await input.getAudioTracks(),
    );
    const video = audioOnly ? null : sourceVideo;
    if (audioOnly && !audio) {
      throw new Error("This file does not contain an audio track.");
    }
    if (!video && !audio) {
      throw new Error(
        "This file does not contain an exportable video or audio track.",
      );
    }
    const tracks = [video, audio].filter((track) => track !== null);
    const timelineOffsetSeconds = await getTrackTimelineOffsetSeconds(tracks);
    const metadataDuration = await input.getDurationFromMetadata(tracks);
    const sourceTimelineEnd =
      metadataDuration && metadataDuration > 0
        ? metadataDuration
        : await input.computeDuration(tracks);
    const durationSeconds = Math.max(
      0,
      sourceTimelineEnd - timelineOffsetSeconds,
    );
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("Could not determine this file's duration.");
    }
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
