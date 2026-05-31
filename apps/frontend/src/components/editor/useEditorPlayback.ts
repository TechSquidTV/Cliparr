import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  compactLogFields,
  logDurationFields,
  logErrorFields,
  logEventFields,
} from "@cliparr/shared/logging";
import type {
  AudioBufferSink,
  CanvasSink,
  Input,
  InputTrack,
  InputVideoTrack,
  WrappedAudioBuffer,
  WrappedCanvas,
} from "mediabunny";
import type { SubtitleCue, SubtitleStyleSettings } from "@/lib/subtitles/types";
import type { EditorMediaSource } from "@/lib/editorMedia";
import { createCliparrInputFromSource } from "@/lib/mediabunnyInput";
import {
  fromSourceTimelineTime,
  getAudioTrackSampleRate,
  getTrackTimelineOffsetSeconds,
  getVideoTrackDimensions,
  toSourceTimelineTime,
} from "@/lib/mediabunnyTrackAccess";
import { selectPreferredPairableAudioTrack } from "@/lib/selectPreferredAudioTrack";
import type { PlaybackAudioSelection } from "@/providers/types";
import { errorMessage } from "@/components/editor/editorUtils";
import {
  applyPlaybackGain,
  runPlaybackAudioIterator,
  stopQueuedAudioNodes,
} from "@/components/editor/editorPlaybackAudio";
import {
  assessPreviewAudioTrack,
  browserDecoderEnvironmentWarning,
  buildPlaybackFailure,
  buildPlaybackLoadError,
  buildPlaybackSourceCandidates,
  createPlaybackSourceError,
  describePlaybackFailure,
  formatPlaybackSourceLabel,
  isPlaybackSourceError,
  isPresent,
  resolvePlaybackDuration,
  selectPreviewVideoTrack,
  shouldUseExportFallback,
  type PlaybackFallbackInfo,
  type PlaybackLoadFailure,
  type PlaybackSourceCandidate,
  type PlaybackSourceAnalysisContext,
} from "@/components/editor/editorPlaybackSources";
import {
  createPlaybackSinkResources,
  disposePlaybackSinkResources,
  getAudioContextConstructor,
} from "@/components/editor/editorPlaybackSinks";
import { useEditorPlaybackRenderLoop } from "@/components/editor/useEditorPlaybackRenderLoop";
import {
  useEditorPlaybackWarmup,
  type PlaybackReadyRange,
} from "@/components/editor/useEditorPlaybackWarmup";
import { resolvePreviewPlaybackPlan } from "@/components/editor/editorPlaybackPlan";
import { resetPlaybackReadyRangeWarmState } from "@/components/editor/editorPlaybackWarmupRange";
import {
  DEFAULT_EDITOR_FRAME_STEP_SECONDS,
  frameStepSecondsFromFrameRate,
} from "@/components/editor/editorShortcutCommands";
import { getFrontendLogger, warnWithError } from "@/logging";

export type { PlaybackFallbackInfo } from "@/components/editor/editorPlaybackSources";
export type { PlaybackReadyRange } from "@/components/editor/useEditorPlaybackWarmup";

interface UseEditorPlaybackProps {
  hlsSource?: EditorMediaSource;
  directSource?: EditorMediaSource;
  initialDuration: number;
  initialCurrentTime?: number;
  startTime: number;
  endTime: number;
  sessionId: string;
  selectedAudioTrack?: PlaybackAudioSelection;
  posterImageUrl?: string;
  subtitleCues?: readonly SubtitleCue[];
  subtitlesEnabled?: boolean;
  subtitleStyleSettings?: SubtitleStyleSettings;
}

interface VideoDimensions {
  width: number;
  height: number;
}

interface StaticVideoFrame {
  canvas: HTMLCanvasElement;
  dimensions: VideoDimensions;
}

const MAX_STATIC_VIDEO_FRAME_SIZE = 1920;
const logger = getFrontendLogger(["editor", "playback"]);

function playbackSourceLogFields(
  playbackSource: PlaybackSourceCandidate,
  context?: PlaybackSourceAnalysisContext,
) {
  return compactLogFields({
    "playback.source.kind": playbackSource.source.kind,
    "playback.source.role": playbackSource.source.role,
    "playback.source.label": playbackSource.label,
    "playback.video.track_count": context?.videoTracks.length,
    "playback.audio.track_count": context?.allAudioTracks.length,
    "playback.video.preview.present": context
      ? Boolean(context.previewVideoTrack)
      : undefined,
    "playback.audio.preview.present": context
      ? Boolean(context.previewAudioTrack)
      : undefined,
    "playback.audio.source.present": context
      ? Boolean(context.sourceAudioTrack)
      : undefined,
    "playback.video.source.present": context
      ? Boolean(context.sourceVideoTrack)
      : undefined,
    "playback.warning.count": context?.warnings.length,
    "playback.live": context?.isLivePlayback,
  });
}

function scaledStaticFrameDimensions(
  width: number,
  height: number,
): VideoDimensions {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1280;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 720;
  const scale = Math.min(
    1,
    MAX_STATIC_VIDEO_FRAME_SIZE / Math.max(safeWidth, safeHeight),
  );

  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function loadImageElement(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load artwork image."));
    image.src = url;
  });
}

