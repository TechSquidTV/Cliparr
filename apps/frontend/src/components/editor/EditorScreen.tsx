import { useBlocker } from "@tanstack/react-router";
import {
  fromSeconds,
  type TimelineEngine,
  TimelineProvider,
  toSeconds,
  useTimelinePlayback,
  useTimelineViewport,
  useTimelineZoomControl,
} from "@techsquidtv/canvas-timeline";
import {
  lazy,
  Suspense,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  EditorControls,
  type EditorControlsSection,
} from "@/components/editor/EditorControls";
import {
  type EditorDraft,
  editorDraftIdentity,
  editorDrafts,
} from "@/components/editor/editorDrafts";
import {
  EditorHistoryControls,
  useEditorEditingTools,
} from "@/components/editor/EditorEditingTools";
import { EditorHeader } from "@/components/editor/EditorHeader";
import {
  EditorDesktopLayout,
  EditorMobileLayout,
  EditorPreviewPane,
  EditorTimelinePane,
  type EditorTool,
} from "@/components/editor/EditorLayout";
import { EDITOR_DESKTOP_LAYOUT_QUERY } from "@/components/editor/editorLayoutSizing";
import {
  type EditorSession,
  sourceDisplayLabel,
} from "@/components/editor/editorMedia";
import { EditorPlaybackSourceControl } from "@/components/editor/EditorPlaybackSourceControl";
import type { PlaybackFallbackInfo } from "@/components/editor/editorPlaybackSources";
import { EditorPreview } from "@/components/editor/EditorPreview";
import {
  EDITOR_LARGE_SEEK_SECONDS,
  EDITOR_SMALL_SEEK_SECONDS,
  resolveRelativeSeekTime,
} from "@/components/editor/editorShortcutCommands";
import {
  EditorSubtitlePanel,
  type EditorSubtitleTab,
} from "@/components/editor/EditorSubtitlePanel";
import { EditorSubtitlePreview } from "@/components/editor/EditorSubtitlePreview";
import {
  completeEditorTimecode,
  EditorTimecodeProvider,
  useEditorTimecodeEdit,
} from "@/components/editor/EditorTimecodeEdit";
import { EditorTimeline } from "@/components/editor/EditorTimeline";
import {
  createEditorTimelineEngine,
  synchronizeEditorTimelineSession,
  timelineScrollLeftForCenteredTime,
} from "@/components/editor/editorTimelineEngine";
import {
  EDITOR_MAX_ZOOM_SCALE,
  zoomEditorTimeline,
} from "@/components/editor/editorTimelineZoom";
import {
  clampClipEndTime,
  clampClipStartTime,
  clampPlaybackTime,
} from "@/components/editor/editorUtilities";
import { useEditorAssetCapture } from "@/components/editor/useEditorAssetCapture";
import { useEditorDraft } from "@/components/editor/useEditorDraft";
import { useEditorExport } from "@/components/editor/useEditorExport";
import { useEditorFramegrab } from "@/components/editor/useEditorFramegrab";
import { useEditorInputViewport } from "@/components/editor/useEditorInputViewport";
import { useEditorKeyboardShortcuts } from "@/components/editor/useEditorKeyboardShortcuts";
import { useEditorSubtitles } from "@/components/editor/useEditorSubtitles";
import { useEditorTimelineMedia } from "@/components/editor/useEditorTimelineMedia";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME } from "@/lib/viewTransitions";
import type { EditorCropOverlayHandle } from "#/components/editor/EditorCropOverlay";
import {
  EditorPropertyAccordion,
  EditorPropertyAccordionItem,
} from "#/components/editor/EditorPropertyControls";
import { useEditorCrop } from "#/components/editor/useEditorCrop";
import { BarsLoader } from "#/components/ui/bars-loader";
import { resolveVideoCrop } from "#/lib/videoCrop";

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

const EditorCropOverlay = lazy(() =>
  import("#/components/editor/EditorCropOverlay").then((module) => ({
    default: module.EditorCropOverlay,
  })),
);
const EditorCropControls = lazy(() =>
  import("#/components/editor/EditorCropControls").then((module) => ({
    default: module.EditorCropControls,
  })),
);

const blockNavigation = () => true;

