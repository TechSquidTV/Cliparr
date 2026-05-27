import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AudioBufferSink,
  CanvasSink,
  Input,
  InputTrack,
  WrappedAudioBuffer,
  WrappedCanvas,
} from "mediabunny";
import type { SubtitleCue, SubtitleStyleSettings } from "../../lib/subtitles/types";
import type { EditorMediaSource } from "../../lib/editorMedia";
import { ensureMediabunnyCodecs } from "../../lib/mediabunnyCodecs";
import { createCliparrInputFromSource } from "../../lib/mediabunnyInput";
import {
  fromSourceTimelineTime,
  getAudioTrackSampleRate,
  getTrackTimelineOffsetSeconds,
  getVideoTrackDimensions,
  toSourceTimelineTime,
} from "../../lib/mediabunnyTrackAccess";
import { selectPreferredPairableAudioTrack } from "../../lib/selectPreferredAudioTrack";
import type { PlaybackAudioSelection } from "../../providers/types";
import { errorMessage } from "./EditorUtils";
import {
  applyPlaybackGain,
  runPlaybackAudioIterator,
  stopQueuedAudioNodes,
} from "./editorPlaybackAudio";
import {
  assessPreviewAudioTrack,
  browserDecoderEnvironmentWarning,
  buildPlaybackFailure,
  buildPlaybackLoadError,
  buildPlaybackSourceAnalysis,
  buildPlaybackSourceCandidates,
  describePlaybackFailure,
  formatPlaybackSourceLabel,
  isPresent,
  PlaybackSourceError,
  resolvePlaybackDuration,
  selectPreviewVideoTrack,
  shouldUseExportFallback,
  type PlaybackFallbackInfo,
  type PlaybackLoadFailure,
  type PlaybackSourceAnalysisContext,
} from "./editorPlaybackSources";
import {
  createPlaybackSinkResources,
  disposePlaybackSinkResources,
  getAudioContextConstructor,
} from "./editorPlaybackSinks";
import { useEditorPlaybackRenderLoop } from "./useEditorPlaybackRenderLoop";
import {
  useEditorPlaybackWarmup,
  type PlaybackReadyRange,
} from "./useEditorPlaybackWarmup";

export type { PlaybackFallbackInfo } from "./editorPlaybackSources";
export type { PlaybackReadyRange } from "./useEditorPlaybackWarmup";

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

