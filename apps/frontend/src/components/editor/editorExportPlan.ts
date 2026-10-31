import { compactLogFields } from "@cliparr/shared/logging";

import {
  type EditorMediaSource,
  editorMediaSourcesEqual,
  isHlsEditorMediaSource,
  type MediaDimensions,
  sourceDisplayLabel,
} from "@/components/editor/editorMedia";
import type { EditorExportMedia } from "@/components/editor/editorMediaLifecycle";
import type { PlaybackFallbackInfo } from "@/components/editor/editorPlaybackSources";
import type {
  ExportFormat,
  ExportResolution,
  ExportVideoEncodingPlan,
} from "@/lib/export/exportClip";
import type { SubtitleCue } from "@/lib/subtitles/types";
import { EXPORT_ENCODING_POLICY_VERSION } from "#/lib/export/exportEncodingPolicy";
import { isAudioExportFormat } from "#/lib/export/exportFormats";
import {
  exportFormatDurationDisabledReason,
  type ExportSizeEstimate,
  type ExportSourcePreference,
  type GifExportSettings,
  resolveExportOutputDimensions,
} from "#/lib/export/exportTypes";
import type { HlsExportEstimateMetadata } from "#/lib/export/hlsExportEstimate";

type ResolvedExportSourceKind = "hls" | "direct" | "none";

interface ResolvedExportSource {
  source: EditorMediaSource | null;
  kind: ResolvedExportSourceKind;
}

interface ExportReadinessInput {
  exportSource: ResolvedExportSource;
  format: ExportFormat;
  exporting: boolean;
  startTime: number;
  endTime: number;
  subtitleEnabled: boolean;
  clippedSubtitleCues: readonly SubtitleCue[];
  subtitleLoading: boolean;
}

export function exportTimelineOffsetForSource(
  source: EditorMediaSource,
  exportMedia: EditorExportMedia | null,
) {
  return exportMedia &&
    editorMediaSourcesEqual(source, exportMedia.candidate.source)
    ? exportMedia.metadata.timelineOffsetSeconds
    : undefined;
}

export function getOutputDimensions(
  sourceVideoDimensions: MediaDimensions | null,
  resolution: ExportResolution,
  format: ExportFormat = "mp4",
  gifSettings?: GifExportSettings | null,
) {
  return resolveExportOutputDimensions(
    sourceVideoDimensions,
    resolution,
    format,
    gifSettings,
  );
}

export function exportSourceSizeBytes(source: EditorMediaSource | null) {
  if (!source) {
    return null;
  }

  if (source.kind === "file") {
    return source.size ?? source.file.size;
  }

  if (source.kind === "file-handle") {
    return source.size ?? null;
  }

  return null;
}

export function buildExportEstimateLogFields({
  estimate,
  hlsEstimateMetadata,
  sourceSizeBytes,
  sourceDurationSeconds,
  sourceBitrateKbps,
  videoBitrateKbps,
  audioBitrateKbps,
}: {
  estimate: ExportSizeEstimate;
  hlsEstimateMetadata: HlsExportEstimateMetadata | null;
  sourceSizeBytes?: number | null;
  sourceDurationSeconds?: number | null;
  sourceBitrateKbps?: number | null;
  videoBitrateKbps?: number | null;
  audioBitrateKbps?: number | null;
}) {
  return compactLogFields({
    "export.estimate.bytes": estimate.bytes ?? undefined,
    "export.estimate.basis": estimate.basis,
    "export.encoder.policy.version": EXPORT_ENCODING_POLICY_VERSION,
    "export.estimate.hls.bitrate_kbps": hlsEstimateMetadata?.bitrateKbps,
    "export.estimate.hls.bitrate_basis": hlsEstimateMetadata?.bitrateBasis,
    "export.estimate.hls.variant.width": hlsEstimateMetadata?.width,
    "export.estimate.hls.variant.height": hlsEstimateMetadata?.height,
    "export.estimate.hls.variant.frame_rate": hlsEstimateMetadata?.frameRate,
    "export.estimate.hls.variant.count": hlsEstimateMetadata?.variantCount,
    "export.estimate.source.size_bytes": sourceSizeBytes ?? undefined,
    "export.estimate.source.duration_seconds":
      sourceDurationSeconds ?? undefined,
    "export.estimate.source.bitrate_kbps": sourceBitrateKbps ?? undefined,
    "export.estimate.source.video_bitrate_kbps": videoBitrateKbps ?? undefined,
    "export.estimate.source.audio_bitrate_kbps": audioBitrateKbps ?? undefined,
  });
}

export function buildExportEstimateActualLogFields(
  estimate: ExportSizeEstimate,
  actualBytes: number,
) {
  if (typeof estimate.bytes !== "number" || estimate.bytes <= 0) {
    return {};
  }

  return {
    "export.estimate.actual.delta_bytes": actualBytes - estimate.bytes,
    "export.estimate.actual.ratio": Number(
      (actualBytes / estimate.bytes).toFixed(3),
    ),
  };
}

export function buildExportVideoEncodingLogFields(
  plan: ExportVideoEncodingPlan | undefined,
) {
  return compactLogFields({
    "export.encoder.video.mode": plan?.mode,
    "export.encoder.video.codec": plan?.codec,
    "export.encoder.video.target_bitrate_bps": plan?.bitrateBps,
  });
}

