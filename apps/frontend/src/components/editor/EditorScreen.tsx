import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  TimelineProvider,
  fromSeconds,
  toSeconds,
  useTimelinePlayback,
  useTimelineZoomControl,
  useTimelineViewport,
  type TimelineEngine,
} from "@techsquidtv/canvas-timeline";
import {
  clampClipEndTime,
  clampClipStartTime,
  clampPlaybackTime,
} from "@/components/editor/editorUtilities";
import {
  EDITOR_LARGE_SEEK_SECONDS,
  EDITOR_SMALL_SEEK_SECONDS,
  resolveRelativeSeekTime,
} from "@/components/editor/editorShortcutCommands";
import type { PlaybackFallbackInfo } from "@/components/editor/editorPlaybackSources";
import { useEditorExport } from "@/components/editor/useEditorExport";
import { useEditorKeyboardShortcuts } from "@/components/editor/useEditorKeyboardShortcuts";
import { useEditorTimelineMedia } from "@/components/editor/useEditorTimelineMedia";
import {
  createEditorTimelineEngine,
  synchronizeEditorTimelineSession,
} from "@/components/editor/editorTimelineEngine";
import { EditorHeader } from "@/components/editor/EditorHeader";
import { EditorPreview } from "@/components/editor/EditorPreview";
import { EditorSubtitlePreview } from "@/components/editor/EditorSubtitlePreview";
import { EditorControls } from "@/components/editor/EditorControls";
import { EditorPlaybackSourcePanel } from "@/components/editor/EditorPlaybackSourcePanel";
import { EditorTimeline } from "@/components/editor/EditorTimeline";
import { EditorSubtitlePanel } from "@/components/editor/EditorSubtitlePanel";
import { EDITOR_DESKTOP_LAYOUT_QUERY } from "@/components/editor/editorLayoutSizing";
import {
  EditorDesktopLayout,
  EditorMobileLayout,
  EditorPreviewPane,
  EditorTimelinePane,
} from "@/components/editor/EditorLayout";
import { useEditorFramegrab } from "@/components/editor/useEditorFramegrab";
import { useEditorSubtitles } from "@/components/editor/useEditorSubtitles";
import {
  loadEditorPropertiesOpenSections,
  saveEditorPropertiesOpenSections,
} from "@/components/editor/editorSidebarPreferences";
import { sourceDisplayLabel, type EditorSession } from "@/lib/editorMedia";
import { EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME } from "@/lib/viewTransitions";

const EditorExportDialog = lazy(() =>
  import("@/components/editor/EditorExportDialog").then((module) => ({
    default: module.EditorExportDialog,
  })),
);

const EditorFramegrabDialog = lazy(() =>
  import("@/components/editor/EditorFramegrabDialog").then((module) => ({
    default: module.EditorFramegrabDialog,
  })),
);

interface Properties {
  session: EditorSession;
  onBack: () => void;
}

export default function EditorScreen({ session, onBack }: Properties) {
  return (
    <EditorSessionScreen key={session.id} session={session} onBack={onBack} />
  );
}

function EditorSessionScreen({ session, onBack }: Properties) {
  const [engine] = useState(() => createEditorTimelineEngine(session));
  const previousSessionReference = useRef(session);

  useLayoutEffect(() => {
    const previousSession = previousSessionReference.current;
    previousSessionReference.current = session;
    if (previousSession === session) {
      return;
    }

    synchronizeEditorTimelineSession(engine, previousSession, session);
  }, [engine, session]);

  return (
    <TimelineProvider engine={engine}>
      <EditorScreenContent session={session} onBack={onBack} engine={engine} />
    </TimelineProvider>
  );
}

