import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Eye } from "lucide-react";
import {
  clampClipEndTime,
  clampClipStartTime,
  clampPlaybackTime,
  MIN_CLIP_SECONDS,
  roundTimelineTime,
} from "./editor/EditorUtils";
import {
  useEditorPlayback,
  type PlaybackFallbackInfo,
} from "./editor/useEditorPlayback";
import { useEditorExport } from "./editor/useEditorExport";
import { useEditorKeyboardShortcuts } from "./editor/useEditorKeyboardShortcuts";
import { useEditorTimeline } from "./editor/useEditorTimeline";
import { EditorHeader } from "./editor/EditorHeader";
import { EditorPreview } from "./editor/EditorPreview";
import { EditorControls } from "./editor/EditorControls";
import { EditorSidebar } from "./editor/EditorSidebar";
import { EditorPlaybackSourcePanel } from "./editor/EditorPlaybackSourcePanel";
import { EditorTimeline } from "./editor/EditorTimeline";
import { EditorSubtitlePanel } from "./editor/EditorSubtitlePanel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  buildClipRangeAfterDurationDiscovery,
  buildInitialClipRange,
} from "./editor/initialClipRange";
import {
  EDITOR_DESKTOP_LAYOUT_QUERY,
  EDITOR_PANEL_SIZES,
  EDITOR_RESIZE_TARGET_MINIMUM_SIZE,
} from "./editor/editorLayoutSizing";
import { useEditorSubtitles } from "./editor/useEditorSubtitles";
import { sourceDisplayLabel, type EditorSession } from "../lib/editorMedia";

const EditorExportDialog = lazy(() =>
  import("./editor/EditorExportDialog").then((module) => ({
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

type EditorLayoutVariant = "desktop" | "mobile";

function EditorPreviewPane({
  error,
  variant,
  children,
}: {
  error: string | null;
  variant: EditorLayoutVariant;
  children: ReactNode;
}) {
  const previewStage = (
    <section
      className={
        variant === "desktop"
          ? "flex min-h-0 flex-1 items-center justify-center overflow-hidden border border-editor-border bg-editor-monitor p-2"
          : "flex min-h-editor-preview-min flex-none items-center justify-center overflow-hidden border border-editor-border bg-editor-monitor p-2 sm:min-h-editor-preview-sm-min"
      }
    >
      {children}
    </section>
  );

  if (variant === "mobile") {
    return previewStage;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {error && (
        <div className="shrink-0 border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {previewStage}
    </div>
  );
}

function EditorTimelinePane({
  variant,
  controls,
  hasDuration,
  timeline,
}: {
  variant: EditorLayoutVariant;
  controls: ReactNode;
  hasDuration: boolean;
  timeline: ReactNode;
}) {
  return (
    <section
      className={
        variant === "desktop"
          ? "flex h-full min-h-0 flex-col overflow-hidden border border-editor-border bg-editor-panel text-foreground"
          : "shrink-0 overflow-hidden border border-editor-border bg-editor-panel text-foreground"
      }
    >
      {controls}

      {!hasDuration && (
        <div className="border-t border-editor-border px-3 py-3 text-sm text-muted-foreground">
          Waiting for media duration.
        </div>
      )}

      {hasDuration &&
        (variant === "desktop" ? (
          <div className="min-h-0 flex-1">{timeline}</div>
        ) : (
          timeline
        ))}
    </section>
  );
}

function EditorPropertiesPanel({
  open,
  onOpenChange,
  active,
  resizable = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active: boolean;
  resizable?: boolean;
  children: ReactNode;
}) {
  return (
    <EditorSidebar
      open={open}
      onOpenChange={onOpenChange}
      title="Properties"
      icon={Eye}
      active={active}
      resizable={resizable}
    >
      {children}
    </EditorSidebar>
  );
}

function EditorDesktopLayout({
  playbackSidebarOpen,
  onPlaybackSidebarOpenChange,
  propertiesActive,
  previewPane,
  timelinePane,
  propertiesContent,
}: {
  playbackSidebarOpen: boolean;
  onPlaybackSidebarOpenChange: (open: boolean) => void;
  propertiesActive: boolean;
  previewPane: ReactNode;
  timelinePane: ReactNode;
  propertiesContent: ReactNode;
}) {
  return (
    <ResizablePanelGroup
      id="cliparr-editor-root-panels"
      orientation="horizontal"
      resizeTargetMinimumSize={EDITOR_RESIZE_TARGET_MINIMUM_SIZE}
      className="h-full min-h-0"
    >
      <ResizablePanel
        id="cliparr-editor-primary-panel"
        defaultSize={
          playbackSidebarOpen
            ? EDITOR_PANEL_SIZES.primaryOpen
            : EDITOR_PANEL_SIZES.primaryClosed
        }
        minSize={EDITOR_PANEL_SIZES.primaryMin}
      >
        <ResizablePanelGroup
          id="cliparr-editor-primary-stack"
          orientation="vertical"
          resizeTargetMinimumSize={EDITOR_RESIZE_TARGET_MINIMUM_SIZE}
          className="h-full min-h-0"
        >
          <ResizablePanel
            id="cliparr-editor-preview-panel"
            defaultSize={EDITOR_PANEL_SIZES.previewDefault}
            minSize={EDITOR_PANEL_SIZES.previewMin}
          >
            {previewPane}
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
            id="cliparr-editor-timeline-panel"
            defaultSize={EDITOR_PANEL_SIZES.timelineDefault}
            minSize={EDITOR_PANEL_SIZES.timelineMin}
            maxSize={EDITOR_PANEL_SIZES.timelineMax}
          >
            {timelinePane}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>

      {playbackSidebarOpen ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="cliparr-editor-properties-panel"
            defaultSize={EDITOR_PANEL_SIZES.propertiesDefault}
            minSize={EDITOR_PANEL_SIZES.propertiesMin}
            maxSize={EDITOR_PANEL_SIZES.propertiesMax}
            groupResizeBehavior="preserve-pixel-size"
          >
            <EditorPropertiesPanel
              open={playbackSidebarOpen}
              onOpenChange={onPlaybackSidebarOpenChange}
              active={propertiesActive}
              resizable
            >
              {propertiesContent}
            </EditorPropertiesPanel>
          </ResizablePanel>
        </>
      ) : (
        <ResizablePanel
          id="cliparr-editor-properties-rail"
          defaultSize={EDITOR_PANEL_SIZES.propertiesRail}
          minSize={EDITOR_PANEL_SIZES.propertiesRail}
          maxSize={EDITOR_PANEL_SIZES.propertiesRail}
          disabled
          groupResizeBehavior="preserve-pixel-size"
        >
          <EditorPropertiesPanel
            open={playbackSidebarOpen}
            onOpenChange={onPlaybackSidebarOpenChange}
            active={propertiesActive}
          >
            <div />
          </EditorPropertiesPanel>
        </ResizablePanel>
      )}
    </ResizablePanelGroup>
  );
}

function EditorMobileLayout({
  error,
  playbackSourcePanel,
  previewPane,
  timelinePane,
  subtitlePanel,
}: {
  error: string | null;
  playbackSourcePanel: ReactNode;
  previewPane: ReactNode;
  timelinePane: ReactNode;
  subtitlePanel: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col gap-3">
      {error && (
        <div className="border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {playbackSourcePanel}
      {previewPane}
      {timelinePane}
      {subtitlePanel}
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
