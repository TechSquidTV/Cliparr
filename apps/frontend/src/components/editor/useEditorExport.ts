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
import { subtitleTrackSupportsBurnIn } from "../../lib/selectPreferredSubtitleTrack";
import type { SubtitleCue, SubtitleStyleSettings } from "../../lib/subtitles/types";
import type { CurrentlyPlayingItem, PlaybackSubtitleTrack } from "../../providers/types";
import type { ExportSourcePreference } from "./EditorExportDialog";
import type { PlaybackFallbackInfo } from "./useEditorPlayback";

interface VideoDimensions {
  width: number;
  height: number;
}

type ResolvedExportSourceKind = "hls" | "direct" | "none";

interface ResolvedExportSource {
  url: string;
  kind: ResolvedExportSourceKind;
}

interface UseEditorExportProps {
  session: CurrentlyPlayingItem;
  startTime: number;
  endTime: number;
  sourceVideoDimensions: VideoDimensions | null;
  exportFallbackSourceUrl?: string;
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
  exportFallbackSourceUrl,
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
    exportSourcePreference === "direct" && !session.mediaUrl
      ? "auto"
      : exportSourcePreference === "hls" && !session.hlsUrl
        ? "auto"
        : exportSourcePreference;

  const exportSource = useMemo(() => resolveExportSource({
    preference: effectiveExportSourcePreference,
    hlsUrl: session.hlsUrl,
    mediaUrl: session.mediaUrl,
    exportFallbackSourceUrl,
  }), [
    effectiveExportSourcePreference,
    exportFallbackSourceUrl,
    session.hlsUrl,
    session.mediaUrl,
  ]);

  const exportSourceMessage = useMemo(() => buildExportSourceMessage({
    preference: effectiveExportSourcePreference,
    resolvedSourceKind: exportSource.kind,
    hlsUrl: session.hlsUrl,
    mediaUrl: session.mediaUrl,
    hlsFallbackInfo,
  }), [
    effectiveExportSourcePreference,
    exportSource.kind,
    hlsFallbackInfo,
    session.hlsUrl,
    session.mediaUrl,
  ]);

  const exportSourceSummaryMessage = useMemo(() => buildExportSourceSummaryMessage({
    preference: effectiveExportSourcePreference,
    resolvedSourceKind: exportSource.kind,
    hlsUrl: session.hlsUrl,
  }), [
    effectiveExportSourcePreference,
    exportSource.kind,
    session.hlsUrl,
  ]);

  const exportSourceLabel = useMemo(() => buildExportSourceLabel({
    preference: effectiveExportSourcePreference,
    resolvedSourceKind: exportSource.kind,
    exportFallbackSourceUrl,
  }), [
    effectiveExportSourcePreference,
    exportFallbackSourceUrl,
    exportSource.kind,
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
    if (!exportSource.url) return;
    if (exporting) return;

    const shouldBurnSubtitles = subtitleEnabled
      && selectedSubtitleTrack !== null
      && clippedSubtitleCues.length > 0;

    if (shouldBurnSubtitles && subtitleLoading) {
      setExportError("Subtitles are still loading. Please wait a moment and try again.");
      return;
    }

    if (shouldBurnSubtitles && !subtitleTrackSupportsBurnIn(selectedSubtitleTrack)) {
      setExportError("This subtitle track cannot be burned in yet.");
      return;
    }

    setExportError(null);
    setExporting(true);
    setProgress(0);

    try {
      const { exportClip } = await import("../../lib/exportClip");
      const blob = await exportClip({
        mediaUrl: exportSource.url,
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
    exportSource.url,
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

function resolveExportSource({
  preference,
  hlsUrl,
  mediaUrl,
  exportFallbackSourceUrl,
}: {
  preference: ExportSourcePreference;
  hlsUrl?: string;
  mediaUrl?: string;
  exportFallbackSourceUrl?: string;
}): ResolvedExportSource {
  if (preference === "direct") {
    return mediaUrl
      ? { url: mediaUrl, kind: "direct" }
      : { url: "", kind: "none" };
  }

  if (preference === "hls") {
    return hlsUrl
      ? { url: hlsUrl, kind: "hls" }
      : { url: "", kind: "none" };
  }

  if (exportFallbackSourceUrl) {
    return { url: exportFallbackSourceUrl, kind: "direct" };
  }

  if (hlsUrl) {
    return { url: hlsUrl, kind: "hls" };
  }

  if (mediaUrl) {
    return { url: mediaUrl, kind: "direct" };
  }

  return { url: "", kind: "none" };
}

function buildExportSourceLabel({
  preference,
  resolvedSourceKind,
  exportFallbackSourceUrl,
}: {
  preference: ExportSourcePreference;
  resolvedSourceKind: ResolvedExportSourceKind;
  exportFallbackSourceUrl?: string;
}) {
  if (resolvedSourceKind === "hls") {
    return preference === "auto" ? "Auto: HLS playback" : "HLS playback";
  }

  if (resolvedSourceKind === "direct") {
    if (preference === "auto" && exportFallbackSourceUrl) {
      return "Auto: direct fallback";
    }

    return preference === "auto" ? "Auto: direct/original" : "Direct/original";
  }

  return "Unavailable";
}

function buildExportSourceMessage({
  preference,
  resolvedSourceKind,
  hlsUrl,
  mediaUrl,
  hlsFallbackInfo,
}: {
  preference: ExportSourcePreference;
  resolvedSourceKind: ResolvedExportSourceKind;
  hlsUrl?: string;
  mediaUrl?: string;
  hlsFallbackInfo: PlaybackFallbackInfo | null;
}) {
  if (resolvedSourceKind === "none") {
    return null;
  }

  if (preference === "hls" && resolvedSourceKind === "hls" && !hlsFallbackInfo) {
    return "Export will use the HLS playback stream. This follows the media server playback path and can include server-side transcoding.";
  }

  if (resolvedSourceKind === "direct" && !hlsUrl && mediaUrl) {
    return "This session only exposed a direct/original media path, so export will use that source.";
  }

  if (resolvedSourceKind === "direct" && preference !== "auto") {
    return null;
  }

  if (!hlsFallbackInfo) {
    return null;
  }

  const exportUsesDirectSource = resolvedSourceKind === "direct";
  const prefix = exportUsesDirectSource
    ? ({
        "open-or-read": "Export is using the direct media source because Cliparr could not open or read the HLS stream",
        "preview-only": "Export is using the direct media source because Cliparr could not use the HLS stream for this export path",
        "shared-export-blocking": "Export is using the direct media source because Cliparr cannot currently use this HLS stream for export",
      } as const)[hlsFallbackInfo.category]
    : ({
        "open-or-read": "Export will still try the HLS stream even though preview fell back while opening or reading it",
        "preview-only": "Export will still try the HLS stream because this limitation only affects preview in the current browser",
        "shared-export-blocking": "Export cannot currently use this HLS stream",
      } as const)[hlsFallbackInfo.category];

  return `${prefix}: ${hlsFallbackInfo.message}`;
}

function buildExportSourceSummaryMessage({
  preference,
  resolvedSourceKind,
  hlsUrl,
}: {
  preference: ExportSourcePreference;
  resolvedSourceKind: ResolvedExportSourceKind;
  hlsUrl?: string;
}) {
  if (preference === "direct" && resolvedSourceKind === "direct" && hlsUrl) {
    return "Export will use the direct/original media path. Cliparr still uses playback metadata for track and timing hints when it is available.";
  }

  return null;
}
