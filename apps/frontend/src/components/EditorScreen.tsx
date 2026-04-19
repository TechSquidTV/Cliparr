import { useCallback, useEffect, useMemo, useState } from "react";
import { MIN_CLIP_SECONDS, roundTimelineTime } from "./editor/EditorUtils";
import { useEditorPlayback } from "./editor/useEditorPlayback";
import { useEditorTimeline } from "./editor/useEditorTimeline";
import { EditorHeader } from "./editor/EditorHeader";
import { EditorExportDialog } from "./editor/EditorExportDialog";
import { EditorPreview } from "./editor/EditorPreview";
import { EditorControls } from "./editor/EditorControls";
import { EditorTimeline } from "./editor/EditorTimeline";
import { EditorSubtitlePanel } from "./editor/EditorSubtitlePanel";
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
import {
  selectPreferredSubtitleTrack,
  subtitleTrackKey,
  subtitleTrackSupportsBurnIn,
} from "../lib/selectPreferredSubtitleTrack";
import {
  loadSubtitleStyleSettings,
  saveSubtitleStyleSettings,
} from "../lib/subtitles/settings";
import { parseSubtitleText } from "../lib/subtitles/parseSubtitleText";
import type { SubtitleCue } from "../lib/subtitles/types";

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
  const [subtitleStyleSettings, setSubtitleStyleSettings] = useState(() => loadSubtitleStyleSettings());
  const [templateEditorKind, setTemplateEditorKind] = useState<ExportFileNameTemplateKind>("movie");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [subtitleEnabled, setSubtitleEnabled] = useState(false);
  const [selectedSubtitleTrackKey, setSelectedSubtitleTrackKey] = useState("none");
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [subtitleLoading, setSubtitleLoading] = useState(false);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);

  const subtitleTracks = useMemo(() => session.subtitleTracks ?? [], [session.subtitleTracks]);
  const selectedSubtitleTrack = useMemo(() => {
    if (selectedSubtitleTrackKey === "none") {
      return null;
    }

    return subtitleTracks.find((track) => subtitleTrackKey(track) === selectedSubtitleTrackKey) ?? null;
  }, [selectedSubtitleTrackKey, subtitleTracks]);
  const subtitlePreviewEnabled = subtitleEnabled
    && subtitleTrackSupportsBurnIn(selectedSubtitleTrack)
    && subtitleCues.length > 0;

  const {
    canvasRef,
    currentTime,
    duration,
    playing,
    loadingPreview,
    previewStatus,
    error,
    activeSourceLabel,
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
    previewUrl: session.previewUrl,
    mediaUrl: session.mediaUrl ?? "",
    initialDuration: session.duration,
    startTime,
    endTime,
    sessionId: session.id,
    selectedAudioTrack: session.selectedAudioTrack,
    subtitleCues,
    subtitlesEnabled: subtitlePreviewEnabled,
    subtitleStyleSettings,
  });

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

  useEffect(() => {
    saveSubtitleStyleSettings(subtitleStyleSettings);
  }, [subtitleStyleSettings]);

  useEffect(() => {
    const preferredSubtitleTrack = selectPreferredSubtitleTrack(subtitleTracks, session.selectedSubtitleTrack);

    setSelectedSubtitleTrackKey(preferredSubtitleTrack ? subtitleTrackKey(preferredSubtitleTrack) : "none");
    setSubtitleEnabled(Boolean(preferredSubtitleTrack && subtitleTrackSupportsBurnIn(preferredSubtitleTrack)));
    setSubtitleCues([]);
    setSubtitleLoading(false);
    setSubtitleError(null);
  }, [
    session.id,
    session.selectedSubtitleTrack,
    subtitleTracks,
  ]);

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();

    async function loadSubtitleCues() {
      if (!subtitleEnabled || !selectedSubtitleTrack) {
        setSubtitleLoading(false);
        setSubtitleCues([]);
        setSubtitleError(null);
        return;
      }

      if (!subtitleTrackSupportsBurnIn(selectedSubtitleTrack) || !selectedSubtitleTrack.contentUrl) {
        setSubtitleLoading(false);
        setSubtitleCues([]);
        setSubtitleError("This subtitle track is not yet supported for styled burn-in.");
        return;
      }

      setSubtitleCues([]);
      setSubtitleLoading(true);
      setSubtitleError(null);

      try {
        const response = await fetch(selectedSubtitleTrack.contentUrl, {
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(`Subtitle download failed (${response.status})`);
        }

        const subtitleText = await response.text();
        const parsedSubtitleCues = parseSubtitleText(
          subtitleText,
          selectedSubtitleTrack.contentFormat
        );

        if (cancelled) {
          return;
        }

        setSubtitleCues(parsedSubtitleCues);
        setSubtitleError(parsedSubtitleCues.length === 0 ? "No subtitle cues were found in this track." : null);
      } catch (err) {
        if (cancelled || abortController.signal.aborted) {
          return;
        }

        console.error("Could not load subtitle cues", err);
        setSubtitleCues([]);
        setSubtitleError(err instanceof Error ? err.message : "Could not load subtitle cues.");
      } finally {
        if (!cancelled) {
          setSubtitleLoading(false);
        }
      }
    }

    void loadSubtitleCues();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [selectedSubtitleTrack, subtitleEnabled]);

  const handleSelectedSubtitleTrackChange = useCallback((value: string) => {
    setSelectedSubtitleTrackKey(value);
    setSubtitleError(null);

    if (value === "none") {
      setSubtitleEnabled(false);
      setSubtitleCues([]);
      return;
    }

    const nextTrack = subtitleTracks.find((track) => subtitleTrackKey(track) === value) ?? null;
    setSubtitleEnabled(Boolean(nextTrack && subtitleTrackSupportsBurnIn(nextTrack)));
  }, [subtitleTracks]);

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
    if (!session.mediaUrl) return;
    if (exporting) return;

    const shouldBurnSubtitles = subtitleEnabled && selectedSubtitleTrack !== null;

    if (shouldBurnSubtitles && subtitleLoading) {
      setExportError("Subtitles are still loading. Please wait a moment and try again.");
      return;
    }

    if (shouldBurnSubtitles && !subtitleTrackSupportsBurnIn(selectedSubtitleTrack)) {
      setExportError("This subtitle track cannot be burned in yet.");
      return;
    }

    if (shouldBurnSubtitles && subtitleCues.length === 0) {
      setExportError(subtitleError ?? "No subtitle cues are available for export.");
      return;
    }

    setExportError(null);
    setExporting(true);
    setProgress(0);

    try {
      const { exportClip } = await import("../lib/exportClip");
      const blob = await exportClip({
        mediaUrl: session.mediaUrl,
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
    endTime,
    exportFormat,
    fileName.fullName,
    exporting,
    includeAudio,
    resolution,
    session.exportMetadata,
    session.mediaUrl,
    session.selectedAudioTrack,
    startTime,
    subtitleCues,
    subtitleEnabled,
    subtitleError,
    subtitleLoading,
    subtitleStyleSettings,
    selectedSubtitleTrack,
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

  if (!session.mediaUrl) {
    return (
      <div className="flex h-dvh items-center justify-center overflow-hidden bg-background p-8 text-foreground">
        <div className="text-center">
          <p className="text-destructive mb-4">Could not find media file for this session.</p>
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
        <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="flex min-h-0 flex-col gap-3">
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

          <div className="min-h-0 overflow-hidden">
            <EditorSubtitlePanel
              subtitleTracks={subtitleTracks}
              selectedSubtitleTrackKey={selectedSubtitleTrackKey}
              onSelectedSubtitleTrackKeyChange={handleSelectedSubtitleTrackChange}
              subtitlesEnabled={subtitleEnabled}
              onSubtitlesEnabledChange={setSubtitleEnabled}
              subtitleStyleSettings={subtitleStyleSettings}
              onSubtitleStyleSettingsChange={setSubtitleStyleSettings}
              subtitleLoading={subtitleLoading}
              subtitleError={subtitleError}
              selectedSubtitleTrack={selectedSubtitleTrack}
            />
          </div>
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
