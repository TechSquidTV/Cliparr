import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  clampClipEndTime,
  clampClipStartTime,
  clampPlaybackTime,
  MIN_CLIP_SECONDS,
  roundTimelineTime,
} from "./editorUtils";
import {
  useEditorPlayback,
  type PlaybackFallbackInfo,
} from "./useEditorPlayback";
import { useEditorExport } from "./useEditorExport";
import { useEditorKeyboardShortcuts } from "./useEditorKeyboardShortcuts";
import { useEditorTimeline } from "./useEditorTimeline";
import { EditorHeader } from "./EditorHeader";
import { EditorPreview } from "./EditorPreview";
import { EditorControls } from "./EditorControls";
import { EditorPlaybackSourcePanel } from "./EditorPlaybackSourcePanel";
import { EditorTimeline } from "./EditorTimeline";
import { EditorSubtitlePanel } from "./EditorSubtitlePanel";
import {
  buildClipRangeAfterDurationDiscovery,
  buildInitialClipRange,
} from "./initialClipRange";
import { EDITOR_DESKTOP_LAYOUT_QUERY } from "./editorLayoutSizing";
import {
  EditorDesktopLayout,
  EditorMobileLayout,
  EditorPreviewPane,
  EditorTimelinePane,
} from "./EditorLayout";
import { useEditorSubtitles } from "./useEditorSubtitles";
import { sourceDisplayLabel, type EditorSession } from "../../lib/editorMedia";

const EditorExportDialog = lazy(() =>
  import("./EditorExportDialog").then((module) => ({
    default: module.EditorExportDialog,
  })),
);

interface Props {
  session: EditorSession;
  onBack: () => void;
}

