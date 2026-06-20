import {
  downloadBlob,
  exportClip,
  exportFormatExtension,
  exportFormatSupportsAudio,
  titleFromFileName,
  type EditorFileMediaSource,
  type EditorMediaSource,
  type ExportClipOptions,
  type ExportFormat,
  type ExportQualityPreset,
  type ExportResolution,
  type GifExportPreset,
  type GifExportSettings,
  type MediaExportMetadata,
  type VideoExportQualityPreset,
} from "@cliparr/frontend/convert";

export interface SourceProbeResult {
  durationSeconds: number;
  previewStartTimestampSeconds: number;
  dimensions: {
    width: number;
    height: number;
  };
  hasAudio: boolean;
}

export interface ConvertExportOptions {
  source: EditorMediaSource;
  fileName: string;
  metadata?: MediaExportMetadata;
  probe: SourceProbeResult;
  format: ExportFormat;
  resolution: ExportResolution;
  gifSettings?: GifExportSettings;
  videoQuality?: VideoExportQualityPreset;
  includeAudio: boolean;
  onProgress: (progress: number) => void;
}

export interface ConvertExportDependencies {
  exportClip: (options: ExportClipOptions) => Promise<Blob>;
  downloadBlob: (blob: Blob, fileName: string) => void;
}

const DEFAULT_EXPORT_DEPENDENCIES: ConvertExportDependencies = {
  exportClip,
  downloadBlob,
};
const fallbackConvertedFileBaseName = "converted-video";
const knownConvertedFileExtensions = [".mp4", ".webm", ".mov", ".mkv", ".gif"];

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

  return `${baseName}${exportFormatExtension(format)}`;
}

export function buildConvertedOutputFileName(
  baseName: string,
  format: ExportFormat,
) {
  return `${sanitizeConvertedFileBaseName(trimKnownConvertedFileExtension(baseName))}${exportFormatExtension(format)}`;
}

export function resolveConvertIncludeAudio(
  format: ExportFormat,
  includeAudio: boolean,
) {
  return exportFormatSupportsAudio(format) ? includeAudio : false;
}

export function selectedQualityForFormat({
  format,
  gifPreset,
  videoQuality,
}: {
  format: ExportFormat;
  gifPreset: GifExportPreset;
  videoQuality: VideoExportQualityPreset;
}): ExportQualityPreset {
  return format === "gif" ? gifPreset : videoQuality;
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const wholeSeconds = Math.round(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export async function runConvertExport(
  {
    source,
    fileName,
    metadata,
    probe,
    format,
    resolution,
    gifSettings,
    videoQuality,
    includeAudio,
    onProgress,
  }: ConvertExportOptions,
  dependencies: ConvertExportDependencies = DEFAULT_EXPORT_DEPENDENCIES,
) {
  const blob = await dependencies.exportClip({
    mediaSource: source,
    hls: false,
    startTime: 0,
    endTime: probe.durationSeconds,
    format,
    resolution,
    gifSettings: format === "gif" ? gifSettings : undefined,
    videoQuality: format === "gif" ? undefined : videoQuality,
    includeAudio: resolveConvertIncludeAudio(format, includeAudio),
    metadata,
    onProgress,
  });

  dependencies.downloadBlob(blob, fileName);

  return blob;
}
