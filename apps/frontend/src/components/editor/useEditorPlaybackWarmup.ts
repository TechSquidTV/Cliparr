import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { AudioBufferSink, CanvasSink, WrappedAudioBuffer, WrappedCanvas } from "mediabunny";
import { toSourceTimelineTime } from "../../lib/mediabunnyTrackAccess";
import { useEditorPlaybackSelectionWarmup } from "./useEditorPlaybackSelectionWarmup";
import type { PlaybackReadyRange, RefValue } from "./editorPlaybackWarmupTypes";

export type { PlaybackReadyRange } from "./editorPlaybackWarmupTypes";

interface UseEditorPlaybackWarmupOptions {
  loadingPreview: boolean;
  activeSourceLabel: string;
  playing: boolean;
  currentTime: number;
  startTime: number;
  endTime: number;
  sessionId: string;
  videoSinkRef: RefValue<CanvasSink | null>;
  audioSinkRef: RefValue<AudioBufferSink | null>;
  generationRef: RefValue<number>;
  warmupGenerationRef: RefValue<number>;
  warmupPromiseRef: RefValue<Promise<void> | null>;
  warmupTargetTimeRef: RefValue<number | null>;
  selectionWarmupGenerationRef: RefValue<number>;
  selectionWarmupPromiseRef: RefValue<Promise<void> | null>;
  selectionWarmupVideoIteratorRef: RefValue<AsyncGenerator<WrappedCanvas, void, unknown> | null>;
  selectionWarmupAudioIteratorRef: RefValue<AsyncGenerator<WrappedAudioBuffer, void, unknown> | null>;
  selectionWarmupExtensionTimeoutRef: RefValue<number | null>;
  autoWarmupSessionKeyRef: RefValue<string | null>;
  wasPlayingRef: RefValue<boolean>;
  playingRef: RefValue<boolean>;
  activeSourceLabelRef: RefValue<string>;
  playbackReadyRangeRef: RefValue<PlaybackReadyRange | null>;
  sourceTimelineOffsetRef: RefValue<number>;
  skipLiveWaitRef: RefValue<boolean>;
  startTimeRef: RefValue<number>;
  endTimeRef: RefValue<number>;
  clampTime: (seconds: number) => number;
  setPlaybackReadyRange: Dispatch<SetStateAction<PlaybackReadyRange | null>>;
}

export function useEditorPlaybackWarmup({
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
}: UseEditorPlaybackWarmupOptions) {
  const warmClipStart = useCallback(async (clipStart: number) => {
    if (
      loadingPreview ||
      playingRef.current ||
      activeSourceLabelRef.current !== "HLS stream"
    ) {
      return;
    }

    const videoSink = videoSinkRef.current;
    const audioSink = audioSinkRef.current;
    if (!videoSink && !audioSink) {
      return;
    }

    const displayTimestamp = Number(clampTime(clipStart).toFixed(6));
    if (!Number.isFinite(displayTimestamp)) {
      return;
    }
    if (
      warmupPromiseRef.current
      && warmupTargetTimeRef.current !== null
      && Math.abs(warmupTargetTimeRef.current - displayTimestamp) < 1e-6
    ) {
      return warmupPromiseRef.current;
    }

    const sourceTimestamp = toSourceTimelineTime(displayTimestamp, sourceTimelineOffsetRef.current);
    const packetRetrievalOptions = skipLiveWaitRef.current ? { skipLiveWait: true } : undefined;
    const warmupGeneration = ++warmupGenerationRef.current;
    const playbackGeneration = generationRef.current;
    warmupTargetTimeRef.current = displayTimestamp;

    const warmupPromise = (async () => {
      if (
        warmupGeneration !== warmupGenerationRef.current ||
        playbackGeneration !== generationRef.current ||
        playingRef.current
      ) {
        return;
      }

      try {
        await Promise.allSettled([
          videoSink ? videoSink.getCanvas(sourceTimestamp, packetRetrievalOptions) : Promise.resolve(null),
          audioSink ? audioSink.getBuffer(sourceTimestamp, packetRetrievalOptions) : Promise.resolve(null),
        ]);
      } catch {
        // Warmup is opportunistic; playback still works without it.
      }
    })();

    warmupPromiseRef.current = warmupPromise;
    try {
      await warmupPromise;
    } finally {
      if (warmupPromiseRef.current === warmupPromise) {
        warmupPromiseRef.current = null;
        warmupTargetTimeRef.current = null;
      }
    }
  }, [
    activeSourceLabelRef,
    audioSinkRef,
    clampTime,
    generationRef,
    loadingPreview,
    playingRef,
    skipLiveWaitRef,
    sourceTimelineOffsetRef,
    videoSinkRef,
    warmupGenerationRef,
    warmupPromiseRef,
    warmupTargetTimeRef,
  ]);

  const {
    cancelSelectionWarmup,
    warmClipSelection,
    scheduleSelectionWarmupExtension,
  } = useEditorPlaybackSelectionWarmup({
    loadingPreview,
    activeSourceLabel,
    playing,
    currentTime,
    startTime,
    endTime,
    sessionId,
    videoSinkRef,
    audioSinkRef,
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
    warmClipStart,
  });

  return {
    cancelSelectionWarmup,
    warmClipStart,
    warmClipSelection,
    scheduleSelectionWarmupExtension,
  };
}
