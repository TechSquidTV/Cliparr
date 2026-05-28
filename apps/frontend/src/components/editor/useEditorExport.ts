import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExportFormat, ExportResolution } from "../../lib/exportClip";
import {
  buildExportFileName,
  defaultExportFileNameTemplates,
  loadExportFileNameTemplates,
  saveExportFileNameTemplates,
  type ExportFileNameTemplateKind,
  type ExportFileNameTemplateSettings,
} from "../../lib/exportFileName";
import {
  isHlsEditorMediaSource,
  sourceDisplayLabel,
  type EditorMediaSource,
  type EditorSession,
} from "../../lib/editorMedia";
import { subtitleTrackSupportsBurnIn } from "../../lib/selectPreferredSubtitleTrack";
import type { SubtitleCue, SubtitleStyleSettings } from "../../lib/subtitles/types";
import type { PlaybackSubtitleTrack } from "../../providers/types";
import type { ExportSourcePreference } from "./EditorExportDialog";
import type { PlaybackFallbackInfo } from "./useEditorPlayback";

interface VideoDimensions {
  width: number;
  height: number;
}

type ResolvedExportSourceKind = "hls" | "direct" | "none";

interface ResolvedExportSource {
  source: EditorMediaSource | null;
  kind: ResolvedExportSourceKind;
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
  const [exportSourcePreference, setExportSourcePreference] = useState<ExportSourcePreference>("auto");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [fileNameTemplates, setFileNameTemplates] = useState<ExportFileNameTemplateSettings>(() => loadExportFileNameTemplates());
  const [templateEditorKind, setTemplateEditorKind] = useState<ExportFileNameTemplateKind>("movie");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);

  const effectiveExportSourcePreference =
    exportSourcePreference === "direct" && !session.directSource
      ? "auto"
      : exportSourcePreference === "hls" && !session.hlsSource
        ? "auto"
        : exportSourcePreference;

  const exportSource = useMemo(() => resolveExportSource({
    preference: effectiveExportSourcePreference,
    hlsSource: session.hlsSource,
    directSource: session.directSource,
    exportFallbackSource,
  }), [
    effectiveExportSourcePreference,
    exportFallbackSource,
    session.directSource,
    session.hlsSource,
  ]);

  const exportSourceMessage = useMemo(() => buildExportSourceMessage({
    preference: effectiveExportSourcePreference,
    resolvedSourceKind: exportSource.kind,
    resolvedSource: exportSource.source,
    hlsSource: session.hlsSource,
    directSource: session.directSource,
    hlsFallbackInfo,
  }), [
    effectiveExportSourcePreference,
    exportSource.kind,
    exportSource.source,
    hlsFallbackInfo,
    session.directSource,
    session.hlsSource,
  ]);

  const exportSourceSummaryMessage = useMemo(() => buildExportSourceSummaryMessage({
    preference: effectiveExportSourcePreference,
    resolvedSourceKind: exportSource.kind,
    resolvedSource: exportSource.source,
    hlsSource: session.hlsSource,
  }), [
    effectiveExportSourcePreference,
    exportSource.kind,
    exportSource.source,
    session.hlsSource,
  ]);

  const exportSourceLabel = useMemo(() => buildExportSourceLabel({
    preference: effectiveExportSourcePreference,
    resolvedSourceKind: exportSource.kind,
    resolvedSource: exportSource.source,
    exportFallbackSource,
  }), [
    effectiveExportSourcePreference,
    exportFallbackSource,
    exportSource.kind,
    exportSource.source,
  ]);

  const fileName = useMemo(() => buildExportFileName({
    title: session.title,
    sessionType: session.type,
    metadata: session.exportMetadata,
    startTime,
    endTime,
    format: exportFormat,
    templates: fileNameTemplates,
  }), [
    endTime,
    exportFormat,
    fileNameTemplates,
    session.exportMetadata,
    session.title,
    session.type,
    startTime,
  ]);

  const outputDimensions = useMemo(
    () => getOutputDimensions(sourceVideoDimensions, resolution),
    [resolution, sourceVideoDimensions],
  );

  useEffect(() => {
    saveExportFileNameTemplates(fileNameTemplates);
  }, [fileNameTemplates]);

  const handleOpenExportDialog = useCallback(() => {
    setExportError(null);
    setTemplateEditorKind(fileName.templateKind);
    setExportDialogOpen(true);
  }, [fileName.templateKind]);

  const handleCloseExportDialog = useCallback(() => {
    if (exporting) {
      return;
    }

    setExportDialogOpen(false);
  }, [exporting]);

  const handleFormatChange = useCallback((nextFormat: ExportFormat) => {
    setExportFormat(nextFormat);
    setExportError(null);
  }, []);

  const handleResolutionChange = useCallback((nextResolution: ExportResolution) => {
    setResolution(nextResolution);
    setExportError(null);
  }, []);

  const handleExportSourceChange = useCallback((nextSourcePreference: ExportSourcePreference) => {
    setExportSourcePreference(nextSourcePreference);
    setExportError(null);
  }, []);

  const handleAudioChange = useCallback((nextIncludeAudio: boolean) => {
    setIncludeAudio(nextIncludeAudio);
    setExportError(null);
  }, []);

  const handleFileNameTemplateChange = useCallback((
    kind: ExportFileNameTemplateKind,
    nextTemplate: string
  ) => {
    setFileNameTemplates((current) => ({
      ...current,
      [kind]: nextTemplate,
    }));
    setExportError(null);
  }, []);

  const handleResetFileNameTemplate = useCallback((kind: ExportFileNameTemplateKind) => {
    const defaults = defaultExportFileNameTemplates();

    setFileNameTemplates((current) => ({
      ...current,
      [kind]: defaults[kind],
    }));
    setExportError(null);
  }, []);

  const handleExport = useCallback(async () => {
    if (!exportSource.source) return;
    if (exporting) return;
    if (endTime <= startTime) {
      setExportError("Waiting for media duration.");
      return;
    }

    const shouldBurnSubtitles = subtitleEnabled
      && selectedSubtitleTrack !== null
      && clippedSubtitleCues.length > 0;

    if (shouldBurnSubtitles && subtitleLoading) {
      setExportError("Subtitles are still loading.");
      return;
    }

    if (shouldBurnSubtitles && !subtitleTrackSupportsBurnIn(selectedSubtitleTrack)) {
      setExportError("This subtitle track is not supported.");
      return;
    }

    setExportError(null);
    setExporting(true);
    setProgress(0);

    try {
      const { exportClip } = await import("../../lib/exportClip");
      const blob = await exportClip({
        mediaSource: exportSource.source,
        hls: exportSource.kind === "hls",
        startTime,
        endTime,
        format: exportFormat,
        resolution,
        includeAudio,
        selectedAudioTrack: session.selectedAudioTrack,
        metadata: session.exportMetadata,
        includeBurnedSubtitles: shouldBurnSubtitles,
        subtitleCues,
        subtitleStyleSettings,
        onProgress: setProgress,
      });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = fileName.fullName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportDialogOpen(false);
    } catch (err) {
      console.error(err);
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [
    clippedSubtitleCues,
    endTime,
    exportFormat,
    exportSource.kind,
    exportSource.source,
    exporting,
    fileName.fullName,
    includeAudio,
    resolution,
    selectedSubtitleTrack,
    session.exportMetadata,
    session.selectedAudioTrack,
    startTime,
    subtitleCues,
    subtitleEnabled,
    subtitleLoading,
    subtitleStyleSettings,
  ]);

  return {
    resolution,
    exportFormat,
    effectiveExportSourcePreference,
    includeAudio,
    fileNameTemplates,
    templateEditorKind,
    setTemplateEditorKind,
    exportDialogOpen,
    exporting,
    progress,
    exportError,
    fileName,
    outputDimensions,
    exportSource,
    exportSourceMessage,
    exportSourceSummaryMessage,
    exportSourceLabel,
    handleOpenExportDialog,
    handleCloseExportDialog,
    handleFormatChange,
    handleResolutionChange,
    handleExportSourceChange,
    handleAudioChange,
    handleFileNameTemplateChange,
    handleResetFileNameTemplate,
    handleExport,
  };
}

function getOutputDimensions(
  sourceVideoDimensions: VideoDimensions | null,
  resolution: ExportResolution
) {
  if (!sourceVideoDimensions || sourceVideoDimensions.width <= 0 || sourceVideoDimensions.height <= 0) {
    return null;
  }

  if (resolution === "original") {
    return sourceVideoDimensions;
  }

  const height = parseInt(resolution, 10);
  if (!Number.isFinite(height) || height <= 0) {
    return sourceVideoDimensions;
  }

  const width = Math.max(1, Math.round((sourceVideoDimensions.width / sourceVideoDimensions.height) * height));

  return { width, height };
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
    return { source: exportFallbackSource, kind: isHlsEditorMediaSource(exportFallbackSource) ? "hls" : "direct" };
  }

  if (hlsSource) {
    return { source: hlsSource, kind: "hls" };
  }

  if (directSource) {
    return { source: directSource, kind: "direct" };
  }

  return { source: null, kind: "none" };
}

function buildExportSourceLabel({
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

function buildExportSourceMessage({
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

  if (preference === "hls" && resolvedSourceKind === "hls" && !hlsFallbackInfo) {
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

function buildExportSourceSummaryMessage({
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
    preference === "direct"
    && resolvedSourceKind === "direct"
    && resolvedSource?.role === "direct"
    && hlsSource
  ) {
    return "Using direct media.";
  }

  return null;
}