async function loadStaticVideoFrame(url: string): Promise<StaticVideoFrame> {
  const image = await loadImageElement(url);
  const dimensions = scaledStaticFrameDimensions(
    image.naturalWidth,
    image.naturalHeight,
  );
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create an artwork rendering canvas.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, dimensions.width, dimensions.height);

  return {
    canvas,
    dimensions,
  };
}

function initialPlaybackTime(
  seconds: number | null | undefined,
  duration: number,
) {
  const safeDuration = Math.max(Number.isFinite(duration) ? duration : 0, 0);
  const safeSeconds = Number(seconds);
  if (!Number.isFinite(safeSeconds) || safeSeconds < 0 || safeDuration <= 0) {
    return 0;
  }

  return Math.min(safeSeconds, safeDuration);
}

async function ensurePlaybackCodecs() {
  const { ensureMediabunnyCodecs } = await import("@/lib/mediabunnyCodecs");
  await ensureMediabunnyCodecs();
}

async function detectFrameStepSeconds(
  sourceVideoTrack: InputVideoTrack | null,
  isLivePlayback: boolean,
) {
  if (!sourceVideoTrack) {
    return DEFAULT_EDITOR_FRAME_STEP_SECONDS;
  }

  const stats = await sourceVideoTrack.computePacketStats(
    120,
    isLivePlayback ? { skipLiveWait: true } : undefined,
  );

  return frameStepSecondsFromFrameRate(stats.averagePacketRate);
}

