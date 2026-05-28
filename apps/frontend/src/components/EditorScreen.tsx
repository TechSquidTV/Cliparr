import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye } from "lucide-react";
import {
  clampClipEndTime,
  clampClipStartTime,
  clampPlaybackTime,
  MIN_CLIP_SECONDS,
  roundTimelineTime,
} from "./editor/EditorUtils";
import { useEditorPlayback, type PlaybackFallbackInfo } from "./editor/useEditorPlayback";
import { useEditorExport } from "./editor/useEditorExport";
import { useEditorKeyboardShortcuts } from "./editor/useEditorKeyboardShortcuts";
import { useEditorTimeline } from "./editor/useEditorTimeline";
import { EditorHeader } from "./editor/EditorHeader";
import { EditorExportDialog } from "./editor/EditorExportDialog";
import { EditorPreview } from "./editor/EditorPreview";
import { EditorControls } from "./editor/EditorControls";
import { EditorSidebar } from "./editor/EditorSidebar";
import { EditorPlaybackSourcePanel } from "./editor/EditorPlaybackSourcePanel";
import { EditorTimeline } from "./editor/EditorTimeline";
import { EditorSubtitlePanel } from "./editor/EditorSubtitlePanel";
import { buildSubtitleExportSummary } from "./editor/subtitleExportSummary";
import {
  buildClipRangeAfterDurationDiscovery,
  buildInitialClipRange,
} from "./editor/initialClipRange";
import { useSubtitleCues } from "./editor/useSubtitleCues";
import type { PlaybackSubtitleTrack } from "../providers/types";
import { sourceDisplayLabel, type EditorSession } from "../lib/editorMedia";
import {
  selectPreferredSubtitleTrack,
  subtitleTrackKey,
  subtitleTrackSupportsBurnIn,
} from "../lib/selectPreferredSubtitleTrack";
import {
  loadSubtitleStyleSettings,
  saveSubtitleStyleSettings,
} from "../lib/subtitles/settings";
import { trimSubtitleCues } from "../lib/subtitles/trimSubtitleCues";

interface Props {
  session: EditorSession;
  onBack: () => void;
}