function scaledStaticFrameDimensions(width: number, height: number): VideoDimensions {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1280;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 720;
  const scale = Math.min(1, MAX_STATIC_VIDEO_FRAME_SIZE / Math.max(safeWidth, safeHeight));

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
  const dimensions = scaledStaticFrameDimensions(image.naturalWidth, image.naturalHeight);
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

function initialPlaybackTime(seconds: number | null | undefined, duration: number) {
  const safeDuration = Math.max(Number.isFinite(duration) ? duration : 0, 0);
  const safeSeconds = Number(seconds);
  if (!Number.isFinite(safeSeconds) || safeSeconds < 0 || safeDuration <= 0) {
    return 0;
  }

  return Math.min(safeSeconds, safeDuration);
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
  const [currentTime, setCurrentTime] = useState(() => initialPlaybackTime(initialCurrentTime, initialDuration));
  const [playing, setPlaying] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [previewStatus, setPreviewStatus] = useState("Loading stream...");
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [activeSourceLabel, setActiveSourceLabel] = useState("");
  const [exportFallbackSource, setExportFallbackSource] = useState<EditorMediaSource | undefined>(undefined);
  const [hlsFallbackInfo, setHlsFallbackInfo] = useState<PlaybackFallbackInfo | null>(null);
  const [sourceVideoDimensions, setSourceVideoDimensions] = useState<VideoDimensions | null>(null);
  const [previewVideoDimensions, setPreviewVideoDimensions] = useState<VideoDimensions | null>(null);
  const [playbackReadyRange, setPlaybackReadyRange] = useState<PlaybackReadyRange | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<Input | null>(null);
  const videoSinkRef = useRef<CanvasSink | null>(null);
  const audioSinkRef = useRef<AudioBufferSink | null>(null);
  const staticVideoFrameRef = useRef<HTMLCanvasElement | null>(null);
  const videoFrameIteratorRef = useRef<AsyncGenerator<WrappedCanvas, void, unknown> | null>(null);
  const audioBufferIteratorRef = useRef<AsyncGenerator<WrappedAudioBuffer, void, unknown> | null>(null);
  const nextFrameRef = useRef<WrappedCanvas | null>(null);
  const displayedFrameRef = useRef<WrappedCanvas | null>(null);
  const displayedStaticFrameRef = useRef<{ canvas: HTMLCanvasElement; timestamp: number } | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const queuedAudioNodesRef = useRef(new Set<AudioBufferSourceNode>());
  const animationFrameRef = useRef<number | null>(null);
  const renderIntervalRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const warmupGenerationRef = useRef(0);
  const warmupPromiseRef = useRef<Promise<void> | null>(null);
  const warmupTargetTimeRef = useRef<number | null>(null);
  const selectionWarmupGenerationRef = useRef(0);
  const selectionWarmupPromiseRef = useRef<Promise<void> | null>(null);
  const selectionWarmupVideoIteratorRef = useRef<AsyncGenerator<WrappedCanvas, void, unknown> | null>(null);
  const selectionWarmupAudioIteratorRef = useRef<AsyncGenerator<WrappedAudioBuffer, void, unknown> | null>(null);
  const selectionWarmupExtensionTimeoutRef = useRef<number | null>(null);
  const autoWarmupSessionKeyRef = useRef<string | null>(null);
  const wasPlayingRef = useRef(false);
  const playingRef = useRef(false);
  const audioContextStartTimeRef = useRef<number | null>(null);
  const playbackTimeAtStartRef = useRef(initialPlaybackTime(initialCurrentTime, initialDuration));
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
          playbackTimeAtStartRef.current
      );
    }
    return clampTime(playbackTimeAtStartRef.current);
  }, [clampTime]);

  const stopAudioNodes = useCallback(() => {
    stopQueuedAudioNodes(queuedAudioNodesRef.current);
  }, []);

  const pausePlayback = useCallback((storeCurrentTime = true) => {
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
  }, [getPlaybackTime, stopAudioNodes]);

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
    sourceTimelineOffsetRef,
    skipLiveWaitRef,
    durationRef,
    startTimeRef,
    endTimeRef,
    subtitleCuesRef,
    subtitlesEnabledRef,
    subtitleStyleSettingsRef,
    getPlaybackTime,
    clampTime,
    pausePlayback,
    setCurrentTime,
    setError,
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

  const resetPreview = useCallback((advanceGeneration = false, clearActiveSource = false) => {
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
    warmupPromiseRef.current = null;
    warmupTargetTimeRef.current = null;
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
  }, [cancelSelectionWarmup, pausePlayback, stopRenderLoop]);

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
  }, [drawCanvasFrame, drawFrame, subtitleCues, subtitlesEnabled, subtitleStyleSettings]);

  const disposePreview = useCallback(() => {
    resetPreview(true, true);
  }, [resetPreview]);

  const runAudioIterator = useCallback(async (generation: number) => {
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
        setError(errorMessage(err));
        pausePlayback();
      },
    });
  }, [getPlaybackTime, pausePlayback]);

  const playPreview = useCallback(async () => {
    if (!inputRef.current || loadingPreview) {
      return;
    }

    const clipStart = clampTime(startTimeRef.current);
    const clipEnd = Math.min(endTimeRef.current || durationRef.current, durationRef.current);
    const playbackTime = getPlaybackTime();
    const playbackStartTarget = (
      playbackTime < clipStart || playbackTime >= clipEnd
        ? clipStart
        : clampTime(playbackTime)
    );
    const pendingWarmup = warmupPromiseRef.current;
    const warmupTargetTime = warmupTargetTimeRef.current;
    if (
      pendingWarmup
      && warmupTargetTime !== null
      && Math.abs(warmupTargetTime - playbackStartTarget) < 1e-6
    ) {
      await pendingWarmup.catch(() => undefined);
      if (!inputRef.current || loadingPreview) {
        return;
      }
    }

    cancelSelectionWarmup();

    if (playbackTime < clipStart || playbackTime >= clipEnd) {
      playbackTimeAtStartRef.current = clipStart;
      setCurrentTime(playbackTimeAtStartRef.current);
      await startVideoIterator();
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
      const packetRetrievalOptions = skipLiveWaitRef.current ? { skipLiveWait: true } : undefined;
      audioBufferIteratorRef.current = audioSinkRef.current.buffers(
        toSourceTimelineTime(getPlaybackTime(), sourceTimelineOffsetRef.current),
        Infinity,
        packetRetrievalOptions,
      );
      void runAudioIterator(generationRef.current);
    }
  }, [cancelSelectionWarmup, clampTime, getPlaybackTime, loadingPreview, runAudioIterator, startVideoIterator]);

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      pausePlayback();
      return;
    }

    void playPreview().catch((err) => {
      setPlaying(false);
      playingRef.current = false;
      setError(errorMessage(err));
    });
  }, [pausePlayback, playPreview]);

  const seekToTime = useCallback(async (seconds: number) => {
    const nextTime = clampTime(seconds);
    const wasPlaying = playingRef.current;
    const currentReadyRange = playbackReadyRangeRef.current;

    if (wasPlaying) {
      pausePlayback();
    }

    playbackTimeAtStartRef.current = nextTime;
    setCurrentTime(nextTime);
    await startVideoIterator();

    if (
      !wasPlaying
      && (activeSourceLabelRef.current === "HLS stream" || activeSourceLabelRef.current === "HLS URL")
      && (
        !currentReadyRange
        || nextTime < currentReadyRange.startTime
        || nextTime > currentReadyRange.readyUntilTime
      )
    ) {
      void warmClipStart(nextTime);
      void warmClipSelection(startTimeRef.current, endTimeRef.current, {
        extendToSelectionEnd: false,
      });
      scheduleSelectionWarmupExtension(startTimeRef.current, endTimeRef.current);
    }

    if (wasPlaying && nextTime < endTimeRef.current) {
      void playPreview();
    }
  }, [
    clampTime,
    endTimeRef,
    pausePlayback,
    playPreview,
    scheduleSelectionWarmupExtension,
    startVideoIterator,
    warmClipStart,
    warmClipSelection,
  ]);

  useEffect(() => {
    const playbackSources = buildPlaybackSourceCandidates(hlsSource, directSource);
    const fallbackDirectSource = playbackSources.find((source) =>
      source.label === "direct source"
      || source.label === "local file"
      || source.label === "url"
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
      const resetCurrentTime = initialPlaybackTime(initialCurrentTime, resetDuration);
      setCurrentTime(resetCurrentTime);
      playbackTimeAtStartRef.current = resetCurrentTime;
      sourceTimelineOffsetRef.current = 0;
      skipLiveWaitRef.current = false;

      try {
        const failures: PlaybackLoadFailure[] = [];
        let nextExportFallbackSource: EditorMediaSource | undefined;
        let nextHlsFallbackInfo: PlaybackFallbackInfo | null = null;

        for (const playbackSource of playbackSources) {
          let playbackSourceAnalysisContext: PlaybackSourceAnalysisContext | undefined;
          setPreviewStatus(
            failures.length === 0
              ? `Loading ${playbackSource.label}...`
              : `${describePlaybackFailure(failures[failures.length - 1])} Retrying with ${playbackSource.label}...`
          );

          try {
            await ensureMediabunnyCodecs();
            const { AudioBufferSink, CanvasSink } = await import("mediabunny");

            if (cancelled || generation !== generationRef.current) {
              return;
            }

            const input = await createCliparrInputFromSource(playbackSource.source, {
              hls: playbackSource.label === "hls stream" || playbackSource.label === "hls url",
            });
            inputRef.current = input;

            const videoTracks = await input.getVideoTracks({
              filter: async (track) => !(await track.hasOnlyKeyPackets()),
            });
            const {
              sourceVideoTrack,
              previewVideoTrack,
              warnings,
            } = await selectPreviewVideoTrack(videoTracks);
            const allAudioTracks = await input.getAudioTracks();
            const sourceAudioTrack = await selectPreferredPairableAudioTrack(
              sourceVideoTrack,
              allAudioTracks,
              selectedAudioTrack
            );
            let previewAudioTrack = await selectPreferredPairableAudioTrack(
              previewVideoTrack,
              allAudioTracks,
              selectedAudioTrack
            );
            const sourceTracks: InputTrack[] = [sourceVideoTrack, sourceAudioTrack].filter(isPresent);
            const timelineTracks = sourceTracks.length > 0
              ? sourceTracks
              : [previewVideoTrack, previewAudioTrack].filter(isPresent);
            const trackLiveRefreshIntervals = await Promise.all(
              timelineTracks.map((track) => track.getLiveRefreshInterval())
            );
            const isLivePlayback = trackLiveRefreshIntervals.some((value) => value !== null);
            skipLiveWaitRef.current = isLivePlayback;

            const previewAudioAssessment = await assessPreviewAudioTrack(previewAudioTrack);
            previewAudioTrack = previewAudioAssessment.track;
            if (previewAudioAssessment.warning) {
              warnings.push(previewAudioAssessment.warning);
            }
            const staticVideoFrame = !sourceVideoTrack && previewAudioTrack && posterImageUrl
              ? await loadStaticVideoFrame(posterImageUrl).catch((err: unknown) => {
                  console.warn("Could not load editor artwork for audio-only preview", {
                    sessionId,
                    posterImageUrl,
                    errorMessage: errorMessage(err),
                  });
                  return null;
                })
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

            if (previewVideoTrack && allAudioTracks.length > 0 && !previewAudioTrack && playbackSourceAnalysisContext) {
              console.warn(
                "Editor playback source loaded without preview audio",
                await buildPlaybackSourceAnalysis(playbackSourceAnalysisContext),
              );
            }

            if (!previewVideoTrack && previewAudioTrack && !staticVideoFrame && playbackSourceAnalysisContext) {
              console.warn(
                "Editor playback source loaded without preview video",
                await buildPlaybackSourceAnalysis(playbackSourceAnalysisContext),
              );
            }

            const decoderEnvironmentWarning = browserDecoderEnvironmentWarning();
            if (sourceVideoTrack && !previewVideoTrack && decoderEnvironmentWarning) {
              throw new PlaybackSourceError("shared-export-blocking", decoderEnvironmentWarning);
            }

            if (!previewVideoTrack && !previewAudioTrack) {
              throw new PlaybackSourceError(
                decoderEnvironmentWarning ? "shared-export-blocking" : "preview-only",
                decoderEnvironmentWarning ?? (warnings.join(" ") || "No decodable audio or video track found.")
              );
            }

            const durationTracks = sourceTracks;
            const timelineOffsetSeconds = await getTrackTimelineOffsetSeconds(durationTracks);
            sourceTimelineOffsetRef.current = timelineOffsetSeconds;
            const metadataDuration = durationTracks.length > 0
              ? await input.getDurationFromMetadata(
                durationTracks,
                isLivePlayback ? { skipLiveWait: true } : undefined
              )
              : null;
            const sourceTimelineEnd = durationTracks.length > 0
              ? metadataDuration && metadataDuration > 0
                ? metadataDuration
                : await input.computeDuration(
                  durationTracks,
                  isLivePlayback ? { skipLiveWait: true } : undefined
                )
              : Math.max(initialDuration, 0);
            const computedDuration = fromSourceTimelineTime(sourceTimelineEnd, timelineOffsetSeconds);
            const nextDuration = resolvePlaybackDuration(
              playbackSource,
              computedDuration,
              initialDuration,
            );
            setDuration(nextDuration);
            durationRef.current = nextDuration;
            const nextCurrentTime = initialPlaybackTime(initialCurrentTime, nextDuration);
            setCurrentTime(nextCurrentTime);
            playbackTimeAtStartRef.current = nextCurrentTime;

            const sourceDimensions = sourceVideoTrack
              ? await getVideoTrackDimensions(sourceVideoTrack)
              : null;
            const previewDimensions = sourceDimensions ?? staticVideoFrame?.dimensions ?? null;
            const audioTrackSampleRate = previewAudioTrack
              ? await getAudioTrackSampleRate(previewAudioTrack)
              : undefined;

            if (sourceDimensions) {
              setSourceVideoDimensions(sourceDimensions);
            }

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
              throw err instanceof PlaybackSourceError
                ? err
                : new PlaybackSourceError("preview-only", errorMessage(err));
            }

            startRenderLoop();
            setActiveSourceLabel(formatPlaybackSourceLabel(playbackSource.label));
            setExportFallbackSource(
              playbackSource.label === "direct source"
              || playbackSource.label === "local file"
              || playbackSource.label === "url"
                ? nextExportFallbackSource
                : undefined
            );
            setHlsFallbackInfo(
              playbackSource.label === "direct source"
              || playbackSource.label === "local file"
              || playbackSource.label === "url"
                ? nextHlsFallbackInfo
                : null
            );
            return;
          } catch (err) {
            const failure = buildPlaybackFailure(playbackSource, err);
            failures.push(failure);
            const playbackSourceAnalysis = playbackSourceAnalysisContext
              ? await buildPlaybackSourceAnalysis(playbackSourceAnalysisContext)
              : undefined;

            if (
              (failure.label === "hls stream" || failure.label === "hls url")
              && shouldUseExportFallback(failure)
              && fallbackDirectSource
            ) {
              nextExportFallbackSource = fallbackDirectSource;
            }

            if (
              failure.label === "hls stream"
              || failure.label === "hls url"
            ) {
              nextHlsFallbackInfo = {
                category: failure.category,
                message: failure.message,
              };
            }

            console.warn("Editor playback source failed", {
              sessionId,
              source: failure.label,
              classification: failure.classification,
              category: failure.category,
              message: failure.message,
              analysis: playbackSourceAnalysis,
            });

            if (cancelled) {
              return;
            }

            resetPreview(false);
          }
        }

        if (!cancelled) {
          setError(buildPlaybackLoadError(failures));
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
    posterImageUrl,
    selectedAudioTrack,
    sessionId,
    disposePreview,
    resetPreview,
    startRenderLoop,
    startVideoIterator,
  ]);

  return {
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
    warmClipStart,
    warmClipSelection,
    setCurrentTime,
    playbackTimeAtStartRef,
  };
}
