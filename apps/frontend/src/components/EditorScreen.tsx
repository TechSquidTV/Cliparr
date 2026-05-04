import { useCallback, useEffect, useState } from "react";
import { MIN_CLIP_SECONDS, roundTimelineTime } from "./editor/EditorUtils";
import { useEditorPlayback } from "./editor/useEditorPlayback";
import { useEditorTimeline } from "./editor/useEditorTimeline";
import { EditorHeader } from "./editor/EditorHeader";
import { EditorExportDialog } from "./editor/EditorExportDialog";
import { EditorPreview } from "./editor/EditorPreview";
import { EditorControls } from "./editor/EditorControls";
import { EditorTimeline } from "./editor/EditorTimeline";
import type { CurrentlyPlayingItem } from "../providers/types";
import type { ExportFormat, ExportResolution } from "../lib/exportClip";
import {
  buildExportFileName,
  defaultExportFileNameTemplates,
  loadExportFileNameTemplates,
  saveExportFileNameTemplates,
  type ExportFileNameTemplateKind,
  type ExportFileNameTemplateSettings,
} from "../lib/exportFileName";

interface Props {
  session: CurrentlyPlayingItem;
  onBack: () => void;
}

interface VideoDimensions {
  width: number;
  height: number;
}

function isInteractiveKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest("input, textarea, select, button, [contenteditable=\"true\"], [role=\"slider\"]"),
  );
}

