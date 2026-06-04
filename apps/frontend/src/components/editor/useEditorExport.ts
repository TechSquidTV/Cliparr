import { useCallback, useEffect, useMemo, useState } from "react";
import {
  compactLogFields,
  logDurationFields,
  logErrorFields,
  logEventFields,
} from "@cliparr/shared/logging";
import type { ExportFormat, ExportResolution } from "@/lib/exportClip";
import {
  DEFAULT_GIF_EXPORT_PRESET,
  DEFAULT_VIDEO_EXPORT_QUALITY,
  estimateExportOutputSize,
  gifExportSettingsForPreset,
  exportFormatDurationDisabledReason,
  exportFormatSupportsAudio,
  resolveExportOutputDimensions,
  type ExportQualityPreset,
  type ExportSizeEstimate,
  type GifExportPreset,
  type GifExportSettings,
  type VideoExportQualityPreset,
} from "@/lib/exportTypes";
import {
  buildExportFileName,
  defaultExportFileNameTemplates,
  loadExportFileNameTemplates,
  saveExportFileNameTemplates,
  type ExportFileNameTemplateKind,
  type ExportFileNameTemplateSettings,
} from "@/lib/exportFileName";
import { downloadBlob } from "@/lib/downloadBlob";
import {
  isHlsEditorMediaSource,
  sourceDisplayLabel,
  type EditorMediaSource,
  type EditorSession,
} from "@/lib/editorMedia";
import {
  fetchHlsExportEstimateMetadata,
  type HlsExportEstimateMetadata,
} from "@/lib/hlsExportEstimate";
import { subtitleTrackSupportsBurnIn } from "@/lib/selectPreferredSubtitleTrack";
import type { SubtitleCue, SubtitleStyleSettings } from "@/lib/subtitles/types";
import type { PlaybackSubtitleTrack } from "@/providers/types";
import type { ExportSourcePreference } from "@/components/editor/EditorExportDialog";
import type { PlaybackFallbackInfo } from "@/components/editor/useEditorPlayback";
import { getFrontendLogger, warnWithError } from "@/logging";

interface VideoDimensions {
  width: number;
  height: number;
}

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
  selectedSubtitleTrack: PlaybackSubtitleTrack | null;
  clippedSubtitleCues: readonly SubtitleCue[];
  subtitleLoading: boolean;
}

interface UseEditorExportProps {
  session: EditorSession;
  startTime: number;
  endTime: number;
  sourceVideoDimensions: VideoDimensions | null;
  exportFallbackSource?: EditorMediaSource;
  hlsFallbackInfo: PlaybackFallbackInfo | null;
  subtitleEnabled: boolean;
  selectedSubtitleTrack: PlaybackSubtitleTrack | null;
  clippedSubtitleCues: readonly SubtitleCue[];
  subtitleLoading: boolean;
  subtitleCues: readonly SubtitleCue[];
  subtitleStyleSettings: SubtitleStyleSettings;
}

const logger = getFrontendLogger(["editor", "export"]);