interface Properties {
  session: EditorSession;
  onBack: () => void;
}

export default function EditorScreen({ session, onBack }: Properties) {
  const [draftRevision, setDraftRevision] = useState(0);
  return (
    <EditorSessionScreen
      key={`${editorDraftIdentity(session)}:${draftRevision}`}
      session={session}
      onBack={onBack}
      onReset={() => setDraftRevision((revision) => revision + 1)}
    />
  );
}

function EditorSessionScreen({
  session,
  onBack,
  onReset,
}: Properties & { onReset: () => void }) {
  const [initialDraft] = useState(() => editorDrafts.read(session));
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
      <EditorTimecodeProvider>
        <EditorScreenContent
          session={session}
          onBack={onBack}
          engine={engine}
          initialDraft={initialDraft}
          onReset={onReset}
        />
      </EditorTimecodeProvider>
    </TimelineProvider>
  );
}

function EditorScreenContent({
  session,
  onBack,
  engine,
  initialDraft,
  onReset,
}: Properties & {
  engine: TimelineEngine;
  initialDraft: EditorDraft | null;
  onReset: () => void;
}) {
  const { inPoint, outPoint, setInPoint, setOutPoint, clearInOutPoints } =
    useTimelinePlayback();
  const timelineMedia = useEditorTimelineMedia(session, engine);
  const duration = timelineMedia.duration;
  const startTime = inPoint ? toSeconds(inPoint) : 0;
  const endTime = outPoint ? toSeconds(outPoint) : duration;
  const isDesktopLayout = useEditorDesktopLayout();
  const [playbackSidebarOpen, setPlaybackSidebarOpen] = useState(true);
  const [propertiesPanel, setPropertiesPanel] = useState<EditorTool | null>(
    () => (isDesktopLayout ? "subtitles" : null),
  );
  const timecodeTool = useEditorTimecodeEdit().draft?.tool;
  const [trackNamesVisible, setTrackNamesVisible] = useState(false);
  const mobileWorkspace = useRef<HTMLDivElement>(null);
  const compositionAction = useRef<HTMLButtonElement | null>(null);
  const [subtitleTab, setSubtitleTab] = useState<EditorSubtitleTab>("text");
  useLayoutEffect(() => {
    if (!isDesktopLayout && timecodeTool) {
      setPropertiesPanel(timecodeTool);
      if (timecodeTool === "subtitles") {
        setSubtitleTab("timing");
      }
    }
  }, [isDesktopLayout, timecodeTool]);
  const consumedSubtitleFocus = useRef(0);
  const consumeSubtitleFocus = useCallback((revision: number) => {
    if (revision <= consumedSubtitleFocus.current) {
      return false;
    }
    consumedSubtitleFocus.current = revision;
    return true;
  }, []);
  const [exportDialogMounted, setExportDialogMounted] = useState(false);
  const exportButtonReference = useRef<HTMLButtonElement>(null);
  const moreTriggerReference = useRef<HTMLButtonElement>(null);
  const subtitleOptionsTriggerReference = useRef<HTMLButtonElement>(null);
  const subtitles = useEditorSubtitles({
    initialDraft,
    engine,
    session,
    startTime,
    endTime,
    duration,
    mediaReady: timelineMedia.metadataReady,
    previewReady: !timelineMedia.loadingPreviewFrame,
    renderedFrameTime: timelineMedia.renderedFrameTime,
    getRenderedFrameTime: timelineMedia.getRenderedFrameTime,
    pausePlayback: timelineMedia.pausePlayback,
    onSubtitleCreated: () => {
      setPlaybackSidebarOpen(true);
      setPropertiesPanel("subtitles");
      setSubtitleTab("text");
    },
  });
  const {
    subtitleTracks,
    subtitleOutputEnabled,
    setSubtitleEnabled,
    subtitleStyleSettings,
    setSubtitleStyleSettings,
    subtitleCues,
    subtitleLoading,
    subtitleError,
    clippedSubtitleCues,
    subtitleExportSummary,
    requestImport,
    subtitleTrackChangePending,
    confirmSubtitleTrackChange,
    cancelSubtitleTrackChange,
    history: editHistory,
    commitText: commitSubtitleText,
  } = subtitles;
  const crop = useEditorCrop(initialDraft?.crop, editHistory.recordApplied);
  const cropOverlayRef = useRef<EditorCropOverlayHandle>(null);
  const { finishGesture: finishCropHistoryGesture } = crop;
  const finishCropGesture = useCallback(() => {
    cropOverlayRef.current?.finishGesture();
    finishCropHistoryGesture();
  }, [finishCropHistoryGesture]);
  const finishEditing = useCallback(() => {
    finishCropGesture();
    commitSubtitleText();
  }, [finishCropGesture, commitSubtitleText]);
  useEffect(() => {
    window.addEventListener("resize", finishCropGesture);
    return () => window.removeEventListener("resize", finishCropGesture);
  }, [finishCropGesture]);
  const connectWorkspace = useEditorInputViewport(finishCropGesture);
  const editorHistory = {
    ...editHistory,
    undo: () => {
      finishCropGesture();
      editHistory.undo();
    },
    redo: () => {
      finishCropGesture();
      editHistory.redo();
    },
  };
  const draft = useEditorDraft({
    crop: crop.state,
    engine,
    session,
    initialDraft,
    onReset,
    ready: timelineMedia.metadataReady && subtitles.initialized,
    duration,
    startTime,
    endTime,
    subtitles: {
      visible: subtitleOutputEnabled,
      cues: subtitleCues,
    },
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

  const {
    cropDisabledReason,
    hasActiveCrop,
    resolution,
    exportFormat,
    selectedQuality,
    gifSettings,
    effectiveExportSourcePreference,
    mode,
    mixDownToStereo,
    setMixDownToStereo,
    audioPending,
    audioStatus,
    audioPlan,
    audioBitDepth,
    audioExportDisabledReason,
    audioDisabledReason,
    fileNameTemplates,
    templateEditorKind,
    setTemplateEditorKind,
    exportDialogOpen,
    exporting,
    progress,
    exportError,
    exportPhase,
    exportNotice,
    handleCancelExport,
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
    handleOutputTypeChange,
    handleVideoMutedChange,
    handleFileNameTemplateChange,
    handleResetFileNameTemplate,
    handleExport,
  } = useEditorExport({
    crop: crop.state.region,
    session,
    exportMedia: timelineMedia.exportMedia,
    startTime,
    endTime,
    sourceVideoDimensions,
    exportFallbackSource,
    hlsFallbackInfo,
    subtitleEnabled: subtitleOutputEnabled,
    clippedSubtitleCues,
    subtitleLoading,
    subtitleCues,
    subtitleStyleSettings,
  });
  const navigationBlocker = useBlocker({
    disabled: !exporting,
    enableBeforeUnload: exporting,
    shouldBlockFn: blockNavigation,
    withResolver: true,
  });
  useEffect(() => {
    if (!exporting && navigationBlocker.status === "blocked") {
      navigationBlocker.reset();
    }
  }, [exporting, navigationBlocker]);

  const cropEditing = propertiesPanel === "crop" && !exporting;
  let cropPreviewError: string | null = null;
  try {
    resolveVideoCrop(crop.state.region, previewVideoDimensions);
    if (
      previewVideoDimensions &&
      sourceVideoDimensions &&
      Math.abs(
        previewVideoDimensions.width /
          previewVideoDimensions.height /
          (sourceVideoDimensions.width / sourceVideoDimensions.height) -
          1,
      ) > 0.01
    ) {
      cropPreviewError =
        "Preview and export have different picture shapes. Choose a matching source before cropping.";
    }
  } catch (error_) {
    cropPreviewError =
      error_ instanceof Error ? error_.message : "Crop preview is unavailable.";
  }
  const previewCrop = cropPreviewError ? null : crop.state.region;
  const cropDisabled =
    exporting ||
    !sourceVideoDimensions ||
    !previewVideoDimensions ||
    !subtitles.initialized;
  const openCrop = () => {
    if (cropDisabled) {
      return;
    }
    finishEditing();
    pausePlayback();
    setPlaybackSidebarOpen(true);
    setPropertiesPanel("crop");
    mobileWorkspace.current?.scrollTo({ top: 0 });
  };
  const closeTool = () => {
    finishEditing();
    setPropertiesPanel(isDesktopLayout ? "subtitles" : null);
    if (propertiesPanel === "crop") {
      mobileWorkspace.current?.scrollTo({ top: 0 });
    }
    if (!isDesktopLayout && propertiesPanel) {
      document
        .querySelector<HTMLButtonElement>(`#editor-tool-${propertiesPanel}`)
        ?.focus();
    }
  };
  const subtitleCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewFrameTime = renderedFrameTime ?? currentTime;
  const getFramegrabTime = useCallback(
    () => renderedFrameTime ?? getPlaybackTime(),
    [getPlaybackTime, renderedFrameTime],
  );
  const framegrab = useEditorFramegrab({
    crop: crop.state.region,
    session,
    canvasRef,
    subtitleCanvasRef,
    currentTime: previewFrameTime,
    loadingPreview,
    loadingPreviewFrame,
    previewVideoDimensions,
    subtitleEnabled: subtitleOutputEnabled,
    subtitleLoading,
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

  const {
    viewportWidth,
    setZoomScale,
    setScrollLeft,
    maxScrollLeft,
    zoomScale,
    scrollLeft,
  } = useTimelineViewport();
  const handleFitSelection = useCallback(() => {
    if (viewportWidth <= 0 || endTime <= startTime) {
      return;
    }
    const padding = Math.min(24, viewportWidth / 4);
    const scale = Math.min(
      EDITOR_MAX_ZOOM_SCALE,
      (viewportWidth - padding * 2) / (endTime - startTime),
    );
    setZoomScale(scale);
    setScrollLeft(Math.max(0, startTime * scale - padding));
  }, [endTime, setScrollLeft, setZoomScale, startTime, viewportWidth]);
  useEditorAssetCapture({
    engine,
    media: timelineMedia,
    fitSelection: handleFitSelection,
    subtitles: {
      subtitleTracks,
      subtitleOutputEnabled,
      initialized: subtitles.initialized,
      subtitleLoading,
      subtitleError,
      clippedSubtitleCues,
      subtitleCues,
      setSubtitleEnabled,
      setSubtitleStyleSettings,
      requestImport,
    },
  });
  const zoomControl = useTimelineZoomControl({
    min: 0,
    max: EDITOR_MAX_ZOOM_SCALE,
  });
  const hasDuration = timelineMedia.metadataReady && duration > 0;
  const hasCenteredTimeline = useRef(false);
  useEffect(() => {
    if (
      hasCenteredTimeline.current ||
      !hasDuration ||
      !inPoint ||
      viewportWidth <= 0
    ) {
      return;
    }
    hasCenteredTimeline.current = true;
    setScrollLeft(
      timelineScrollLeftForCenteredTime({
        maxScrollLeft,
        timeSeconds: startTime,
        viewportWidth,
        zoomScale,
      }),
    );
  }, [
    hasDuration,
    inPoint,
    maxScrollLeft,
    setScrollLeft,
    startTime,
    viewportWidth,
    zoomScale,
  ]);
  const previousViewport = useRef<{
    width: number;
    centerSeconds: number;
    scrollLeft: number;
    zoomScale: number;
  } | null>(null);
  const timelineWasHidden = useRef(false);
  useLayoutEffect(() => {
    if (viewportWidth <= 0) {
      timelineWasHidden.current = true;
      return;
    }
    const previous = previousViewport.current;
    const resizing =
      previous &&
      hasCenteredTimeline.current &&
      (timelineWasHidden.current || previous.width !== viewportWidth);
    if (resizing) {
      setScrollLeft(
        Math.max(0, previous.centerSeconds * zoomScale - viewportWidth / 2),
      );
    }
    const snapshotScrollLeft = engine.getState().scrollLeft;
    const unchanged =
      previous &&
      previous.scrollLeft === snapshotScrollLeft &&
      previous.zoomScale === zoomScale;
    timelineWasHidden.current = false;
    previousViewport.current = {
      width: viewportWidth,
      centerSeconds:
        previous && (resizing || unchanged)
          ? previous.centerSeconds
          : (snapshotScrollLeft + viewportWidth / 2) / zoomScale,
      scrollLeft: snapshotScrollLeft,
      zoomScale,
    };
  }, [engine, viewportWidth, scrollLeft, zoomScale, setScrollLeft]);
  const canZoomOut = zoomControl.value > zoomControl.min;
  const canZoomIn = zoomControl.value < zoomControl.max;
  const handleTimelineZoomOut = useCallback(() => {
    zoomEditorTimeline(
      engine,
      Math.max(zoomControl.min, zoomControl.value / 1.25),
    );
  }, [engine, zoomControl]);
  const handleTimelineZoomIn = useCallback(() => {
    zoomEditorTimeline(
      engine,
      Math.min(zoomControl.max, zoomControl.value * 1.25),
    );
  }, [engine, zoomControl]);
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
    deleteSubtitle: subtitles.handleDeleteSelectedSubtitle,
    undo: editorHistory.undo,
    redo: editorHistory.redo,
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
  const { openDialog: openFramegrabDialog } = framegrab;
  const handleFramegrabClick = useCallback(() => {
    finishEditing();
    openFramegrabDialog();
  }, [finishEditing, openFramegrabDialog]);
  const durationExportDisabledReason = hasDuration
    ? null
    : "Waiting for media duration.";
  const exportDisabledReason =
    durationExportDisabledReason ??
    cropDisabledReason ??
    exportFormatDisabledReason ??
    audioExportDisabledReason ??
    (mode === "audio-only" ? null : subtitleExportSummary.disabledReason);
  const headerExportDisabledReason = durationExportDisabledReason;
  const layoutVariant = isDesktopLayout ? "desktop" : "mobile";
  const hasSubtitleErrors =
    subtitleError !== null || subtitles.textError !== null;
  const subtitleStatus = (subtitleLoading || hasSubtitleErrors) && (
    <div
      role="status"
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-center gap-2 border-b border-editor-border bg-editor-panel/95 px-3 py-2 text-xs"
    >
      {subtitleLoading && (
        <>
          <span>Importing subtitles…</span>
          <button
            type="button"
            onClick={subtitles.cancelImport}
            className="editor-control-focus pointer-events-auto min-h-11 px-3 underline lg:min-h-7"
          >
            Cancel import
          </button>
        </>
      )}
      {subtitleError && <span>{subtitleError}</span>}
      {subtitles.textError && <span>{subtitles.textError}</span>}
      {hasSubtitleErrors && (
        <button
          type="button"
          onClick={subtitles.dismissErrors}
          className="editor-control-focus pointer-events-auto min-h-11 px-3 underline lg:min-h-7"
        >
          Dismiss subtitle messages
        </button>
      )}
    </div>
  );
  const subtitlesActive = subtitleCues.length > 0;
  const previewPicture = previewVideoDimensions
    ? (resolveVideoCrop(previewCrop, previewVideoDimensions) ??
      previewVideoDimensions)
    : null;
  const previewPane = (
    <EditorPreviewPane
      status={subtitleStatus}
      error={isDesktopLayout ? error : null}
      cropEditing={cropEditing}
      pictureAspectRatio={
        previewPicture
          ? previewPicture.width / previewPicture.height
          : undefined
      }
      variant={layoutVariant}
    >
      <EditorPreview
        crop={previewCrop}
        cropEditing={cropEditing}
        fitHeight={cropEditing && !isDesktopLayout}
        videoDimensions={previewVideoDimensions}
        cropOverlay={
          cropEditing &&
          previewVideoDimensions &&
          sourceVideoDimensions &&
          !cropPreviewError &&
          !loadingPreview &&
          !loadingPreviewFrame ? (
            <Suspense fallback={null}>
              <EditorCropOverlay
                ref={cropOverlayRef}
                state={crop.state}
                dimensions={sourceVideoDimensions}
                onChange={crop.update}
                onGestureStart={crop.beginGesture}
                onGestureEnd={finishCropHistoryGesture}
              />
            </Suspense>
          ) : null
        }
        canvasRef={connectCanvas}
        playing={playing}
        loadingPreview={loadingPreview}
        loadingPreviewFrame={loadingPreviewFrame}
        posterImageUrl={posterImageUrl}
        posterViewTransitionName={
          posterImageUrl ? EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME : undefined
        }
        togglePlay={togglePlay}
        overlay={
          <EditorSubtitlePreview
            crop={previewCrop}
            cropEditing={cropEditing}
            cues={subtitleCues}
            currentTime={previewFrameTime}
            frameReady={renderedFrameTime !== null}
            enabled={subtitleOutputEnabled}
            overlayCanvasRef={subtitleCanvasRef}
            style={subtitleStyleSettings}
            videoCanvasRef={canvasRef}
            videoDimensions={previewVideoDimensions}
          />
        }
      />
    </EditorPreviewPane>
  );
  const changeTool = (tool: EditorTool) => {
    if (tool === "crop") {
      openCrop();
      return;
    }
    finishEditing();
    if (tool === "trim") {
      pausePlayback();
    }
    setPlaybackSidebarOpen(true);
    setPropertiesPanel(tool);
  };
  const renderControls = (section: EditorControlsSection = "workspace") => (
    <EditorControls
      section={section}
      onTrimClick={() => changeTool("trim")}
      inspectorOpen={!isDesktopLayout && propertiesPanel !== null}
      trackNamesVisible={trackNamesVisible}
      onTrackNamesVisibleChange={setTrackNamesVisible}
      historyControls={
        <EditorHistoryControls
          history={editorHistory}
          variant={layoutVariant}
        />
      }
      onCropClick={cropEditing ? closeTool : openCrop}
      cropActive={cropEditing}
      cropDisabled={cropDisabled}
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
      onFramegrabClick={handleFramegrabClick}
      framegrabDisabledReason={framegrab.disabledReason}
      onPreviewTimeCommit={handlePreviewTimeCommit}
      onStartTimeCommit={handleStartTimeCommit}
      onEndTimeCommit={handleEndTimeCommit}
      onSetInPoint={handleMarkInShortcut}
      onSetOutPoint={handleMarkOutShortcut}
      onClearPoints={handleClearInOutPoints}
    />
  );
  const editorTimeline = (
    <EditorTimeline
      variant={layoutVariant}
      engine={engine}
      subtitleLoading={subtitleLoading}
      onInteractionStart={commitSubtitleText}
      canAddSubtitle={subtitles.canAddSubtitle}
      onAddSubtitle={subtitles.addSubtitle}
      onOpenSubtitles={() => changeTool("subtitles")}
      trackNamesVisible={trackNamesVisible}
      muted={muted}
      onMutedChange={setMuted}
    />
  );
  const timelinePane = (
    <EditorTimelinePane
      variant={layoutVariant}
      controls={cropEditing && !isDesktopLayout ? null : renderControls()}
      hasDuration={hasDuration}
      timeline={editorTimeline}
    />
  );

  function renderSubtitlePanel(className: string) {
    return (
      <div className={className}>
        <EditorSubtitlePanel
          variant={layoutVariant}
          subtitles={subtitles}
          subtitleOptionsTriggerRef={subtitleOptionsTriggerReference}
          tab={subtitleTab}
          onTabChange={setSubtitleTab}
          consumeFocus={consumeSubtitleFocus}
          onEditingFocus={pausePlayback}
          showHeading={!isDesktopLayout}
          onDone={isDesktopLayout ? undefined : closeTool}
          autoFocusCreated={isDesktopLayout}
        />
      </div>
    );
  }

  const cropLoading = (
    <div className="flex h-full min-h-40 items-center justify-center p-4 text-muted-foreground">
      <BarsLoader
        label={
          sourceVideoDimensions
            ? "Loading crop controls…"
            : "Preparing crop controls…"
        }
        showLabel
      />
    </div>
  );
  const cropControls = sourceVideoDimensions ? (
    <Suspense fallback={cropLoading}>
      <EditorCropControls
        state={crop.state}
        dimensions={sourceVideoDimensions}
        error={cropPreviewError}
        onChange={(next) => {
          finishCropGesture();
          crop.update(next);
        }}
        onDone={closeTool}
      />
    </Suspense>
  ) : (
    cropLoading
  );
  function renderMobileInspector() {
    switch (propertiesPanel) {
      case "crop": {
        return cropControls;
      }
      case "subtitles": {
        return renderSubtitlePanel("h-full min-h-0");
      }
      case "trim": {
        return renderControls("trim");
      }
      case "playback": {
        return renderControls("playback");
      }
      case null: {
        return null;
      }
    }
  }
  const editingTools = useEditorEditingTools({
    history: editorHistory,
    menuTriggerReference: moreTriggerReference,
    title: session.title,
    framegrab: {
      onClick: handleFramegrabClick,
      disabledReason: framegrab.disabledReason,
      open: framegrab.dialogOpen,
    },
    variant: layoutVariant,
    onResetDraft: draft.reset,
    resetDisabled: exporting,
    draftNotice: draft.notice,
    playbackSourceControl: (
      <EditorPlaybackSourceControl
        previewSourceLabel={previewSourceLabel}
        fallbackMessage={playbackFallbackReason}
        variant={layoutVariant}
      />
    ),
  });
  const propertiesContent = (
    <EditorPropertyAccordion
      multiple={false}
      className="h-full"
      value={propertiesPanel ? [propertiesPanel] : []}
      onValueChange={(panels) => {
        const next = panels[0] ?? "";
        if (next === "crop") {
          openCrop();
        } else {
          finishEditing();
          setPropertiesPanel(next === "subtitles" ? "subtitles" : null);
        }
      }}
    >
      <EditorPropertyAccordionItem
        value="subtitles"
        title="Subtitles"
        fillAvailable
      >
        {renderSubtitlePanel("h-full min-h-0")}
      </EditorPropertyAccordionItem>
      <EditorPropertyAccordionItem
        value="crop"
        title="Crop"
        fillAvailable
        disabled={cropDisabled}
      >
        <div className="h-full min-h-0 overflow-y-auto">{cropControls}</div>
      </EditorPropertyAccordionItem>
    </EditorPropertyAccordion>
  );

  function guardEditorEdit(event: SyntheticEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const composing = event.currentTarget.querySelector<HTMLTextAreaElement>(
      'textarea[data-editor-composing="true"]',
    );
    if (composing && target !== composing) {
      compositionAction.current = target.closest<HTMLButtonElement>("button");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      target.closest("[data-editor-cancel-edit],input[data-editor-timecode]")
    ) {
      return;
    }
    if (!completeEditorTimecode(event.currentTarget)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  if (!exportSource.source) {
    return (
      <div className="flex h-(--app-viewport-height) items-center justify-center overflow-hidden bg-background p-8 text-foreground">
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
    <div
      ref={connectWorkspace}
      className="editor-session relative flex flex-col overflow-hidden bg-editor-workspace text-foreground"
      onPointerDownCapture={guardEditorEdit}
      onClickCapture={guardEditorEdit}
      onKeyDownCapture={guardEditorEdit}
      onCompositionEndCapture={() => {
        const action = compositionAction.current;
        compositionAction.current = null;
        if (action) {
          queueMicrotask(() => {
            if (action.isConnected) {
              action.click();
            }
          });
        }
      }}
    >
      <ConfirmationDialog
        open={subtitleTrackChangePending}
        title="Replace subtitle cues?"
        description="Importing replaces every subtitle in this editor. You can undo the replacement."
        confirmLabel="Replace cues"
        onConfirm={confirmSubtitleTrackChange}
        onCancel={cancelSubtitleTrackChange}
        finalFocus={subtitleOptionsTriggerReference}
      />
      <ConfirmationDialog
        open={subtitles.clearPending}
        title="Start with blank subtitles?"
        description={`Remove all ${subtitleCues.length} subtitles? You can undo this action.`}
        confirmLabel="Start blank"
        onConfirm={subtitles.confirmClear}
        onCancel={subtitles.cancelClear}
        finalFocus={subtitleOptionsTriggerReference}
      />
      <EditorHeader
        exportButtonRef={exportButtonReference}
        title={session.title}
        onBack={() => {
          finishEditing();
          onBack();
        }}
        exporting={exporting}
        progress={progress}
        exportDisabledReason={headerExportDisabledReason}
        onExportClick={() => {
          finishEditing();
          handleOpenExportDialog();
        }}
      />

      {editingTools.dialogs}
      {isDesktopLayout && editingTools.controls}

      <main
        data-crop-editing={cropEditing || undefined}
        className="min-h-0 flex-1 overflow-hidden lg:p-3"
      >
        {isDesktopLayout ? (
          <EditorDesktopLayout
            playbackSidebarOpen={playbackSidebarOpen}
            onPlaybackSidebarOpenChange={(open) => {
              setPlaybackSidebarOpen(open);
              if (!open) {
                closeTool();
              }
            }}
            subtitlesActive={subtitlesActive}
            previewPane={previewPane}
            timelinePane={timelinePane}
            propertiesContent={propertiesContent}
          />
        ) : (
          <EditorMobileLayout
            ref={mobileWorkspace}
            tool={propertiesPanel}
            onToolChange={changeTool}
            onDone={closeTool}
            cropDisabled={cropDisabled}
            cropTransport={cropEditing ? renderControls() : null}
            moreControl={editingTools.controls}
            inspector={renderMobileInspector()}
            error={error}
            previewPane={previewPane}
            timelinePane={timelinePane}
          />
        )}
      </main>

      {exportDialogMounted && (
        <Suspense fallback={null}>
          <EditorExportDialog
            isOpen={exportDialogOpen}
            mobile={!isDesktopLayout}
            finalFocus={exportButtonReference}
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
            hasActiveCrop={hasActiveCrop}
            onResolutionChange={handleResolutionChange}
            selectedSourcePreference={effectiveExportSourcePreference}
            onSourcePreferenceChange={handleExportSourceChange}
            mode={mode}
            onOutputTypeChange={handleOutputTypeChange}
            onVideoMutedChange={handleVideoMutedChange}
            mixDownToStereo={mixDownToStereo}
            onMixDownToStereoChange={setMixDownToStereo}
            audioPending={audioPending}
            audioStatus={audioStatus}
            audioPlan={audioPlan}
            audioBitDepth={audioBitDepth}
            audioDisabledReason={audioDisabledReason}
            exporting={exporting}
            progress={progress}
            error={exportError}
            exportPhase={exportPhase}
            exportNotice={exportNotice}
            onCancelExport={handleCancelExport}
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
            exportSourceSummaryMessage={
              hasActiveCrop
                ? `${exportSourceSummaryMessage ?? ""} Cropping re-encodes video. Cropped resolution uses the cropped size, rounded to even pixels for video.`.trim()
                : exportSourceSummaryMessage
            }
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
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- An empty error should not mount the framegrab dialog.
        (framegrab.capturedFramegrab || framegrab.error) && (
          <Suspense fallback={null}>
            <EditorFramegrabDialog
              isOpen={framegrab.dialogOpen}
              finalFocus={() =>
                moreTriggerReference.current ??
                document.querySelector<HTMLButtonElement>(
                  "[data-editor-save-frame]",
                ) ??
                document.querySelector<HTMLButtonElement>(
                  "[data-editor-export]",
                ) ??
                false
              }
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
      <ConfirmationDialog
        open={navigationBlocker.status === "blocked"}
        title="Leave during export?"
        description="Leaving will cancel the export."
        cancelLabel="Stay"
        confirmLabel="Leave"
        onCancel={() => navigationBlocker.reset?.()}
        onConfirm={() => {
          handleCancelExport();
          navigationBlocker.proceed?.();
        }}
      />
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
    let disposed = false;
    let composing: HTMLTextAreaElement | null = null;
    const finishComposition = () => queueMicrotask(updateLayout);
    function updateLayout() {
      if (disposed) {
        return;
      }
      composing?.removeEventListener("compositionend", finishComposition);
      composing = document.querySelector<HTMLTextAreaElement>(
        'textarea[data-editor-composing="true"]',
      );
      if (composing) {
        composing.addEventListener("compositionend", finishComposition, {
          once: true,
        });
        return;
      }
      // A responsive shell change unmounts the focused field without blur.
      // Finish explicit crop-number edits while their controller is mounted.
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement &&
        Object.hasOwn(active.dataset, "editorCropNumber")
      ) {
        active.blur();
      }
      setIsDesktopLayout(query.matches);
    }
    updateLayout();
    query.addEventListener("change", updateLayout);
    return () => {
      disposed = true;
      composing?.removeEventListener("compositionend", finishComposition);
      query.removeEventListener("change", updateLayout);
    };
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