export default function EditorScreen({ session, onBack }: Props) {
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(() => Math.min(10, Math.max(session.duration, 0)));
  const [resolution, setResolution] = useState<ExportResolution>("original");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("mp4");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [fileNameTemplates, setFileNameTemplates] = useState<ExportFileNameTemplateSettings>(() => loadExportFileNameTemplates());
  const [templateEditorKind, setTemplateEditorKind] = useState<ExportFileNameTemplateKind>("movie");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);

  const {
    canvasRef,
    currentTime,
    duration,
    playing,
    loadingPreview,
    previewStatus,
    error,
    activeSourceLabel,
    exportFallbackSourceUrl,
    sourceVideoDimensions,
    volume,
    muted,
    setVolume,
    setMuted,
    togglePlay,
    pausePlayback,
    seekToTime,
    setCurrentTime,
    playbackTimeAtStartRef,
  } = useEditorPlayback({
    hlsUrl: session.hlsUrl,
    mediaUrl: session.mediaUrl ?? "",
    initialDuration: session.duration,
    startTime,
    endTime,
    sessionId: session.id,
    selectedAudioTrack: session.selectedAudioTrack,
  });
  const exportSourceUrl = exportFallbackSourceUrl ?? session.hlsUrl ?? session.mediaUrl ?? "";
  const usingDirectSourceFallback = Boolean(exportFallbackSourceUrl)
    || (!session.hlsUrl && Boolean(session.mediaUrl));

  const updateClipRange = useCallback((nextStart: number, nextEnd: number) => {
    if (!duration || duration <= 0) return;

    const minClipLength = Math.min(MIN_CLIP_SECONDS, duration);
    const boundedStart = Math.min(Math.max(nextStart, 0), Math.max(duration - minClipLength, 0));
    const boundedEnd = Math.min(Math.max(nextEnd, boundedStart + minClipLength), duration);
    const roundedStart = roundTimelineTime(boundedStart);
    const roundedEnd = roundTimelineTime(boundedEnd);

    setStartTime(roundedStart);
    setEndTime(roundedEnd);
  }, [duration]);

  const isValidTimelineRange = useCallback((nextStart: number, nextEnd: number) => {
    const minClipLength = Math.min(MIN_CLIP_SECONDS, duration);
    return (
      duration > 0 &&
      nextStart >= 0 &&
      nextEnd <= duration &&
      nextEnd - nextStart >= minClipLength
    );
  }, [duration]);

  const {
    timelineRef,
    timelineWheelRegionRef,
    timelineData,
    timelineEffects,
    activeTimelineScale,
    timelineScaleCount,
    handleTimelineScroll,
    handleTimelineWheel,
    handleTimelineChange,
    hasDuration,
  } = useEditorTimeline({
    duration,
    startTime,
    endTime,
    currentTime,
    sessionId: session.id,
    updateClipRange,
  });

  const fileName = buildExportFileName({
    title: session.title,
    sessionType: session.type,
    metadata: session.exportMetadata,
    startTime,
    endTime,
    format: exportFormat,
    templates: fileNameTemplates,
  });

  const outputDimensions = getOutputDimensions(sourceVideoDimensions, resolution);

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
    if (!exportSourceUrl) return;
    if (exporting) return;

    setExportError(null);
    setExporting(true);
    setProgress(0);

    try {
      const { exportClip } = await import("../lib/exportClip");
      const blob = await exportClip({
        mediaUrl: exportSourceUrl,
        startTime,
        endTime,
        format: exportFormat,
        resolution,
        includeAudio,
        selectedAudioTrack: session.selectedAudioTrack,
        metadata: session.exportMetadata,
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
    endTime,
    exportFormat,
    fileName.fullName,
    exporting,
    includeAudio,
    resolution,
    session.exportMetadata,
    session.selectedAudioTrack,
    startTime,
    exportSourceUrl,
  ]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space") {
        return;
      }

      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (isInteractiveKeyboardTarget(event.target)) {
        return;
      }

      event.preventDefault();
      togglePlay();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [togglePlay]);

  if (!exportSourceUrl) {
    return (
      <div className="flex h-dvh items-center justify-center overflow-hidden bg-background p-8 text-foreground">
        <div className="text-center">
          <p className="text-destructive mb-4">Could not find an exportable stream for this session.</p>
          <button onClick={onBack} className="text-primary hover:underline">Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <EditorHeader
        title={session.title}
        onBack={onBack}
        exporting={exporting}
        progress={progress}
        onExportClick={handleOpenExportDialog}
      />

      <main className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
        <div className="flex h-full min-h-0 flex-col gap-3">
          {error && (
            <div className="border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <section className="flex min-h-0 flex-1 items-center justify-center overflow-hidden border border-border bg-card p-3">
            <EditorPreview
              canvasRef={canvasRef}
              activeSourceLabel={activeSourceLabel}
              playing={playing}
              loadingPreview={loadingPreview}
              previewStatus={previewStatus}
              togglePlay={togglePlay}
            />
          </section>

          <section className="shrink-0 overflow-hidden border border-border bg-card text-card-foreground">
            <EditorControls
              playing={playing}
              loadingPreview={loadingPreview}
              togglePlay={togglePlay}
              currentTime={currentTime}
              duration={duration}
              startTime={startTime}
              endTime={endTime}
              muted={muted}
              setMuted={setMuted}
              volume={volume}
              setVolume={setVolume}
            />

            {!hasDuration && (
              <div className="border-t border-border px-3 py-3 text-sm text-muted-foreground">
                Waiting for media duration before clip controls can be adjusted.
              </div>
            )}

            {hasDuration && (
              <EditorTimeline
                timelineRef={timelineRef}
                timelineWheelRegionRef={timelineWheelRegionRef}
                timelineData={timelineData}
                timelineEffects={timelineEffects}
                activeTimelineScale={activeTimelineScale}
                timelineScaleCount={timelineScaleCount}
                loadingPreview={loadingPreview}
                playing={playing}
                handleTimelineScroll={handleTimelineScroll}
                handleTimelineChange={handleTimelineChange}
                handleTimelineWheel={handleTimelineWheel}
                isValidTimelineRange={isValidTimelineRange}
                seekToTime={seekToTime}
                onCursorDragStart={() => {
                  if (playing) pausePlayback();
                }}
                onCursorDrag={(time) => {
                  const nextTime = Math.min(Math.max(time, 0), duration);
                  playbackTimeAtStartRef.current = nextTime;
                  setCurrentTime(nextTime);
                }}
              />
            )}
          </section>
        </div>
      </main>

      <EditorExportDialog
        isOpen={exportDialogOpen}
        title={session.title}
        clipStart={startTime}
        clipEnd={endTime}
        selectedFormat={exportFormat}
        onFormatChange={handleFormatChange}
        selectedResolution={resolution}
        onResolutionChange={handleResolutionChange}
        includeAudio={includeAudio}
        onIncludeAudioChange={handleAudioChange}
        exporting={exporting}
        progress={progress}
        error={exportError}
        fileNamePreview={fileName.fullName}
        outputDimensions={outputDimensions}
        usingDirectSourceFallback={usingDirectSourceFallback}
        activeTemplateKind={fileName.templateKind}
        editingTemplateKind={templateEditorKind}
        onEditingTemplateKindChange={setTemplateEditorKind}
        fileNameTemplates={fileNameTemplates}
        onFileNameTemplateChange={handleFileNameTemplateChange}
        onResetFileNameTemplate={handleResetFileNameTemplate}
        onClose={handleCloseExportDialog}
        onExport={() => void handleExport()}
      />
    </div>
  );
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