export default function EditorScreen({ session, onBack }: Props) {
  const initialClipRange = buildInitialClipRange(session.duration, session.initialPlayheadSeconds);
  const [startTime, setStartTime] = useState(() => initialClipRange.startTime);
  const [endTime, setEndTime] = useState(() => initialClipRange.endTime);
  const [subtitleStyleSettings, setSubtitleStyleSettings] = useState(() => loadSubtitleStyleSettings());
  const [playbackSidebarOpen, setPlaybackSidebarOpen] = useState(true);
  const [subtitleEnabled, setSubtitleEnabled] = useState(false);
  const [selectedSubtitleTrackKey, setSelectedSubtitleTrackKey] = useState("none");

  const subtitleTracks = useMemo<PlaybackSubtitleTrack[]>(
    () => session.local
      ? []
      : (session.subtitleTracks ?? []).filter((track) => subtitleTrackSupportsBurnIn(track)),
    [session.local, session.subtitleTracks]
  );
  const selectedSubtitleTrack = useMemo(() => {
    if (selectedSubtitleTrackKey === "none") {
      return null;
    }

    return subtitleTracks.find((track) => subtitleTrackKey(track) === selectedSubtitleTrackKey) ?? null;
  }, [selectedSubtitleTrackKey, subtitleTracks]);
  const {
    subtitleCues,
    subtitleLoading,
    subtitleError,
    resetSubtitleCues,
    clearSubtitleError,
  } = useSubtitleCues({
    selectedSubtitleTrack,
    subtitleEnabled,
    providerId: session.source.providerId,
  });
  const subtitlePreviewEnabled = subtitleEnabled
    && subtitleTrackSupportsBurnIn(selectedSubtitleTrack)
    && subtitleCues.length > 0;
  const clippedSubtitleCues = useMemo(
    () => subtitleEnabled ? trimSubtitleCues(subtitleCues, startTime, endTime) : [],
    [endTime, startTime, subtitleCues, subtitleEnabled]
  );
  const subtitleExportSummary = useMemo(() => buildSubtitleExportSummary({
    selectedSubtitleTrack,
    subtitleEnabled,
    subtitleTrackCount: subtitleTracks.length,
    clippedSubtitleCueCount: clippedSubtitleCues.length,
    subtitleLoading,
    subtitleError,
    providerId: session.source.providerId,
  }), [
    selectedSubtitleTrack,
    subtitleEnabled,
    subtitleTracks.length,
    clippedSubtitleCues.length,
    subtitleLoading,
    subtitleError,
    session.source.providerId,
  ]);
  const posterImageUrl = session.thumbUrl;

  const {
    canvasRef,
    currentTime,
    duration,
    playing,
    loadingPreview,
    previewStatus,
    error,
    activeSourceLabel,
    exportFallbackSource,
    hlsFallbackInfo,
    sourceVideoDimensions,
    previewVideoDimensions,
    playbackReadyRange,
    volume,
    muted,
    setVolume,
    setMuted,
    togglePlay,
    pausePlayback,
    seekToTime,
    warmClipSelection,
    setCurrentTime,
    playbackTimeAtStartRef,
  } = useEditorPlayback({
    hlsSource: session.hlsSource,
    directSource: session.directSource,
    initialDuration: session.duration,
    initialCurrentTime: initialClipRange.startTime,
    startTime,
    endTime,
    sessionId: session.id,
    selectedAudioTrack: session.selectedAudioTrack,
    posterImageUrl,
    subtitleCues,
    subtitlesEnabled: subtitlePreviewEnabled,
    subtitleStyleSettings,
  });
  const {
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
  } = useEditorExport({
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
  });
  const playbackFallbackReason = buildPlaybackFallbackReason({
    activeSourceLabel,
    hasHlsSource: Boolean(session.hlsSource),
    hlsFallbackInfo,
  });
  const previewSourceLabel = activeSourceLabel || (loadingPreview ? "Resolving stream" : "Unavailable");
  const isHlsPreviewSource = previewSourceLabel === "HLS stream" || previewSourceLabel === "HLS URL";

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
  const handlePreviewTimeCommit = useCallback((nextTime: number) => {
    if (!duration || duration <= 0) return;

    void seekToTime(clampPlaybackTime(nextTime, duration));
  }, [duration, seekToTime]);
  const handleStartTimeCommit = useCallback((nextStart: number) => {
    if (!duration || duration <= 0) return;

    const nextClampedStart = clampClipStartTime(nextStart, endTime, duration);
    updateClipRange(nextClampedStart, endTime);
    void warmClipSelection(nextClampedStart, endTime);
  }, [duration, endTime, updateClipRange, warmClipSelection]);
  const handleEndTimeCommit = useCallback((nextEnd: number) => {
    if (!duration || duration <= 0) return;

    const nextClampedEnd = clampClipEndTime(nextEnd, startTime, duration);
    updateClipRange(startTime, nextClampedEnd);
    void warmClipSelection(startTime, nextClampedEnd);
  }, [duration, startTime, updateClipRange, warmClipSelection]);

  const {
    timelineRef,
    timelineWheelRegionRef,
    timelineData,
    timelineEffects,
    activeTimelineScale,
    timelineScaleCount,
    handleTimelineScroll,
    handleTimelineWheel,
    handleTimelineZoomIn,
    handleTimelineZoomOut,
    canZoomIn,
    canZoomOut,
    handleTimelineChange,
    handleTimelineActionMoveEnd,
    handleTimelineActionResizeEnd,
    hasDuration,
  } = useEditorTimeline({
    duration,
    startTime,
    endTime,
    currentTime,
    sessionId: session.id,
    updateClipRange,
    onClipRangeCommit: (nextStart, nextEnd) => {
      void warmClipSelection(nextStart, nextEnd);
    },
  });

  useEffect(() => {
    if (!duration || duration <= 0) {
      return;
    }

    const discoveredInitialRange = buildClipRangeAfterDurationDiscovery({
      initialDuration: session.duration,
      currentStartTime: startTime,
      currentEndTime: endTime,
      discoveredDuration: duration,
      playheadSeconds: session.initialPlayheadSeconds,
    });
    if (discoveredInitialRange) {
      updateClipRange(discoveredInitialRange.startTime, discoveredInitialRange.endTime);
      return;
    }

    if (isValidTimelineRange(startTime, endTime)) {
      return;
    }

    updateClipRange(startTime, endTime);
  }, [
    duration,
    endTime,
    isValidTimelineRange,
    session.duration,
    session.initialPlayheadSeconds,
    startTime,
    updateClipRange,
  ]);

  useEffect(() => {
    saveSubtitleStyleSettings(subtitleStyleSettings);
  }, [subtitleStyleSettings]);

  useEffect(() => {
    const preferredSubtitleTrack = selectPreferredSubtitleTrack(subtitleTracks, session.selectedSubtitleTrack);

    setSelectedSubtitleTrackKey(preferredSubtitleTrack ? subtitleTrackKey(preferredSubtitleTrack) : "none");
    setSubtitleEnabled(Boolean(preferredSubtitleTrack && subtitleTrackSupportsBurnIn(preferredSubtitleTrack)));
    resetSubtitleCues();
  }, [
    session.id,
    session.selectedSubtitleTrack,
    subtitleTracks,
    resetSubtitleCues,
  ]);

  const handleSelectedSubtitleTrackChange = useCallback((value: string) => {
    setSelectedSubtitleTrackKey(value);
    clearSubtitleError();

    if (value === "none") {
      setSubtitleEnabled(false);
      resetSubtitleCues();
      return;
    }

    const nextTrack = subtitleTracks.find((track) => subtitleTrackKey(track) === value) ?? null;
    setSubtitleEnabled(Boolean(nextTrack && subtitleTrackSupportsBurnIn(nextTrack)));
  }, [clearSubtitleError, resetSubtitleCues, subtitleTracks]);

  useEditorKeyboardShortcuts({ togglePlay });

  const durationExportDisabledReason = !hasDuration
    ? "Waiting for media duration."
    : null;
  const exportDisabledReason = durationExportDisabledReason ?? subtitleExportSummary.disabledReason;

  if (!exportSource.source) {
    return (
      <div className="flex h-dvh items-center justify-center overflow-hidden bg-background p-8 text-foreground">
        <div className="text-center">
          <p className="text-destructive mb-4">No exportable stream found.</p>
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
        exportDisabledReason={exportDisabledReason}
        onExportClick={handleOpenExportDialog}
      />

      <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-4 lg:overflow-hidden">
        <div className="flex min-h-full flex-col gap-3 lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-h-0 flex-col gap-3">
            {error && (
              <div className="border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="lg:hidden">
              <EditorPlaybackSourcePanel
                previewSourceLabel={previewSourceLabel}
                fallbackMessage={playbackFallbackReason}
                hasHlsSource={Boolean(session.hlsSource)}
              />
            </div>

            <section className="flex min-h-[12rem] flex-none items-center justify-center overflow-hidden border border-border bg-card p-3 sm:min-h-[16rem] lg:min-h-0 lg:flex-1">
              <EditorPreview
                canvasRef={canvasRef}
                videoDimensions={previewVideoDimensions}
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
                handleTimelineZoomIn={handleTimelineZoomIn}
                handleTimelineZoomOut={handleTimelineZoomOut}
                canZoomIn={canZoomIn}
                canZoomOut={canZoomOut}
                onPreviewTimeCommit={handlePreviewTimeCommit}
                onStartTimeCommit={handleStartTimeCommit}
                onEndTimeCommit={handleEndTimeCommit}
              />

              {!hasDuration && (
                <div className="border-t border-border px-3 py-3 text-sm text-muted-foreground">
                  Waiting for media duration.
                </div>
              )}

              {hasDuration && (
                <>
                  <EditorTimeline
                    timelineRef={timelineRef}
                    timelineWheelRegionRef={timelineWheelRegionRef}
                    timelineData={timelineData}
                    timelineEffects={timelineEffects}
                    activeTimelineScale={activeTimelineScale}
                    timelineScaleCount={timelineScaleCount}
                    playbackReadyRange={isHlsPreviewSource ? playbackReadyRange : null}
                    loadingPreview={loadingPreview}
                    playing={playing}
                    handleTimelineScroll={handleTimelineScroll}
                    handleTimelineChange={handleTimelineChange}
                    handleTimelineActionMoveEnd={handleTimelineActionMoveEnd}
                    handleTimelineActionResizeEnd={handleTimelineActionResizeEnd}
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
                </>
              )}
            </section>

            {!session.local && (
              <div className="min-h-[28rem] lg:hidden">
                <EditorSubtitlePanel
                  providerId={session.source.providerId}
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
            )}
          </div>

          <div className="hidden min-h-0 lg:block">
            <EditorSidebar
              open={playbackSidebarOpen}
              onOpenChange={setPlaybackSidebarOpen}
              title="Properties"
              icon={Eye}
              active={previewSourceLabel === "Direct source" || Boolean(playbackFallbackReason)}
            >
              <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
                <EditorPlaybackSourcePanel
                  previewSourceLabel={previewSourceLabel}
                  fallbackMessage={playbackFallbackReason}
                  hasHlsSource={Boolean(session.hlsSource)}
                  className="shrink-0 p-0"
                />
                {!session.local && (
                  <div className="min-h-[28rem] flex-1">
                    <EditorSubtitlePanel
                      providerId={session.source.providerId}
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
                )}
              </div>
            </EditorSidebar>
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
        selectedSourcePreference={effectiveExportSourcePreference}
        onSourcePreferenceChange={handleExportSourceChange}
        includeAudio={includeAudio}
        onIncludeAudioChange={handleAudioChange}
        exporting={exporting}
        progress={progress}
        error={exportError}
        fileNamePreview={fileName.fullName}
        outputDimensions={outputDimensions}
        hasHlsSource={Boolean(session.hlsSource)}
        hasDirectSource={Boolean(session.directSource)}
        directSourceLabel={session.directSource ? sourceDisplayLabel(session.directSource) : "Direct/original"}
        hlsSourceLabel={session.hlsSource ? sourceDisplayLabel(session.hlsSource) : "HLS playback"}
        exportSourceLabel={exportSourceLabel}
        exportSourceMessage={exportSourceMessage}
        exportSourceSummaryMessage={exportSourceSummaryMessage}
        subtitleSummaryLabel={subtitleExportSummary.label}
        subtitleSummaryDetail={subtitleExportSummary.detail}
        subtitleSummaryTone={subtitleExportSummary.tone}
        exportDisabledReason={exportDisabledReason}
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

function buildPlaybackFallbackReason({
  activeSourceLabel,
  hasHlsSource,
  hlsFallbackInfo,
}: {
  activeSourceLabel: string;
  hasHlsSource: boolean;
  hlsFallbackInfo: PlaybackFallbackInfo | null;
}) {
  if (
    (activeSourceLabel !== "Direct source" && activeSourceLabel !== "Local file" && activeSourceLabel !== "URL")
    || !hasHlsSource
    || !hlsFallbackInfo
  ) {
    return null;
  }

  const prefix = hlsFallbackInfo.category === "preview-only"
    ? "Preview switched sources"
    : "Using direct media";

  return `${prefix}: ${hlsFallbackInfo.message}`;
}