export function getEditorExportReadiness({
  exportSource,
  format,
  exporting,
  startTime,
  endTime,
  subtitleEnabled,
  clippedSubtitleCues,
  subtitleLoading,
}: ExportReadinessInput) {
  if (!exportSource.source || exporting) {
    return {
      state: "idle" as const,
      shouldBurnSubtitles: false,
    };
  }

  if (endTime <= startTime) {
    return {
      state: "blocked" as const,
      message: "Waiting for media duration.",
      shouldBurnSubtitles: false,
    };
  }

  const formatDisabledReason = exportFormatDurationDisabledReason(
    format,
    startTime,
    endTime,
  );
  if (formatDisabledReason) {
    return {
      state: "blocked" as const,
      message: formatDisabledReason,
      shouldBurnSubtitles: false,
    };
  }

  const shouldBurnSubtitles =
    !isAudioExportFormat(format) &&
    subtitleEnabled &&
    clippedSubtitleCues.length > 0;

  if (!isAudioExportFormat(format) && subtitleLoading) {
    return {
      state: "blocked" as const,
      message: "Subtitles are still loading.",
      shouldBurnSubtitles,
    };
  }

  return {
    state: "ready" as const,
    source: exportSource.source,
    sourceKind: exportSource.kind,
    shouldBurnSubtitles,
  };
}

export function resolveExportSource({
  preference,
  hlsSource,
  directSource,
  exportFallbackSource,
}: {
  preference: ExportSourcePreference;
  hlsSource?: EditorMediaSource;
  directSource?: EditorMediaSource;
  exportFallbackSource?: EditorMediaSource;
}): ResolvedExportSource {
  if (preference === "direct") {
    return directSource
      ? { source: directSource, kind: "direct" }
      : { source: null, kind: "none" };
  }

  if (preference === "hls") {
    return hlsSource
      ? { source: hlsSource, kind: "hls" }
      : { source: null, kind: "none" };
  }

  if (exportFallbackSource) {
    return {
      source: exportFallbackSource,
      kind: isHlsEditorMediaSource(exportFallbackSource) ? "hls" : "direct",
    };
  }

  if (hlsSource) {
    return { source: hlsSource, kind: "hls" };
  }

  if (directSource) {
    return { source: directSource, kind: "direct" };
  }

  return { source: null, kind: "none" };
}

export function buildExportSourceLabel({
  preference,
  resolvedSourceKind,
  resolvedSource,
  exportFallbackSource,
}: {
  preference: ExportSourcePreference;
  resolvedSourceKind: ResolvedExportSourceKind;
  resolvedSource: EditorMediaSource | null;
  exportFallbackSource?: EditorMediaSource;
}) {
  if (!resolvedSource || resolvedSourceKind === "none") {
    return "Unavailable";
  }

  const label = sourceDisplayLabel(resolvedSource);

  if (preference === "auto" && exportFallbackSource) {
    return `Auto: ${label} fallback`;
  }

  return preference === "auto" ? `Auto: ${label}` : label;
}

export function buildExportSourceMessage({
  preference,
  resolvedSourceKind,
  resolvedSource,
  hlsSource,
  directSource,
  hlsFallbackInfo,
}: {
  preference: ExportSourcePreference;
  resolvedSourceKind: ResolvedExportSourceKind;
  resolvedSource: EditorMediaSource | null;
  hlsSource?: EditorMediaSource;
  directSource?: EditorMediaSource;
  hlsFallbackInfo: PlaybackFallbackInfo | null;
}) {
  if (resolvedSourceKind === "none" || !resolvedSource) {
    return null;
  }

  if (resolvedSource.role === "local-file") {
    return "Export reads this local file in your browser.";
  }

  if (resolvedSource.role === "direct-url") {
    return isHlsEditorMediaSource(resolvedSource)
      ? "Export reads this HLS URL through Cliparr."
      : "Export reads this media URL through Cliparr.";
  }

  if (
    preference === "hls" &&
    resolvedSourceKind === "hls" &&
    !hlsFallbackInfo
  ) {
    return "Export uses the HLS playback stream.";
  }

  if (resolvedSourceKind === "direct" && !hlsSource && directSource) {
    return "Export uses direct media.";
  }

  if (resolvedSourceKind === "direct" && preference !== "auto") {
    return null;
  }

  if (!hlsFallbackInfo) {
    return null;
  }

  const exportUsesDirectSource = resolvedSourceKind === "direct";
  let prefix = "Export still uses HLS; the preview fell back to direct media";
  if (exportUsesDirectSource) {
    prefix = "Export switched to direct media";
  }

  return `${prefix}: ${hlsFallbackInfo.message}`;
}

export function buildExportSourceSummaryMessage({
  preference,
  resolvedSourceKind,
  resolvedSource,
  hlsSource,
}: {
  preference: ExportSourcePreference;
  resolvedSourceKind: ResolvedExportSourceKind;
  resolvedSource: EditorMediaSource | null;
  hlsSource?: EditorMediaSource;
}) {
  if (
    preference === "direct" &&
    resolvedSourceKind === "direct" &&
    resolvedSource?.role === "direct" &&
    hlsSource
  ) {
    return "Using direct media.";
  }

  return null;
}