function EditorScreenContent({
  session,
  onBack,
  engine,
}: Properties & { engine: TimelineEngine }) {
  const { inPoint, outPoint, setInPoint, setOutPoint, clearInOutPoints } =
    useTimelinePlayback();
  const timelineMedia = useEditorTimelineMedia(session, engine);
  const duration = timelineMedia.duration;
  const startTime = inPoint ? toSeconds(inPoint) : 0;
  const endTime = outPoint ? toSeconds(outPoint) : duration;
  const [playbackSidebarOpen, setPlaybackSidebarOpen] = useState(true);
  const [editorPropertiesOpenSections, setEditorPropertiesOpenSections] =
    useState(loadEditorPropertiesOpenSections);
  const [exportDialogMounted, setExportDialogMounted] = useState(false);
  const {
    subtitleTracks,
    selectedSubtitleTrack,
    selectedSubtitleTrackKey,
    subtitleEnabled,
    subtitleOutputEnabled,
    subtitleCuesReady,
    setSubtitleEnabled,
    subtitleStyleSettings,
    setSubtitleStyleSettings,
    subtitleCues,
    subtitleLoading,
    subtitleError,
    clippedSubtitleCues,
    subtitleExportSummary,
    handleSelectedSubtitleTrackChange,
    selectedSubtitleCue,
    handleSelectedSubtitleTextCommit,
    handleSelectedSubtitleStartCommit,
    handleSelectedSubtitleEndCommit,
    handleDeleteSelectedSubtitle,
    handleSelectPreviousSubtitle,
    handleSelectNextSubtitle,
    handleSeekToSelectedSubtitle,
  } = useEditorSubtitles({
    engine,
    session,
    startTime,
    endTime,
    duration,
    mediaReady: timelineMedia.metadataReady,
  });
  const posterImageUrl = session.thumbUrl;

  const {
    canvasRef,
    connectCanvas,
    currentTime,
    renderedFrameTime,
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
    frameStepSeconds,
    volume,
    muted,
    setVolume,
    setMuted,
    togglePlay,
    pausePlayback,
    seekToTime,
    getPlaybackTime,
  } = timelineMedia;

  useEffect(() => {
    saveEditorPropertiesOpenSections(editorPropertiesOpenSections);
  }, [editorPropertiesOpenSections]);
  const {
    resolution,
    exportFormat,
    selectedQuality,
    gifSettings,
    effectiveExportSourcePreference,
    includeAudio,
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
  } = useEditorExport({
    session,
    exportMedia: timelineMedia.exportMedia,
    startTime,
    endTime,
    sourceVideoDimensions,
    exportFallbackSource,
    hlsFallbackInfo,
    subtitleEnabled: subtitleOutputEnabled,
    selectedSubtitleTrack,
    clippedSubtitleCues,
    subtitleLoading,
    subtitleCues,
    subtitleStyleSettings,
  });
  const subtitleCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewFrameTime = renderedFrameTime ?? currentTime;
  const getFramegrabTime = useCallback(
    () => renderedFrameTime ?? getPlaybackTime(),
    [getPlaybackTime, renderedFrameTime],
  );
  const framegrab = useEditorFramegrab({
    session,
    canvasRef,
    subtitleCanvasRef,
    currentTime: previewFrameTime,
    loadingPreview,
    loadingPreviewFrame,
    previewVideoDimensions,
    subtitleEnabled: subtitleOutputEnabled,
    subtitleLoading,
    subtitleError,
    getCurrentTime: getFramegrabTime,
  });
  const playbackFallbackReason = buildPlaybackFallbackReason({
    activeSourceLabel,
    hasHlsSource: Boolean(session.hlsSource),
    hlsFallbackInfo,
  });
  const previewSourceLabel =
    activeSourceLabel || (loadingPreview ? "Resolving stream" : "Unavailable");

  useEffect(() => {
    if (exportDialogOpen) {
      setExportDialogMounted(true);
    }
  }, [exportDialogOpen]);

  const { viewportWidth, setZoomScale, setScrollLeft } = useTimelineViewport();
  const handleFitSelection = () => {
    if (viewportWidth <= 0 || endTime <= startTime) {
      return;
    }
    const padding = Math.min(24, viewportWidth / 4);
    const scale = Math.min(
      1000,
      (viewportWidth - padding * 2) / (endTime - startTime),
    );
    setZoomScale(scale);
    setScrollLeft(Math.max(0, startTime * scale - padding));
  };
  const zoomControl = useTimelineZoomControl({ min: 10, max: 1000 });
  const hasDuration = timelineMedia.metadataReady && duration > 0;
  const canZoomOut = zoomControl.value > zoomControl.min;
  const canZoomIn = zoomControl.value < zoomControl.max;
  const handleTimelineZoomOut = useCallback(() => {
    zoomControl.commit(Math.max(zoomControl.min, zoomControl.value / 1.25));
  }, [zoomControl]);
  const handleTimelineZoomIn = useCallback(() => {
    zoomControl.commit(Math.min(zoomControl.max, zoomControl.value * 1.25));
  }, [zoomControl]);
  const handlePreviewTimeCommit = useCallback(
    (nextTime: number) => {
      if (!duration || duration <= 0) {
        return;
      }

      seekToTime(clampPlaybackTime(nextTime, duration));
    },
    [duration, seekToTime],
  );
  const handleStartTimeCommit = useCallback(
    (nextStart: number) => {
      if (!duration || duration <= 0) {
        return;
      }

      const nextClampedStart = clampClipStartTime(nextStart, endTime, duration);
      setInPoint(fromSeconds(nextClampedStart));
    },
    [duration, endTime, setInPoint],
  );
  const handleEndTimeCommit = useCallback(
    (nextEnd: number) => {
      if (!duration || duration <= 0) {
        return;
      }

      const nextClampedEnd = clampClipEndTime(nextEnd, startTime, duration);
      setOutPoint(fromSeconds(nextClampedEnd));
    },
    [duration, setOutPoint, startTime],
  );
  const handleMarkInShortcut = useCallback(() => {
    if (!duration || duration <= 0) {
      return;
    }

    const nextStart = clampClipStartTime(getPlaybackTime(), endTime, duration);
    setInPoint(fromSeconds(nextStart));
  }, [duration, endTime, getPlaybackTime, setInPoint]);
  const handleMarkOutShortcut = useCallback(() => {
    if (!duration || duration <= 0) {
      return;
    }

    const nextEnd = clampClipEndTime(getPlaybackTime(), startTime, duration);
    setOutPoint(fromSeconds(nextEnd));
  }, [duration, getPlaybackTime, setOutPoint, startTime]);
  const handleClearInOutPoints = useCallback(() => {
    clearInOutPoints();
  }, [clearInOutPoints]);
  const handleJumpToInShortcut = useCallback(() => {
    if (!duration || duration <= 0) {
      return;
    }

    seekToTime(clampPlaybackTime(startTime, duration));
  }, [duration, seekToTime, startTime]);
  const handleJumpToOutShortcut = useCallback(() => {
    if (!duration || duration <= 0) {
      return;
    }

    seekToTime(clampPlaybackTime(endTime, duration));
  }, [duration, endTime, seekToTime]);
  const seekByShortcut = useCallback(
    (deltaSeconds: number) => {
      if (!duration || duration <= 0) {
        return;
      }

      seekToTime(
        resolveRelativeSeekTime({
          currentTime: getPlaybackTime(),
          deltaSeconds,
          duration,
        }),
      );
    },
    [duration, getPlaybackTime, seekToTime],
  );
  const stepFrameByShortcut = useCallback(
    (direction: -1 | 1) => {
      if (!duration || duration <= 0) {
        return;
      }

      const nextTime = resolveRelativeSeekTime({
        currentTime: getPlaybackTime(),
        deltaSeconds: frameStepSeconds * direction,
        duration,
      });
      pausePlayback();
      seekToTime(nextTime);
    },
    [duration, frameStepSeconds, getPlaybackTime, pausePlayback, seekToTime],
  );
  useEditorKeyboardShortcuts({
    togglePlay: () => void togglePlay(),
    markIn: handleMarkInShortcut,
    markOut: handleMarkOutShortcut,
    jumpToIn: handleJumpToInShortcut,
    jumpToOut: handleJumpToOutShortcut,
    seekBackwardLarge: () => seekByShortcut(-EDITOR_LARGE_SEEK_SECONDS),
    seekForwardLarge: () => seekByShortcut(EDITOR_LARGE_SEEK_SECONDS),
    seekBackwardSmall: () => seekByShortcut(-EDITOR_SMALL_SEEK_SECONDS),
    seekForwardSmall: () => seekByShortcut(EDITOR_SMALL_SEEK_SECONDS),
    stepFrameBackward: () => stepFrameByShortcut(-1),
    stepFrameForward: () => stepFrameByShortcut(1),
    zoomOut: () => {
      if (canZoomOut) {
        handleTimelineZoomOut();
      }
    },
    zoomIn: () => {
      if (canZoomIn) {
        handleTimelineZoomIn();
      }
    },
  });
  const isDesktopLayout = useEditorDesktopLayout();

  const durationExportDisabledReason = hasDuration
    ? null
    : "Waiting for media duration.";
  const exportDisabledReason =
    durationExportDisabledReason ??
    exportFormatDisabledReason ??
    subtitleExportSummary.disabledReason;
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
        canvasRef={connectCanvas}
        videoDimensions={previewVideoDimensions}
        playing={playing}
        loadingPreview={loadingPreview}
        loadingPreviewFrame={loadingPreviewFrame}
        posterImageUrl={posterImageUrl}
        posterViewTransitionName={
          posterImageUrl ? EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME : undefined
        }
        previewStatus={previewStatus}
        previewFrameStatus={previewFrameStatus}
        togglePlay={togglePlay}
        overlay={
          <EditorSubtitlePreview
            cues={subtitleCues}
            currentTime={previewFrameTime}
            enabled={subtitleOutputEnabled && subtitleCuesReady}
            overlayCanvasRef={subtitleCanvasRef}
            style={subtitleStyleSettings}
            videoCanvasRef={canvasRef}
            videoDimensions={previewVideoDimensions}
          />
        }
      />
    </EditorPreviewPane>
  );
  const editorControls = (
    <EditorControls
      variant={layoutVariant}
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
      onFitSelection={handleFitSelection}
      handleTimelineZoomIn={handleTimelineZoomIn}
      handleTimelineZoomOut={handleTimelineZoomOut}
      canZoomIn={canZoomIn}
      canZoomOut={canZoomOut}
      onFramegrabClick={framegrab.openDialog}
      framegrabDisabledReason={framegrab.disabledReason}
      onPreviewTimeCommit={handlePreviewTimeCommit}
      onStartTimeCommit={handleStartTimeCommit}
      onEndTimeCommit={handleEndTimeCommit}
      onSetInPoint={handleMarkInShortcut}
      onSetOutPoint={handleMarkOutShortcut}
      onClearPoints={handleClearInOutPoints}
    />
  );
  const editorTimeline = hasDuration ? (
    <EditorTimeline muted={muted} onMutedChange={setMuted} />
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
          editorPropertiesOpenSections={editorPropertiesOpenSections}
          onEditorPropertiesOpenSectionsChange={setEditorPropertiesOpenSections}
          selectedSubtitleCue={selectedSubtitleCue}
          onSelectedSubtitleTextCommit={handleSelectedSubtitleTextCommit}
          onSelectedSubtitleStartCommit={handleSelectedSubtitleStartCommit}
          onSelectedSubtitleEndCommit={handleSelectedSubtitleEndCommit}
          onDeleteSelectedSubtitle={handleDeleteSelectedSubtitle}
          onSelectPreviousSubtitle={handleSelectPreviousSubtitle}
          onSelectNextSubtitle={handleSelectNextSubtitle}
          onSeekToSelectedSubtitle={handleSeekToSelectedSubtitle}
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
            selectedQuality={selectedQuality}
            onQualityChange={handleQualityChange}
            gifSettings={gifSettings}
            outputSizeEstimate={outputSizeEstimate}
            selectedResolution={resolution}
            onResolutionChange={handleResolutionChange}
            selectedSourcePreference={effectiveExportSourcePreference}
            onSourcePreferenceChange={handleExportSourceChange}
            includeAudio={includeAudio}
            onIncludeAudioChange={handleAudioChange}
            audioDisabledReason={audioDisabledReason}
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

      {framegrab.dialogMounted &&
        (framegrab.capturedFramegrab || framegrab.error) && (
          <Suspense fallback={null}>
            <EditorFramegrabDialog
              isOpen={framegrab.dialogOpen}
              title={session.title}
              frameTime={framegrab.capturedFramegrab?.time ?? currentTime}
              dimensions={framegrab.capturedFramegrab?.dimensions ?? null}
              selectedFormat={framegrab.format}
              onFormatChange={framegrab.handleFormatChange}
              selectedQuality={framegrab.quality}
              onQualityChange={framegrab.handleQualityChange}
              fileNamePreview={framegrab.fileName.fullName}
              processingAction={framegrab.action}
              error={framegrab.error}
              message={framegrab.message}
              onClose={framegrab.closeDialog}
              onCopy={() => void framegrab.copyFramegrab()}
              onDownload={() => void framegrab.downloadFramegrab()}
            />
          </Suspense>
        )}
    </div>
  );
}

function useEditorDesktopLayout() {
  const [isDesktopLayout, setIsDesktopLayout] = useState(() => {
    if (globalThis.window === undefined) {
      return false;
    }

    return globalThis.matchMedia(EDITOR_DESKTOP_LAYOUT_QUERY).matches;
  });

  useEffect(() => {
    const query = globalThis.matchMedia(EDITOR_DESKTOP_LAYOUT_QUERY);
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

  return `Using direct media: ${hlsFallbackInfo.message}`;
}