export default function EditorScreen({ session, onBack }: Props) {
  const initialClipRange = buildInitialClipRange(
    session.duration,
    session.initialPlayheadSeconds,
  );
  const [startTime, setStartTime] = useState(() => initialClipRange.startTime);
  const [endTime, setEndTime] = useState(() => initialClipRange.endTime);
  const [playbackSidebarOpen, setPlaybackSidebarOpen] = useState(true);
  const [exportDialogMounted, setExportDialogMounted] = useState(false);
  const {
    subtitleTracks,
    selectedSubtitleTrack,
    selectedSubtitleTrackKey,
    subtitleEnabled,
    setSubtitleEnabled,
    subtitleStyleSettings,
    setSubtitleStyleSettings,
    subtitleCues,
    subtitleLoading,
    subtitleError,
    subtitlePreviewEnabled,
    clippedSubtitleCues,
    subtitleExportSummary,
    handleSelectedSubtitleTrackChange,
  } = useEditorSubtitles({
    session,
    startTime,
    endTime,
  });
  const posterImageUrl = session.thumbUrl;

  const {
    canvasRef,
    currentTime,
    duration,
    playing,
    loadingPreview,
    loadingPreviewFrame,
    previewStatus,
    previewFrameStatus,
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
  const previewSourceLabel =
    activeSourceLabel || (loadingPreview ? "Resolving stream" : "Unavailable");
  const isHlsPreviewSource =
    previewSourceLabel === "HLS stream" || previewSourceLabel === "HLS URL";

  useEffect(() => {
    if (exportDialogOpen) {
      setExportDialogMounted(true);
    }
  }, [exportDialogOpen]);

  const updateClipRange = useCallback(
    (nextStart: number, nextEnd: number) => {
      if (!duration || duration <= 0) return;

      const minClipLength = Math.min(MIN_CLIP_SECONDS, duration);
      const boundedStart = Math.min(
        Math.max(nextStart, 0),
        Math.max(duration - minClipLength, 0),
      );
      const boundedEnd = Math.min(
        Math.max(nextEnd, boundedStart + minClipLength),
        duration,
      );
      const roundedStart = roundTimelineTime(boundedStart);
      const roundedEnd = roundTimelineTime(boundedEnd);

      setStartTime(roundedStart);
      setEndTime(roundedEnd);
    },
    [duration],
  );

  const isValidTimelineRange = useCallback(
    (nextStart: number, nextEnd: number) => {
      const minClipLength = Math.min(MIN_CLIP_SECONDS, duration);
      return (
        duration > 0 &&
        nextStart >= 0 &&
        nextEnd <= duration &&
        nextEnd - nextStart >= minClipLength
      );
    },
    [duration],
  );
  const handlePreviewTimeCommit = useCallback(
    (nextTime: number) => {
      if (!duration || duration <= 0) return;

      void seekToTime(clampPlaybackTime(nextTime, duration));
    },
    [duration, seekToTime],
  );
  const handleStartTimeCommit = useCallback(
    (nextStart: number) => {
      if (!duration || duration <= 0) return;

      const nextClampedStart = clampClipStartTime(nextStart, endTime, duration);
      updateClipRange(nextClampedStart, endTime);
      void warmClipSelection(nextClampedStart, endTime);
    },
    [duration, endTime, updateClipRange, warmClipSelection],
  );
  const handleEndTimeCommit = useCallback(
    (nextEnd: number) => {
      if (!duration || duration <= 0) return;

      const nextClampedEnd = clampClipEndTime(nextEnd, startTime, duration);
      updateClipRange(startTime, nextClampedEnd);
      void warmClipSelection(startTime, nextClampedEnd);
    },
    [duration, startTime, updateClipRange, warmClipSelection],
  );

  const {
    timelineRef,
    timelineWheelRegionRef,
    timelineData,
    timelineEffects,
    activeTimelineScale,
    timelineScaleCount,
    handleTimelineScroll,
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
      updateClipRange(
        discoveredInitialRange.startTime,
        discoveredInitialRange.endTime,
      );
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

  useEditorKeyboardShortcuts({ togglePlay });
  const isDesktopLayout = useEditorDesktopLayout();

  const durationExportDisabledReason = !hasDuration
    ? "Waiting for media duration."
    : null;
  const exportDisabledReason =
    durationExportDisabledReason ?? subtitleExportSummary.disabledReason;
  const headerExportDisabledReason = durationExportDisabledReason;
  const layoutVariant = isDesktopLayout ? "desktop" : "mobile";
  const propertiesActive =
    previewSourceLabel === "Direct source" || Boolean(playbackFallbackReason);
  const previewPane = (
    <EditorPreviewPane
      error={isDesktopLayout ? error : null}
      variant={layoutVariant}
    >
      <EditorPreview
        canvasRef={canvasRef}
        videoDimensions={previewVideoDimensions}
        playing={playing}
        loadingPreview={loadingPreview}
        loadingPreviewFrame={loadingPreviewFrame}
        previewStatus={previewStatus}
        previewFrameStatus={previewFrameStatus}
        togglePlay={togglePlay}
      />
    </EditorPreviewPane>
  );
  const editorControls = (
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
  );
  const editorTimeline = hasDuration ? (
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
  ) : null;
  const timelinePane = (
    <EditorTimelinePane
      variant={layoutVariant}
      controls={editorControls}
      hasDuration={hasDuration}
      timeline={editorTimeline}
    />
  );
  const mobilePlaybackSourcePanel = (
    <EditorPlaybackSourcePanel
      previewSourceLabel={previewSourceLabel}
      fallbackMessage={playbackFallbackReason}
      hasHlsSource={Boolean(session.hlsSource)}
    />
  );

  function renderSubtitlePanel(className: string) {
    if (session.local) {
      return null;
    }

    return (
      <div className={className}>
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
    );
  }

  const propertiesContent = (
    <div className="cliparr-editor-scrollbar flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <EditorPlaybackSourcePanel
        previewSourceLabel={previewSourceLabel}
        fallbackMessage={playbackFallbackReason}
        hasHlsSource={Boolean(session.hlsSource)}
        className="shrink-0 p-0"
      />
      {renderSubtitlePanel("min-h-editor-properties-min flex-1")}
    </div>
  );

  if (!exportSource.source) {
    return (
      <div className="flex h-dvh items-center justify-center overflow-hidden bg-background p-8 text-foreground">
        <div className="text-center">
          <p className="text-destructive mb-4">No exportable stream found.</p>
          <button onClick={onBack} className="text-primary hover:underline">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-editor-workspace text-foreground">
      <EditorHeader
        title={session.title}
        onBack={onBack}
        exporting={exporting}
        progress={progress}
        exportDisabledReason={headerExportDisabledReason}
        onExportClick={handleOpenExportDialog}
      />

      <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2.5 sm:p-3 lg:overflow-hidden">
        {isDesktopLayout ? (
          <EditorDesktopLayout
            playbackSidebarOpen={playbackSidebarOpen}
            onPlaybackSidebarOpenChange={setPlaybackSidebarOpen}
            propertiesActive={propertiesActive}
            previewPane={previewPane}
            timelinePane={timelinePane}
            propertiesContent={propertiesContent}
          />
        ) : (
          <EditorMobileLayout
            error={error}
            playbackSourcePanel={mobilePlaybackSourcePanel}
            previewPane={previewPane}
            timelinePane={timelinePane}
            subtitlePanel={renderSubtitlePanel("min-h-editor-properties-min")}
          />
        )}
      </main>

      {exportDialogMounted && (
        <Suspense fallback={null}>
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
            directSourceLabel={
              session.directSource
                ? sourceDisplayLabel(session.directSource)
                : "Direct/original"
            }
            hlsSourceLabel={
              session.hlsSource
                ? sourceDisplayLabel(session.hlsSource)
                : "HLS playback"
            }
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
        </Suspense>
      )}
    </div>
  );
}

function useEditorDesktopLayout() {
  const [isDesktopLayout, setIsDesktopLayout] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia(EDITOR_DESKTOP_LAYOUT_QUERY).matches;
  });

  useEffect(() => {
    const query = window.matchMedia(EDITOR_DESKTOP_LAYOUT_QUERY);
    const updateLayout = () => setIsDesktopLayout(query.matches);

    updateLayout();
    query.addEventListener("change", updateLayout);
    return () => query.removeEventListener("change", updateLayout);
  }, []);

  return isDesktopLayout;
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
    (activeSourceLabel !== "Direct source" &&
      activeSourceLabel !== "Local file" &&
      activeSourceLabel !== "URL") ||
    !hasHlsSource ||
    !hlsFallbackInfo
  ) {
    return null;
  }

  const prefix =
    hlsFallbackInfo.category === "preview-only"
      ? "Preview switched sources"
      : "Using direct media";

  return `${prefix}: ${hlsFallbackInfo.message}`;
}