export function useEditorPlayback({
  hlsSource,
  directSource,
  initialDuration,
  initialCurrentTime,
  startTime,
  endTime,
  sessionId,
  selectedAudioTrack,
  posterImageUrl,
  subtitleCues = [],
  subtitlesEnabled = false,
  subtitleStyleSettings,
}: UseEditorPlaybackProps) {
  const [duration, setDuration] = useState(() => Math.max(initialDuration, 0));
  const [currentTime, setCurrentTime] = useState(() =>
    initialPlaybackTime(initialCurrentTime, initialDuration),
  );
  const [playing, setPlaying] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [previewStatus, setPreviewStatus] = useState("Loading stream...");
  const [loadingPreviewFrame, setLoadingPreviewFrame] = useState(false);
  const [previewFrameStatus, setPreviewFrameStatus] = useState(
    "Loading preview frame...",
  );
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [activeSourceLabel, setActiveSourceLabel] = useState("");
  const [exportFallbackSource, setExportFallbackSource] = useState<
    EditorMediaSource | undefined
  >(undefined);
  const [hlsFallbackInfo, setHlsFallbackInfo] =
    useState<PlaybackFallbackInfo | null>(null);
  const [sourceVideoDimensions, setSourceVideoDimensions] =
    useState<VideoDimensions | null>(null);
  const [previewVideoDimensions, setPreviewVideoDimensions] =
    useState<VideoDimensions | null>(null);
  const [frameStepSeconds, setFrameStepSeconds] = useState(
    DEFAULT_EDITOR_FRAME_STEP_SECONDS,
  );
  const [playbackReadyRange, setPlaybackReadyRange] =
    useState<PlaybackReadyRange | null>(null);
  const playbackLogger = useMemo(
    () => logger.with({ "editor.session.id": sessionId }),
    [sessionId],
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<Input | null>(null);
  const videoSinkRef = useRef<CanvasSink | null>(null);
  const audioSinkRef = useRef<AudioBufferSink | null>(null);
  const staticVideoFrameRef = useRef<HTMLCanvasElement | null>(null);
  const videoFrameIteratorRef = useRef<AsyncGenerator<
    WrappedCanvas,
    void,
    unknown
  > | null>(null);
  const audioBufferIteratorRef = useRef<AsyncGenerator<
    WrappedAudioBuffer,
    void,
    unknown
  > | null>(null);
  const nextFrameRef = useRef<WrappedCanvas | null>(null);
  const displayedFrameRef = useRef<WrappedCanvas | null>(null);
  const displayedStaticFrameRef = useRef<{
    canvas: HTMLCanvasElement;
    timestamp: number;
  } | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const queuedAudioNodesRef = useRef(new Set<AudioBufferSourceNode>());
  const animationFrameRef = useRef<number | null>(null);
  const renderIntervalRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const warmupGenerationRef = useRef(0);
  const warmupPromiseRef = useRef<Promise<void> | null>(null);
  const warmupTargetTimeRef = useRef<number | null>(null);
  const previewFrameLoadGenerationRef = useRef(0);
  const previewFrameLoadPromiseRef = useRef<Promise<void> | null>(null);
  const previewFrameLoadTargetTimeRef = useRef<number | null>(null);
  const selectionWarmupGenerationRef = useRef(0);
  const selectionWarmupPromiseRef = useRef<Promise<void> | null>(null);
  const selectionWarmupVideoIteratorRef = useRef<AsyncGenerator<
    WrappedCanvas,
    void,
    unknown
  > | null>(null);
  const selectionWarmupAudioIteratorRef = useRef<AsyncGenerator<
    WrappedAudioBuffer,
    void,
    unknown
  > | null>(null);
  const selectionWarmupExtensionTimeoutRef = useRef<number | null>(null);
  const autoWarmupSessionKeyRef = useRef<string | null>(null);
  const wasPlayingRef = useRef(false);
  const playingRef = useRef(false);
  const audioContextStartTimeRef = useRef<number | null>(null);
  const playbackTimeAtStartRef = useRef(
    initialPlaybackTime(initialCurrentTime, initialDuration),
  );
  const playbackStopTimeRef = useRef<number | null>(null);
  const playbackResetTimeRef = useRef<number | null>(null);
  const sourceTimelineOffsetRef = useRef(0);
  const skipLiveWaitRef = useRef(false);
  const activeSourceLabelRef = useRef(activeSourceLabel);
  const playbackReadyRangeRef = useRef<PlaybackReadyRange | null>(null);

  const durationRef = useRef(duration);
  const startTimeRef = useRef(startTime);
  const endTimeRef = useRef(endTime);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);
  const subtitleCuesRef = useRef<readonly SubtitleCue[]>(subtitleCues);
  const subtitlesEnabledRef = useRef(subtitlesEnabled);
  const subtitleStyleSettingsRef = useRef(subtitleStyleSettings);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    startTimeRef.current = startTime;
  }, [startTime]);

  useEffect(() => {
    endTimeRef.current = endTime;
  }, [endTime]);

  useEffect(() => {
    activeSourceLabelRef.current = activeSourceLabel;
  }, [activeSourceLabel]);

  useEffect(() => {
    playbackReadyRangeRef.current = playbackReadyRange;
  }, [playbackReadyRange]);

  const clearSelectionWarmState = useCallback(() => {
    setPlaybackReadyRange((current) => {
      if (!current) {
        playbackReadyRangeRef.current = null;
        return current;
      }

      const next = resetPlaybackReadyRangeWarmState(current);
      playbackReadyRangeRef.current = next;
      return next;
    });
  }, []);

  const setPlaybackError = useCallback(
    (message: string) => {
      clearSelectionWarmState();
      setError(message);
    },
    [clearSelectionWarmState],
  );

  useEffect(() => {
    if (
      !playbackReadyRange ||
      playbackReadyRange.status === "idle" ||
      playbackReadyRange.expiresAtMs === undefined
    ) {
      return;
    }

    const expiresAtMs = playbackReadyRange.expiresAtMs;
    const timeoutId = window.setTimeout(
      () => {
        setPlaybackReadyRange((current) => {
          if (!current || current.expiresAtMs !== expiresAtMs) {
            return current;
          }

          const next = resetPlaybackReadyRangeWarmState(current);
          playbackReadyRangeRef.current = next;
          return next;
        });
      },
      Math.max(0, expiresAtMs - Date.now()),
    );

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [playbackReadyRange]);

  useEffect(() => {
    volumeRef.current = volume;
    mutedRef.current = muted;
    applyPlaybackGain(gainNodeRef.current, volume, muted);
  }, [volume, muted]);

  useEffect(() => {
    subtitleCuesRef.current = subtitleCues;
  }, [subtitleCues]);

  useEffect(() => {
    subtitlesEnabledRef.current = subtitlesEnabled;
  }, [subtitlesEnabled]);

  useEffect(() => {
    subtitleStyleSettingsRef.current = subtitleStyleSettings;
  }, [subtitleStyleSettings]);

  const clampTime = useCallback((seconds: number) => {
    const maxDuration = durationRef.current;
    if (!Number.isFinite(maxDuration) || maxDuration <= 0) {
      return 0;
    }
    return Math.min(Math.max(seconds, 0), maxDuration);
  }, []);

  const getPlaybackTime = useCallback(() => {
    if (
      playingRef.current &&
      audioContextRef.current &&
      audioContextStartTimeRef.current !== null
    ) {
      return clampTime(
        audioContextRef.current.currentTime -
          audioContextStartTimeRef.current +
          playbackTimeAtStartRef.current,
      );
    }
    return clampTime(playbackTimeAtStartRef.current);
  }, [clampTime]);

  const stopAudioNodes = useCallback(() => {
    stopQueuedAudioNodes(queuedAudioNodesRef.current);
  }, []);

  const pausePlayback = useCallback(
    (storeCurrentTime = true) => {
      if (storeCurrentTime) {
        const nextTime = getPlaybackTime();
        playbackTimeAtStartRef.current = nextTime;
        setCurrentTime(nextTime);
      }
      playingRef.current = false;
      setPlaying(false);
      void audioBufferIteratorRef.current?.return();
      audioBufferIteratorRef.current = null;
      stopAudioNodes();
    },
    [getPlaybackTime, stopAudioNodes],
  );

  const {
    drawCanvasFrame,
    drawFrame,
    startVideoIterator,
    startRenderLoop,
    stopRenderLoop,
  } = useEditorPlaybackRenderLoop({
    canvasRef,
    inputRef,
    videoSinkRef,
    staticVideoFrameRef,
    videoFrameIteratorRef,
    nextFrameRef,
    displayedFrameRef,
    displayedStaticFrameRef,
    animationFrameRef,
    renderIntervalRef,
    generationRef,
    playingRef,
    playbackTimeAtStartRef,
    playbackStopTimeRef,
    playbackResetTimeRef,
    sourceTimelineOffsetRef,
    skipLiveWaitRef,
    durationRef,
    endTimeRef,
    subtitleCuesRef,
    subtitlesEnabledRef,
    subtitleStyleSettingsRef,
    getPlaybackTime,
    clampTime,
    pausePlayback,
    setCurrentTime,
    setError: setPlaybackError,
  });

  const {
    cancelSelectionWarmup,
    warmClipStart,
    warmClipSelection,
    scheduleSelectionWarmupExtension,
  } = useEditorPlaybackWarmup({
    loadingPreview,
    activeSourceLabel,
    playing,
    currentTime,
    startTime,
    endTime,
    sessionId,
    videoSinkRef,
    audioSinkRef,
    generationRef,
    warmupGenerationRef,
    warmupPromiseRef,
    warmupTargetTimeRef,
    selectionWarmupGenerationRef,
    selectionWarmupPromiseRef,
    selectionWarmupVideoIteratorRef,
    selectionWarmupAudioIteratorRef,
    selectionWarmupExtensionTimeoutRef,
    autoWarmupSessionKeyRef,
    wasPlayingRef,
    playingRef,
    activeSourceLabelRef,
    playbackReadyRangeRef,
    sourceTimelineOffsetRef,
    skipLiveWaitRef,
    startTimeRef,
    endTimeRef,
    clampTime,
    setPlaybackReadyRange,
  });

  const clearPreviewFrameLoad = useCallback(() => {
    previewFrameLoadGenerationRef.current++;
    previewFrameLoadPromiseRef.current = null;
    previewFrameLoadTargetTimeRef.current = null;
    setLoadingPreviewFrame(false);
  }, []);

  const loadPreviewFrameAtPlaybackTime = useCallback(
    async (status = "Loading preview frame...") => {
      const targetTime = Number(
        clampTime(playbackTimeAtStartRef.current).toFixed(6),
      );
      const pendingLoad = previewFrameLoadPromiseRef.current;
      const pendingTargetTime = previewFrameLoadTargetTimeRef.current;
      if (
        pendingLoad &&
        pendingTargetTime !== null &&
        Math.abs(pendingTargetTime - targetTime) < 1e-6
      ) {
        return pendingLoad;
      }

      const frameLoadGeneration = ++previewFrameLoadGenerationRef.current;
      setPreviewFrameStatus(status);
      setLoadingPreviewFrame(true);

      const frameLoadPromise = startVideoIterator();
      previewFrameLoadPromiseRef.current = frameLoadPromise;
      previewFrameLoadTargetTimeRef.current = targetTime;

      try {
        await frameLoadPromise;
      } finally {
        if (frameLoadGeneration === previewFrameLoadGenerationRef.current) {
          previewFrameLoadPromiseRef.current = null;
          previewFrameLoadTargetTimeRef.current = null;
          setLoadingPreviewFrame(false);
        }
      }
    },
    [clampTime, startVideoIterator],
  );

  const resetPreview = useCallback(
    (advanceGeneration = false, clearActiveSource = false) => {
      if (advanceGeneration) {
        generationRef.current++;
      }
      warmupGenerationRef.current++;
      cancelSelectionWarmup();
      autoWarmupSessionKeyRef.current = null;
      if (clearActiveSource) {
        setActiveSourceLabel("");
      }
      setSourceVideoDimensions(null);
      setPreviewVideoDimensions(null);
      pausePlayback(false);
      stopRenderLoop();
      void videoFrameIteratorRef.current?.return();
      void audioBufferIteratorRef.current?.return();
      videoFrameIteratorRef.current = null;
      audioBufferIteratorRef.current = null;
      nextFrameRef.current = null;
      staticVideoFrameRef.current = null;
      sourceTimelineOffsetRef.current = 0;
      skipLiveWaitRef.current = false;
      playbackStopTimeRef.current = null;
      playbackResetTimeRef.current = null;
      warmupPromiseRef.current = null;
      warmupTargetTimeRef.current = null;
      clearPreviewFrameLoad();
      displayedFrameRef.current = null;
      displayedStaticFrameRef.current = null;
      disposePlaybackSinkResources({
        inputRef,
        videoSinkRef,
        audioSinkRef,
        audioContextRef,
        gainNodeRef,
      });
      setPlaybackReadyRange(null);
    },
    [
      cancelSelectionWarmup,
      clearPreviewFrameLoad,
      pausePlayback,
      stopRenderLoop,
    ],
  );

  useEffect(() => {
    const displayedFrame = displayedFrameRef.current;
    if (displayedFrame) {
      drawFrame(displayedFrame);
      return;
    }

    const displayedStaticFrame = displayedStaticFrameRef.current;
    if (displayedStaticFrame) {
      drawCanvasFrame(displayedStaticFrame);
    }
  }, [
    drawCanvasFrame,
    drawFrame,
    subtitleCues,
    subtitlesEnabled,
    subtitleStyleSettings,
  ]);

  const disposePreview = useCallback(() => {
    resetPreview(true, true);
  }, [resetPreview]);

  const runAudioIterator = useCallback(
    async (generation: number) => {
      await runPlaybackAudioIterator({
        iterator: audioBufferIteratorRef.current,
        audioContext: audioContextRef.current,
        gainNode: gainNodeRef.current,
        queuedAudioNodes: queuedAudioNodesRef.current,
        generation,
        generationRef,
        playingRef,
        audioContextStartTimeRef,
        playbackTimeAtStartRef,
        sourceTimelineOffsetRef,
        getPlaybackTime,
        onError: (err) => {
          setPlaybackError(errorMessage(err));
          pausePlayback();
        },
      });
    },
    [getPlaybackTime, pausePlayback, setPlaybackError],
  );

  const playPreview = useCallback(async () => {
    if (!inputRef.current || loadingPreview) {
      return;
    }

    const clipStart = clampTime(startTimeRef.current);
    const clipEnd = Math.min(
      endTimeRef.current || durationRef.current,
      durationRef.current,
    );
    const playbackTime = getPlaybackTime();
    const playbackPlan = resolvePreviewPlaybackPlan({
      currentTime: playbackTime,
      clipStart,
      clipEnd,
      duration: durationRef.current,
    });
    if (playbackPlan.mode === "source") {
      clearSelectionWarmState();
    }
    const playbackStartTarget = clampTime(playbackPlan.startTime);
    const pendingWarmup = warmupPromiseRef.current;
    const warmupTargetTime = warmupTargetTimeRef.current;
    if (
      pendingWarmup &&
      warmupTargetTime !== null &&
      Math.abs(warmupTargetTime - playbackStartTarget) < 1e-6
    ) {
      await pendingWarmup.catch(() => undefined);
      if (!inputRef.current || loadingPreview) {
        return;
      }
    }

    const pendingFrameLoad = previewFrameLoadPromiseRef.current;
    const pendingFrameTargetTime = previewFrameLoadTargetTimeRef.current;
    if (
      pendingFrameLoad &&
      pendingFrameTargetTime !== null &&
      Math.abs(pendingFrameTargetTime - playbackStartTarget) < 1e-6
    ) {
      await pendingFrameLoad;
      if (!inputRef.current || loadingPreview) {
        return;
      }
    }

    cancelSelectionWarmup();

    playbackStopTimeRef.current = playbackPlan.stopTime;
    playbackResetTimeRef.current = playbackPlan.resetTime;

    if (Math.abs(playbackTime - playbackStartTarget) > 1e-6) {
      playbackTimeAtStartRef.current = playbackStartTarget;
      setCurrentTime(playbackTimeAtStartRef.current);
      await loadPreviewFrameAtPlaybackTime();
    }

    if (playingRef.current) {
      return;
    }

    let audioContext = audioContextRef.current;
    if (!audioContext) {
      const AudioContextConstructor = getAudioContextConstructor();
      if (!AudioContextConstructor) {
        throw new Error("This browser does not provide Web Audio.");
      }
      audioContext = new AudioContextConstructor();
      audioContextRef.current = audioContext;
    }

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    audioContextStartTimeRef.current = audioContext.currentTime;
    playingRef.current = true;
    setPlaying(true);

    if (audioSinkRef.current) {
      void audioBufferIteratorRef.current?.return();
      const packetRetrievalOptions = skipLiveWaitRef.current
        ? { skipLiveWait: true }
        : undefined;
      audioBufferIteratorRef.current = audioSinkRef.current.buffers(
        toSourceTimelineTime(
          getPlaybackTime(),
          sourceTimelineOffsetRef.current,
        ),
        Infinity,
        packetRetrievalOptions,
      );
      void runAudioIterator(generationRef.current);
    }
  }, [
    cancelSelectionWarmup,
    clampTime,
    clearSelectionWarmState,
    getPlaybackTime,
    loadPreviewFrameAtPlaybackTime,
    loadingPreview,
    runAudioIterator,
  ]);

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      pausePlayback();
      return;
    }

    void playPreview().catch((err) => {
      setPlaying(false);
      playingRef.current = false;
      setPlaybackError(errorMessage(err));
    });
  }, [pausePlayback, playPreview, setPlaybackError]);

  const seekToTime = useCallback(
    async (seconds: number) => {
      const nextTime = clampTime(seconds);
      const wasPlaying = playingRef.current;
      const currentReadyRange = playbackReadyRangeRef.current;
      const seekPlaybackPlan = resolvePreviewPlaybackPlan({
        currentTime: nextTime,
        clipStart: startTimeRef.current,
        clipEnd: endTimeRef.current,
        duration: durationRef.current,
      });

      if (wasPlaying) {
        pausePlayback();
      }

      if (seekPlaybackPlan.mode === "source") {
        clearSelectionWarmState();
      }

      playbackStopTimeRef.current = null;
      playbackResetTimeRef.current = null;
      playbackTimeAtStartRef.current = nextTime;
      setCurrentTime(nextTime);
      try {
        await loadPreviewFrameAtPlaybackTime();
      } catch (err) {
        setPlaybackError(errorMessage(err));
        return;
      }

      if (
        !wasPlaying &&
        (activeSourceLabelRef.current === "HLS stream" ||
          activeSourceLabelRef.current === "HLS URL") &&
        (!currentReadyRange ||
          nextTime < currentReadyRange.startTime ||
          nextTime > currentReadyRange.readyUntilTime)
      ) {
        void warmClipStart(nextTime);
        if (seekPlaybackPlan.mode === "selection") {
          void warmClipSelection(startTimeRef.current, endTimeRef.current, {
            extendToSelectionEnd: false,
          });
          scheduleSelectionWarmupExtension(
            startTimeRef.current,
            endTimeRef.current,
          );
        } else {
          cancelSelectionWarmup();
        }
      }

      if (wasPlaying && nextTime < durationRef.current && !playingRef.current) {
        void playPreview();
      }
    },
    [
      cancelSelectionWarmup,
      clampTime,
      clearSelectionWarmState,
      loadPreviewFrameAtPlaybackTime,
      pausePlayback,
      playPreview,
      scheduleSelectionWarmupExtension,
      setPlaybackError,
      warmClipStart,
      warmClipSelection,
    ],
  );

  useEffect(() => {
    const playbackSources = buildPlaybackSourceCandidates(
      hlsSource,
      directSource,
    );
    const fallbackDirectSource = playbackSources.find(
      (source) =>
        source.label === "direct source" ||
        source.label === "local file" ||
        source.label === "url",
    )?.source;
    if (playbackSources.length === 0) {
      return;
    }

    let cancelled = false;
    disposePreview();
    const generation = generationRef.current;

    async function loadPreview() {
      const resetDuration = Math.max(initialDuration, 0);
      setLoadingPreview(true);
      setPreviewStatus("Loading stream...");
      setError("");
      setActiveSourceLabel("");
      setExportFallbackSource(undefined);
      setHlsFallbackInfo(null);
      setDuration(resetDuration);
      durationRef.current = resetDuration;
      setSourceVideoDimensions(null);
      setPreviewVideoDimensions(null);
      setFrameStepSeconds(DEFAULT_EDITOR_FRAME_STEP_SECONDS);
      const resetCurrentTime = initialPlaybackTime(
        initialCurrentTime,
        resetDuration,
      );
      setCurrentTime(resetCurrentTime);
      playbackTimeAtStartRef.current = resetCurrentTime;
      sourceTimelineOffsetRef.current = 0;
      skipLiveWaitRef.current = false;
      playbackStopTimeRef.current = null;
      playbackResetTimeRef.current = null;

      try {
        const failures: PlaybackLoadFailure[] = [];
        let nextExportFallbackSource: EditorMediaSource | undefined;
        let nextHlsFallbackInfo: PlaybackFallbackInfo | null = null;

        for (const playbackSource of playbackSources) {
          const attemptStartedAt = Date.now();
          let playbackSourceAnalysisContext:
            | PlaybackSourceAnalysisContext
            | undefined;
          setPreviewStatus(
            failures.length === 0
              ? `Loading ${playbackSource.label}...`
              : `${describePlaybackFailure(failures[failures.length - 1])} Retrying with ${playbackSource.label}...`,
          );

          try {
            await ensurePlaybackCodecs();
            const { AudioBufferSink, CanvasSink } = await import("mediabunny");

            if (cancelled || generation !== generationRef.current) {
              return;
            }

            const input = await createCliparrInputFromSource(
              playbackSource.source,
              {
                hls:
                  playbackSource.label === "hls stream" ||
                  playbackSource.label === "hls url",
              },
            );
            inputRef.current = input;

            const videoTracks = await input.getVideoTracks({
              filter: async (track) => !(await track.hasOnlyKeyPackets()),
            });
            const { sourceVideoTrack, previewVideoTrack, warnings } =
              await selectPreviewVideoTrack(videoTracks);
            const allAudioTracks = await input.getAudioTracks();
            const sourceAudioTrack = await selectPreferredPairableAudioTrack(
              sourceVideoTrack,
              allAudioTracks,
              selectedAudioTrack,
            );
            let previewAudioTrack = await selectPreferredPairableAudioTrack(
              previewVideoTrack,
              allAudioTracks,
              selectedAudioTrack,
            );
            const sourceTracks: InputTrack[] = [
              sourceVideoTrack,
              sourceAudioTrack,
            ].filter(isPresent);
            const timelineTracks =
              sourceTracks.length > 0
                ? sourceTracks
                : [previewVideoTrack, previewAudioTrack].filter(isPresent);
            const trackLiveRefreshIntervals = await Promise.all(
              timelineTracks.map((track) => track.getLiveRefreshInterval()),
            );
            const isLivePlayback = trackLiveRefreshIntervals.some(
              (value) => value !== null,
            );
            skipLiveWaitRef.current = isLivePlayback;

            const previewAudioAssessment =
              await assessPreviewAudioTrack(previewAudioTrack);
            previewAudioTrack = previewAudioAssessment.track;
            if (previewAudioAssessment.warning) {
              warnings.push(previewAudioAssessment.warning);
            }
            const staticVideoFrame =
              !sourceVideoTrack && previewAudioTrack && posterImageUrl
                ? await loadStaticVideoFrame(posterImageUrl).catch(
                    (err: unknown) => {
                      warnWithError(
                        playbackLogger,
                        err,
                        "Could not load editor artwork for audio-only preview.",
                        {
                          ...logEventFields(
                            "editor.playback.artwork_load",
                            "failure",
                          ),
                          ...logErrorFields(err),
                          "media.artwork.present": Boolean(posterImageUrl),
                        },
                      );
                      return null;
                    },
                  )
                : null;
            playbackSourceAnalysisContext = {
              sessionId,
              source: playbackSource.label,
              mediaSource: playbackSource.source,
              selectedAudioTrack,
              videoTracks,
              allAudioTracks,
              sourceVideoTrack,
              previewVideoTrack,
              sourceAudioTrack,
              previewAudioTrack,
              previewAudioWarning: previewAudioAssessment.warning,
              warnings: [...warnings],
              isLivePlayback,
            };

            if (cancelled || generation !== generationRef.current) {
              return;
            }

            staticVideoFrameRef.current = staticVideoFrame?.canvas ?? null;

            if (
              previewVideoTrack &&
              allAudioTracks.length > 0 &&
              !previewAudioTrack &&
              playbackSourceAnalysisContext
            ) {
              playbackLogger.warn(
                "Editor playback source has no preview audio.",
                {
                  ...logEventFields(
                    "editor.playback.source_attempt",
                    "degraded",
                  ),
                  ...logDurationFields(attemptStartedAt),
                  ...playbackSourceLogFields(
                    playbackSource,
                    playbackSourceAnalysisContext,
                  ),
                  "playback.degraded.reason": "missing_preview_audio",
                },
              );
            }

            if (
              !previewVideoTrack &&
              previewAudioTrack &&
              !staticVideoFrame &&
              playbackSourceAnalysisContext
            ) {
              playbackLogger.warn(
                "Editor playback source has no preview video.",
                {
                  ...logEventFields(
                    "editor.playback.source_attempt",
                    "degraded",
                  ),
                  ...logDurationFields(attemptStartedAt),
                  ...playbackSourceLogFields(
                    playbackSource,
                    playbackSourceAnalysisContext,
                  ),
                  "playback.degraded.reason": "missing_preview_video",
                },
              );
            }

            const decoderEnvironmentWarning =
              browserDecoderEnvironmentWarning();
            if (
              sourceVideoTrack &&
              !previewVideoTrack &&
              decoderEnvironmentWarning
            ) {
              throw createPlaybackSourceError(
                "shared-export-blocking",
                decoderEnvironmentWarning,
              );
            }

            if (!previewVideoTrack && !previewAudioTrack) {
              throw createPlaybackSourceError(
                decoderEnvironmentWarning
                  ? "shared-export-blocking"
                  : "preview-only",
                decoderEnvironmentWarning ??
                  (warnings.join(" ") ||
                    "No decodable audio or video track found."),
              );
            }

            const durationTracks = sourceTracks;
            const timelineOffsetSeconds =
              await getTrackTimelineOffsetSeconds(durationTracks);
            sourceTimelineOffsetRef.current = timelineOffsetSeconds;
            const metadataDuration =
              durationTracks.length > 0
                ? await input.getDurationFromMetadata(
                    durationTracks,
                    isLivePlayback ? { skipLiveWait: true } : undefined,
                  )
                : null;
            const sourceTimelineEnd =
              durationTracks.length > 0
                ? metadataDuration && metadataDuration > 0
                  ? metadataDuration
                  : await input.computeDuration(
                      durationTracks,
                      isLivePlayback ? { skipLiveWait: true } : undefined,
                    )
                : Math.max(initialDuration, 0);
            const computedDuration = fromSourceTimelineTime(
              sourceTimelineEnd,
              timelineOffsetSeconds,
            );
            const nextDuration = resolvePlaybackDuration(
              playbackSource,
              computedDuration,
              initialDuration,
            );
            setDuration(nextDuration);
            durationRef.current = nextDuration;
            const nextCurrentTime = initialPlaybackTime(
              initialCurrentTime,
              nextDuration,
            );
            setCurrentTime(nextCurrentTime);
            playbackTimeAtStartRef.current = nextCurrentTime;

            const [sourceDimensions, detectedFrameStepSeconds] =
              await Promise.all([
                sourceVideoTrack
                  ? getVideoTrackDimensions(sourceVideoTrack)
                  : Promise.resolve(null),
                detectFrameStepSeconds(sourceVideoTrack, isLivePlayback).catch(
                  (err: unknown) => {
                    warnWithError(
                      playbackLogger,
                      err,
                      "Could not detect editor playback frame rate.",
                      {
                        ...logEventFields(
                          "editor.playback.frame_rate_detect",
                          "failure",
                        ),
                        ...logErrorFields(err),
                        "playback.source.label": playbackSource.label,
                      },
                    );
                    return DEFAULT_EDITOR_FRAME_STEP_SECONDS;
                  },
                ),
              ]);
            const previewDimensions =
              sourceDimensions ?? staticVideoFrame?.dimensions ?? null;
            const audioTrackSampleRate = previewAudioTrack
              ? await getAudioTrackSampleRate(previewAudioTrack)
              : undefined;

            if (sourceDimensions) {
              setSourceVideoDimensions(sourceDimensions);
            }
            setFrameStepSeconds(detectedFrameStepSeconds);

            if (previewDimensions) {
              setPreviewVideoDimensions(previewDimensions);
              const canvas = canvasRef.current;
              if (canvas) {
                canvas.width = previewDimensions.width;
                canvas.height = previewDimensions.height;
              }
            }

            try {
              const sinkResources = await createPlaybackSinkResources({
                CanvasSinkConstructor: CanvasSink,
                AudioBufferSinkConstructor: AudioBufferSink,
                previewVideoTrack,
                previewAudioTrack,
                audioTrackSampleRate,
                volume: volumeRef.current,
                muted: mutedRef.current,
              });

              videoSinkRef.current = sinkResources.videoSink;
              audioSinkRef.current = sinkResources.audioSink;
              audioContextRef.current = sinkResources.audioContext;
              gainNodeRef.current = sinkResources.gainNode;

              await startVideoIterator();
            } catch (err) {
              throw isPlaybackSourceError(err)
                ? err
                : createPlaybackSourceError("preview-only", errorMessage(err));
            }

            startRenderLoop();
            setActiveSourceLabel(
              formatPlaybackSourceLabel(playbackSource.label),
            );
            setExportFallbackSource(
              playbackSource.label === "direct source" ||
                playbackSource.label === "local file" ||
                playbackSource.label === "url"
                ? nextExportFallbackSource
                : undefined,
            );
            setHlsFallbackInfo(
              playbackSource.label === "direct source" ||
                playbackSource.label === "local file" ||
                playbackSource.label === "url"
                ? nextHlsFallbackInfo
                : null,
            );
            playbackLogger.info("Editor playback source loaded.", {
              ...logEventFields("editor.playback.source_attempt", "success"),
              ...logDurationFields(attemptStartedAt),
              ...playbackSourceLogFields(
                playbackSource,
                playbackSourceAnalysisContext,
              ),
              "playback.fallback.used": failures.length > 0,
              "playback.video.width": previewDimensions?.width,
              "playback.video.height": previewDimensions?.height,
              "playback.audio.sample_rate": audioTrackSampleRate,
              "playback.duration.seconds": nextDuration,
            });
            return;
          } catch (err) {
            const failure = buildPlaybackFailure(playbackSource, err);
            failures.push(failure);

            if (
              (failure.label === "hls stream" || failure.label === "hls url") &&
              shouldUseExportFallback(failure) &&
              fallbackDirectSource
            ) {
              nextExportFallbackSource = fallbackDirectSource;
            }

            if (failure.label === "hls stream" || failure.label === "hls url") {
              nextHlsFallbackInfo = {
                category: failure.category,
                message: failure.message,
              };
            }

            warnWithError(
              playbackLogger,
              err,
              "Editor playback source failed.",
              {
                ...logEventFields("editor.playback.source_attempt", "failure"),
                ...logDurationFields(attemptStartedAt),
                ...logErrorFields(err),
                ...playbackSourceLogFields(
                  playbackSource,
                  playbackSourceAnalysisContext,
                ),
                "playback.failure.classification": failure.classification,
                "playback.failure.category": failure.category,
                "playback.failure.message": failure.message,
                "playback.fallback.available": Boolean(fallbackDirectSource),
                "playback.fallback.used": Boolean(nextExportFallbackSource),
              },
            );

            if (cancelled) {
              return;
            }

            resetPreview(false);
          }
        }

        if (!cancelled) {
          setPlaybackError(buildPlaybackLoadError(failures));
          setHlsFallbackInfo(nextHlsFallbackInfo);
          setSourceVideoDimensions(null);
          setPreviewVideoDimensions(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingPreview(false);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
      disposePreview();
    };
  }, [
    directSource,
    hlsSource,
    initialCurrentTime,
    initialDuration,
    playbackLogger,
    posterImageUrl,
    selectedAudioTrack,
    sessionId,
    disposePreview,
    resetPreview,
    setPlaybackError,
    startRenderLoop,
    startVideoIterator,
  ]);

  return {
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
    frameStepSeconds,
    playbackReadyRange,
    volume,
    muted,
    setVolume,
    setMuted,
    togglePlay,
    pausePlayback,
    seekToTime,
    warmClipStart,
    warmClipSelection,
    setCurrentTime,
    playbackTimeAtStartRef,
  };
}