export function useEditorExport({
  session,
  startTime,
  endTime,
  sourceVideoDimensions,
  exportFallbackSource,
  hlsFallbackInfo,
  subtitleEnabled,
  selectedSubtitleTrack,
  clippedSubtitleCues,
  subtitleLoading,
  subtitleCues,
  subtitleStyleSettings,
}: UseEditorExportProps) {
  const [resolution, setResolution] = useState<ExportResolution>("original");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("mp4");
  const [gifPreset, setGifPreset] = useState<GifExportPreset>(
    DEFAULT_GIF_EXPORT_PRESET,
  );
  const [videoQuality, setVideoQuality] = useState<VideoExportQualityPreset>(
    DEFAULT_VIDEO_EXPORT_QUALITY,
  );
  const [exportSourcePreference, setExportSourcePreference] =
    useState<ExportSourcePreference>("auto");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [fileNameTemplates, setFileNameTemplates] =
    useState<ExportFileNameTemplateSettings>(() =>
      loadExportFileNameTemplates(),
    );
  const [templateEditorKind, setTemplateEditorKind] =
    useState<ExportFileNameTemplateKind>("movie");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hlsEstimateMetadata, setHlsEstimateMetadata] =
    useState<HlsExportEstimateMetadata | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportLogger = useMemo(
    () => logger.with({ "editor.session.id": session.id }),
    [session.id],
  );
  const gifSettings = useMemo(
    () => gifExportSettingsForPreset(gifPreset),
    [gifPreset],
  );
  const selectedQuality = exportFormat === "gif" ? gifPreset : videoQuality;
  const audioDisabledReason = exportFormatSupportsAudio(exportFormat)
    ? null
    : "GIF exports are video only.";
  const effectiveIncludeAudio = audioDisabledReason ? false : includeAudio;

  const effectiveExportSourcePreference =
    exportSourcePreference === "direct" && !session.directSource
      ? "auto"
      : exportSourcePreference === "hls" && !session.hlsSource
        ? "auto"
        : exportSourcePreference;

  const exportSource = useMemo(
    () =>
      resolveExportSource({
        preference: effectiveExportSourcePreference,
        hlsSource: session.hlsSource,
        directSource: session.directSource,
        exportFallbackSource,
      }),
    [
      effectiveExportSourcePreference,
      exportFallbackSource,
      session.directSource,
      session.hlsSource,
    ],
  );

  const exportSourceMessage = useMemo(
    () =>
      buildExportSourceMessage({
        preference: effectiveExportSourcePreference,
        resolvedSourceKind: exportSource.kind,
        resolvedSource: exportSource.source,
        hlsSource: session.hlsSource,
        directSource: session.directSource,
        hlsFallbackInfo,
      }),
    [
      effectiveExportSourcePreference,
      exportSource.kind,
      exportSource.source,
      hlsFallbackInfo,
      session.directSource,
      session.hlsSource,
    ],
  );

  const exportSourceSummaryMessage = useMemo(
    () =>
      buildExportSourceSummaryMessage({
        preference: effectiveExportSourcePreference,
        resolvedSourceKind: exportSource.kind,
        resolvedSource: exportSource.source,
        hlsSource: session.hlsSource,
      }),
    [
      effectiveExportSourcePreference,
      exportSource.kind,
      exportSource.source,
      session.hlsSource,
    ],
  );

  const exportSourceLabel = useMemo(
    () =>
      buildExportSourceLabel({
        preference: effectiveExportSourcePreference,
        resolvedSourceKind: exportSource.kind,
        resolvedSource: exportSource.source,
        exportFallbackSource,
      }),
    [
      effectiveExportSourcePreference,
      exportFallbackSource,
      exportSource.kind,
      exportSource.source,
    ],
  );

  const fileName = useMemo(
    () =>
      buildExportFileName({
        title: session.title,
        sessionType: session.type,
        metadata: session.exportMetadata,
        startTime,
        endTime,
        format: exportFormat,
        templates: fileNameTemplates,
      }),
    [
      endTime,
      exportFormat,
      fileNameTemplates,
      session.exportMetadata,
      session.title,
      session.type,
      startTime,
    ],
  );

  const outputDimensions = useMemo(
    () =>
      getOutputDimensions(
        sourceVideoDimensions,
        resolution,
        exportFormat,
        exportFormat === "gif" ? gifSettings : undefined,
      ),
    [exportFormat, gifSettings, resolution, sourceVideoDimensions],
  );

  const shouldEstimateBurnedSubtitles =
    subtitleEnabled &&
    !subtitleLoading &&
    Boolean(selectedSubtitleTrack) &&
    selectedSubtitleTrack !== null &&
    subtitleTrackSupportsBurnIn(selectedSubtitleTrack) &&
    clippedSubtitleCues.length > 0;
  const sourceSizeBytes =
    exportSource.kind === "direct"
      ? (exportSourceSizeBytes(exportSource.source) ??
        session.exportEstimateMetadata?.sourceSizeBytes)
      : null;
  const sourceDurationSeconds =
    exportSource.kind === "direct"
      ? (session.exportEstimateMetadata?.sourceDurationSeconds ??
        session.duration)
      : session.duration;
  const sourceBitrateKbps =
    exportSource.kind !== "none"
      ? session.exportEstimateMetadata?.sourceBitrateKbps
      : null;
  const videoBitrateKbps =
    exportSource.kind !== "none"
      ? session.exportEstimateMetadata?.videoBitrateKbps
      : null;
  const audioBitrateKbps =
    exportSource.kind !== "none"
      ? session.exportEstimateMetadata?.audioBitrateKbps
      : null;
  const hlsManifestBitrateKbps =
    exportSource.kind === "hls" ? hlsEstimateMetadata?.bitrateKbps : null;
  const hlsManifestBitrateBasis =
    exportSource.kind === "hls" ? hlsEstimateMetadata?.bitrateBasis : null;
  const estimateSourceBitrateKbps =
    exportSource.kind === "direct" ? sourceBitrateKbps : null;
  const estimateVideoBitrateKbps =
    exportSource.kind === "direct" ? videoBitrateKbps : null;
  const estimateAudioBitrateKbps =
    exportSource.kind !== "none" ? audioBitrateKbps : null;
  const outputSizeEstimate = useMemo(
    () =>
      estimateExportOutputSize({
        format: exportFormat,
        durationSeconds: Math.max(0, endTime - startTime),
        outputDimensions,
        includeAudio: effectiveIncludeAudio,
        resolution,
        gifSettings: exportFormat === "gif" ? gifSettings : null,
        sourceSizeBytes,
        sourceDurationSeconds,
        sourceBitrateKbps: estimateSourceBitrateKbps,
        videoBitrateKbps: estimateVideoBitrateKbps,
        audioBitrateKbps: estimateAudioBitrateKbps,
        hlsManifestBitrateKbps,
        hlsManifestBitrateBasis,
        includeBurnedSubtitles: shouldEstimateBurnedSubtitles,
        videoQuality: exportFormat === "gif" ? null : videoQuality,
      }),
    [
      effectiveIncludeAudio,
      endTime,
      estimateAudioBitrateKbps,
      estimateSourceBitrateKbps,
      estimateVideoBitrateKbps,
      exportFormat,
      gifSettings,
      hlsManifestBitrateBasis,
      hlsManifestBitrateKbps,
      outputDimensions,
      resolution,
      shouldEstimateBurnedSubtitles,
      sourceDurationSeconds,
      sourceSizeBytes,
      startTime,
      videoQuality,
    ],
  );

  const exportFormatDisabledReason = useMemo(
    () => exportFormatDurationDisabledReason(exportFormat, startTime, endTime),
    [endTime, exportFormat, startTime],
  );

  useEffect(() => {
    saveExportFileNameTemplates(fileNameTemplates);
  }, [fileNameTemplates]);

  useEffect(() => {
    setHlsEstimateMetadata(null);

    if (
      !exportDialogOpen ||
      exportFormat === "gif" ||
      videoQuality !== DEFAULT_VIDEO_EXPORT_QUALITY ||
      exportSource.kind !== "hls" ||
      exportSource.source?.kind !== "url"
    ) {
      return;
    }

    const controller = new AbortController();

    fetchHlsExportEstimateMetadata(
      exportSource.source.url,
      outputDimensions,
      controller.signal,
    )
      .then((metadata) => {
        if (!controller.signal.aborted) {
          setHlsEstimateMetadata(metadata);
        }
      })
      .catch((error: unknown) => {
        const isAbortError =
          error instanceof Error && error.name === "AbortError";
        if (!controller.signal.aborted && !isAbortError) {
          setHlsEstimateMetadata(null);
          warnWithError(
            exportLogger,
            error,
            "Could not fetch HLS export estimate metadata.",
            {
              ...logEventFields("editor.export.hls_estimate", "failure"),
              "export.format": exportFormat,
              "export.source.kind": exportSource.kind,
              "export.source.role": exportSource.source?.role,
              "export.output.width": outputDimensions?.width,
              "export.output.height": outputDimensions?.height,
            },
          );
        }
      });

    return () => {
      controller.abort();
    };
  }, [
    exportDialogOpen,
    exportLogger,
    exportFormat,
    exportSource.kind,
    exportSource.source,
    outputDimensions,
    videoQuality,
  ]);

  const handleOpenExportDialog = useCallback(() => {
    setExportError(null);
    setHlsEstimateMetadata(null);
    setProgress(0);
    setTemplateEditorKind(fileName.templateKind);
    setExportDialogOpen(true);
  }, [fileName.templateKind]);

  const handleCloseExportDialog = useCallback(() => {
    if (exporting) {
      return;
    }

    setExportDialogOpen(false);
    setHlsEstimateMetadata(null);
  }, [exporting]);

  const handleFormatChange = useCallback((nextFormat: ExportFormat) => {
    setExportFormat(nextFormat);
    setHlsEstimateMetadata(null);
    setExportError(null);
  }, []);

  const handleQualityChange = useCallback(
    (nextQuality: ExportQualityPreset) => {
      if (exportFormat === "gif") {
        setGifPreset(nextQuality);
      } else if (nextQuality !== "efficient") {
        setVideoQuality(nextQuality);
      }

      setHlsEstimateMetadata(null);
      setExportError(null);
    },
    [exportFormat],
  );

  const handleResolutionChange = useCallback(
    (nextResolution: ExportResolution) => {
      setResolution(nextResolution);
      setHlsEstimateMetadata(null);
      setExportError(null);
    },
    [],
  );

  const handleExportSourceChange = useCallback(
    (nextSourcePreference: ExportSourcePreference) => {
      setExportSourcePreference(nextSourcePreference);
      setHlsEstimateMetadata(null);
      setExportError(null);
    },
    [],
  );

  const handleAudioChange = useCallback((nextIncludeAudio: boolean) => {
    setIncludeAudio(nextIncludeAudio);
    setExportError(null);
  }, []);

  const handleFileNameTemplateChange = useCallback(
    (kind: ExportFileNameTemplateKind, nextTemplate: string) => {
      setFileNameTemplates((current) => ({
        ...current,
        [kind]: nextTemplate,
      }));
      setExportError(null);
    },
    [],
  );

  const handleResetFileNameTemplate = useCallback(
    (kind: ExportFileNameTemplateKind) => {
      const defaults = defaultExportFileNameTemplates();

      setFileNameTemplates((current) => ({
        ...current,
        [kind]: defaults[kind],
      }));
      setExportError(null);
    },
    [],
  );

  const handleExport = useCallback(async () => {
    const readiness = getEditorExportReadiness({
      exportSource,
      format: exportFormat,
      exporting,
      startTime,
      endTime,
      subtitleEnabled,
      selectedSubtitleTrack,
      clippedSubtitleCues,
      subtitleLoading,
    });

    if (readiness.state === "idle") {
      return;
    }

    if (readiness.state === "blocked") {
      setExportError(readiness.message);
      return;
    }

    const shouldBurnSubtitles = readiness.shouldBurnSubtitles;

    setExportError(null);
    setExporting(true);
    setProgress(0);

    const startedAt = Date.now();
    const estimateFields = buildExportEstimateLogFields({
      estimate: outputSizeEstimate,
      hlsEstimateMetadata,
      sourceSizeBytes,
      sourceDurationSeconds,
      sourceBitrateKbps,
      videoBitrateKbps,
      audioBitrateKbps,
    });
    const baseFields = {
      "export.format": exportFormat,
      "export.quality": selectedQuality,
      "export.resolution": resolution,
      "export.source.kind": readiness.sourceKind,
      "export.source.role": readiness.source.role,
      "export.range.start_seconds": startTime,
      "export.range.end_seconds": endTime,
      "export.range.duration_seconds": Math.max(0, endTime - startTime),
      "export.include_audio": effectiveIncludeAudio,
      "export.subtitle.burn_in": shouldBurnSubtitles,
      "export.subtitle.cue_count": shouldBurnSubtitles
        ? clippedSubtitleCues.length
        : 0,
      "export.output.width": outputDimensions?.width,
      "export.output.height": outputDimensions?.height,
      ...estimateFields,
    };

    exportLogger.info("Editor export started.", {
      ...logEventFields("editor.export", "started"),
      ...baseFields,
    });

    try {
      const { exportClip } = await import("@/lib/exportClip");
      const handleProgress = (nextProgress: number) => {
        setProgress((currentProgress) => {
          const nextPercent = Math.round(nextProgress * 100);
          const currentPercent = Math.round(currentProgress * 100);

          return nextProgress >= 1 || nextPercent !== currentPercent
            ? nextProgress
            : currentProgress;
        });
      };
      const blob = await exportClip({
        mediaSource: readiness.source,
        hls: readiness.sourceKind === "hls",
        startTime,
        endTime,
        format: exportFormat,
        resolution,
        gifSettings: exportFormat === "gif" ? gifSettings : undefined,
        videoQuality: exportFormat === "gif" ? undefined : videoQuality,
        includeAudio: effectiveIncludeAudio,
        selectedAudioTrack: session.selectedAudioTrack,
        metadata: session.exportMetadata,
        includeBurnedSubtitles: shouldBurnSubtitles,
        subtitleCues,
        subtitleStyleSettings,
        onProgress: handleProgress,
      });
      downloadBlob(blob, fileName.fullName);
      setExportDialogOpen(false);

      exportLogger.info("Editor export completed.", {
        ...logEventFields("editor.export", "success"),
        ...logDurationFields(startedAt),
        ...baseFields,
        "export.output.bytes": blob.size,
        ...buildExportEstimateActualLogFields(outputSizeEstimate, blob.size),
      });
    } catch (err) {
      warnWithError(exportLogger, err, "Editor export failed.", {
        ...logEventFields("editor.export", "failure"),
        ...logDurationFields(startedAt),
        ...logErrorFields(err),
        ...baseFields,
      });
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [
    clippedSubtitleCues,
    endTime,
    effectiveIncludeAudio,
    exportFormat,
    exportLogger,
    exportSource,
    exporting,
    fileName.fullName,
    gifSettings,
    outputDimensions,
    outputSizeEstimate,
    resolution,
    selectedSubtitleTrack,
    selectedQuality,
    hlsEstimateMetadata,
    session.exportMetadata,
    session.selectedAudioTrack,
    sourceBitrateKbps,
    sourceDurationSeconds,
    sourceSizeBytes,
    startTime,
    videoQuality,
    videoBitrateKbps,
    audioBitrateKbps,
    subtitleCues,
    subtitleEnabled,
    subtitleLoading,
    subtitleStyleSettings,
  ]);

  return {
    resolution,
    exportFormat,
    selectedQuality,
    gifSettings,
    effectiveExportSourcePreference,
    includeAudio: effectiveIncludeAudio,
    audioDisabledReason,
    fileNameTemplates,
    templateEditorKind,
    setTemplateEditorKind,
    exportDialogOpen,
    exporting,
    progress,
    exportError,
    fileName,
    outputDimensions,
    outputSizeEstimate,
    exportFormatDisabledReason,
    exportSource,
    exportSourceMessage,
    exportSourceSummaryMessage,
    exportSourceLabel,
    handleOpenExportDialog,
    handleCloseExportDialog,
    handleFormatChange,
    handleQualityChange,
    handleResolutionChange,
    handleExportSourceChange,
    handleAudioChange,
    handleFileNameTemplateChange,
    handleResetFileNameTemplate,
    handleExport,
  };
}

export function getOutputDimensions(
  sourceVideoDimensions: VideoDimensions | null,
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

function exportSourceSizeBytes(source: EditorMediaSource | null) {
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

export function getEditorExportReadiness({
  exportSource,
  format,
  exporting,
  startTime,
  endTime,
  subtitleEnabled,
  selectedSubtitleTrack,
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
    subtitleEnabled &&
    selectedSubtitleTrack !== null &&
    clippedSubtitleCues.length > 0;

  if (shouldBurnSubtitles && subtitleLoading) {
    return {
      state: "blocked" as const,
      message: "Subtitles are still loading.",
      shouldBurnSubtitles,
    };
  }

  if (
    shouldBurnSubtitles &&
    !subtitleTrackSupportsBurnIn(selectedSubtitleTrack)
  ) {
    return {
      state: "blocked" as const,
      message: "This subtitle track is not supported.",
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
  const prefix = exportUsesDirectSource
    ? "Export switched to direct media"
    : hlsFallbackInfo.category === "shared-export-blocking"
      ? "Export cannot use this HLS stream"
      : "Trying HLS";

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
