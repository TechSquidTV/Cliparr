import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  AudioBufferSink,
  CanvasSink,
  WrappedAudioBuffer,
  WrappedCanvas,
} from "mediabunny";
import {
  fromSourceTimelineTime,
  toSourceTimelineTime,
} from "../../lib/mediabunnyTrackAccess";
import {
  createIdlePlaybackReadyRange,
  isPlaybackReadyRangeVisible,
  markPlaybackReadyRangeFresh,
  samePlaybackReadyRange,
} from "./editorPlaybackWarmupRange";
import { isPresent } from "./editorPlaybackSources";
import type {
  PlaybackReadyRange,
  RefValue,
  WarmClipSelectionOptions,
} from "./editorPlaybackWarmupTypes";

interface UseEditorPlaybackSelectionWarmupOptions {
  loadingPreview: boolean;
  activeSourceLabel: string;
  playing: boolean;
  currentTime: number;
  startTime: number;
  endTime: number;
  sessionId: string;
  videoSinkRef: RefValue<CanvasSink | null>;
  audioSinkRef: RefValue<AudioBufferSink | null>;
  selectionWarmupGenerationRef: RefValue<number>;
  selectionWarmupPromiseRef: RefValue<Promise<void> | null>;
  selectionWarmupVideoIteratorRef: RefValue<AsyncGenerator<
    WrappedCanvas,
    void,
    unknown
  > | null>;
  selectionWarmupAudioIteratorRef: RefValue<AsyncGenerator<
    WrappedAudioBuffer,
    void,
    unknown
  > | null>;
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
  warmClipStart: (clipStart: number) => Promise<void> | undefined;
}

const INITIAL_SELECTION_WARMUP_SECONDS = 8;
const SEEK_SELECTION_EXTENSION_DELAY_MS = 900;

export function useEditorPlaybackSelectionWarmup({
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
}: UseEditorPlaybackSelectionWarmupOptions) {
  const cancelScheduledSelectionWarmupExtension = useCallback(() => {
    if (selectionWarmupExtensionTimeoutRef.current !== null) {
      window.clearTimeout(selectionWarmupExtensionTimeoutRef.current);
      selectionWarmupExtensionTimeoutRef.current = null;
    }
  }, [selectionWarmupExtensionTimeoutRef]);

  const cancelSelectionWarmup = useCallback(() => {
    cancelScheduledSelectionWarmupExtension();
    selectionWarmupGenerationRef.current++;
    selectionWarmupPromiseRef.current = null;
    void selectionWarmupVideoIteratorRef.current?.return();
    void selectionWarmupAudioIteratorRef.current?.return();
    selectionWarmupVideoIteratorRef.current = null;
    selectionWarmupAudioIteratorRef.current = null;
  }, [
    cancelScheduledSelectionWarmupExtension,
    selectionWarmupAudioIteratorRef,
    selectionWarmupGenerationRef,
    selectionWarmupPromiseRef,
    selectionWarmupVideoIteratorRef,
  ]);

  const warmClipSelection = useCallback(
    async (
      clipStart: number,
      clipEnd: number,
      options: WarmClipSelectionOptions = {},
    ) => {
      if (
        loadingPreview ||
        playingRef.current ||
        activeSourceLabelRef.current !== "HLS stream"
      ) {
        return;
      }

      const extendToSelectionEnd = options.extendToSelectionEnd ?? true;
      const videoSink = videoSinkRef.current;
      const audioSink = audioSinkRef.current;
      if (!videoSink && !audioSink) {
        return;
      }

      const normalizedStart = Number(clampTime(clipStart).toFixed(6));
      const normalizedEnd = Number(clampTime(clipEnd).toFixed(6));
      if (
        !Number.isFinite(normalizedStart) ||
        !Number.isFinite(normalizedEnd) ||
        normalizedEnd <= normalizedStart
      ) {
        return;
      }

      const nextRange = markPlaybackReadyRangeFresh({
        startTime: normalizedStart,
        endTime: normalizedEnd,
        readyUntilTime: normalizedStart,
        status: "warming",
      });
      const currentReadyRange = playbackReadyRangeRef.current;
      if (
        samePlaybackReadyRange(currentReadyRange, nextRange) &&
        currentReadyRange?.status === "ready" &&
        currentReadyRange.readyUntilTime >= normalizedEnd &&
        isPlaybackReadyRangeVisible(currentReadyRange)
      ) {
        return;
      }

      setPlaybackReadyRange((current) => {
        if (samePlaybackReadyRange(current, nextRange) && current) {
          return markPlaybackReadyRangeFresh({
            ...current,
            status: current.status === "ready" ? "ready" : "warming",
          });
        }

        return nextRange;
      });

      await warmClipStart(normalizedStart);

      if (
        loadingPreview ||
        playingRef.current ||
        activeSourceLabelRef.current !== "HLS stream"
      ) {
        return;
      }

      cancelSelectionWarmup();
      const warmupGeneration = selectionWarmupGenerationRef.current;
      const packetRetrievalOptions = skipLiveWaitRef.current
        ? { skipLiveWait: true }
        : undefined;
      const initialReadyEnd = Math.min(
        normalizedEnd,
        normalizedStart + INITIAL_SELECTION_WARMUP_SECONDS,
      );

      let lastPublishedReadyUntil = normalizedStart;
      let videoReadyUntil = normalizedStart;
      let audioReadyUntil = normalizedStart;
      let videoReachedSelectionEnd = !videoSink;
      let audioReachedSelectionEnd = !audioSink;

      const computeReadyUntil = () => {
        const readyTimes = [
          videoSink ? videoReadyUntil : null,
          audioSink ? audioReadyUntil : null,
        ].filter(isPresent);

        return readyTimes.length > 0
          ? Math.min(...readyTimes)
          : normalizedStart;
      };

      const publishReadyUntil = (
        nextReadyUntil: number,
        status: PlaybackReadyRange["status"],
        force = false,
      ) => {
        const clampedReadyUntil = Math.max(
          normalizedStart,
          Math.min(normalizedEnd, Number(nextReadyUntil.toFixed(6))),
        );

        if (
          !force &&
          clampedReadyUntil < normalizedEnd &&
          clampedReadyUntil - lastPublishedReadyUntil < 0.25
        ) {
          return;
        }

        lastPublishedReadyUntil = Math.max(
          lastPublishedReadyUntil,
          clampedReadyUntil,
        );
        setPlaybackReadyRange((current) => {
          const baseRange: PlaybackReadyRange =
            samePlaybackReadyRange(current, nextRange) && current
              ? current
              : {
                  ...nextRange,
                  status: "idle",
                };
          const readyUntilTime = Math.max(
            baseRange.readyUntilTime,
            clampedReadyUntil,
          );

          if (
            baseRange.status === status &&
            Math.abs(baseRange.readyUntilTime - readyUntilTime) < 1e-6
          ) {
            return current ?? baseRange;
          }

          return markPlaybackReadyRangeFresh({
            startTime: normalizedStart,
            endTime: normalizedEnd,
            readyUntilTime,
            status,
          });
        });
      };

      const selectionWarmupPromise = (async () => {
        const isCancelled = () =>
          warmupGeneration !== selectionWarmupGenerationRef.current ||
          playingRef.current ||
          activeSourceLabelRef.current !== "HLS stream";

        const warmVideoRange = async (rangeStart: number, rangeEnd: number) => {
          if (!videoSink || rangeEnd <= rangeStart) {
            return true;
          }

          const iterator = videoSink.canvases(
            toSourceTimelineTime(rangeStart, sourceTimelineOffsetRef.current),
            toSourceTimelineTime(rangeEnd, sourceTimelineOffsetRef.current),
            packetRetrievalOptions,
          );
          selectionWarmupVideoIteratorRef.current = iterator;
          let completedRange = false;

          try {
            for await (const frame of iterator) {
              if (isCancelled()) {
                break;
              }

              videoReadyUntil = Math.max(
                videoReadyUntil,
                clampTime(
                  fromSourceTimelineTime(
                    frame.timestamp,
                    sourceTimelineOffsetRef.current,
                  ),
                ),
              );
              publishReadyUntil(computeReadyUntil(), "warming");

              if (videoReadyUntil >= rangeEnd) {
                completedRange = true;
                break;
              }
            }
          } catch {
            // Selection warmup is best-effort; playback still works without it.
          } finally {
            if (selectionWarmupVideoIteratorRef.current === iterator) {
              selectionWarmupVideoIteratorRef.current = null;
            }
          }

          if (
            !isCancelled() &&
            !completedRange &&
            rangeEnd - videoReadyUntil <= 0.5
          ) {
            completedRange = true;
          }

          if (!isCancelled() && completedRange) {
            videoReadyUntil = Math.max(videoReadyUntil, rangeEnd);
            if (rangeEnd >= normalizedEnd) {
              videoReachedSelectionEnd = true;
            }
            publishReadyUntil(computeReadyUntil(), "warming", true);
          }

          return completedRange;
        };

        const warmAudioRange = async (rangeStart: number, rangeEnd: number) => {
          if (!audioSink || rangeEnd <= rangeStart) {
            return true;
          }

          const iterator = audioSink.buffers(
            toSourceTimelineTime(rangeStart, sourceTimelineOffsetRef.current),
            toSourceTimelineTime(rangeEnd, sourceTimelineOffsetRef.current),
            packetRetrievalOptions,
          );
          selectionWarmupAudioIteratorRef.current = iterator;
          let completedRange = false;

          try {
            for await (const { buffer, timestamp } of iterator) {
              if (isCancelled()) {
                break;
              }

              audioReadyUntil = Math.max(
                audioReadyUntil,
                clampTime(
                  fromSourceTimelineTime(
                    timestamp + buffer.duration,
                    sourceTimelineOffsetRef.current,
                  ),
                ),
              );
              publishReadyUntil(computeReadyUntil(), "warming");

              if (audioReadyUntil >= rangeEnd) {
                completedRange = true;
                break;
              }
            }
          } catch {
            // Selection warmup is best-effort; playback still works without it.
          } finally {
            if (selectionWarmupAudioIteratorRef.current === iterator) {
              selectionWarmupAudioIteratorRef.current = null;
            }
          }

          if (
            !isCancelled() &&
            !completedRange &&
            rangeEnd - audioReadyUntil <= 0.05
          ) {
            completedRange = true;
          }

          if (!isCancelled() && completedRange) {
            audioReadyUntil = Math.max(audioReadyUntil, rangeEnd);
            if (rangeEnd >= normalizedEnd) {
              audioReachedSelectionEnd = true;
            }
            publishReadyUntil(computeReadyUntil(), "warming", true);
          }

          return completedRange;
        };

        await Promise.allSettled([
          warmVideoRange(normalizedStart, initialReadyEnd),
          warmAudioRange(normalizedStart, initialReadyEnd),
        ]);

        if (
          !isCancelled() &&
          extendToSelectionEnd &&
          normalizedEnd > initialReadyEnd
        ) {
          await Promise.allSettled([
            warmVideoRange(
              Math.max(videoReadyUntil, initialReadyEnd),
              normalizedEnd,
            ),
            warmAudioRange(
              Math.max(audioReadyUntil, initialReadyEnd),
              normalizedEnd,
            ),
          ]);
        }

        if (!isCancelled()) {
          publishReadyUntil(
            videoReachedSelectionEnd && audioReachedSelectionEnd
              ? normalizedEnd
              : computeReadyUntil(),
            videoReachedSelectionEnd && audioReachedSelectionEnd
              ? "ready"
              : "idle",
            true,
          );
        }
      })();

      selectionWarmupPromiseRef.current = selectionWarmupPromise;
      try {
        await selectionWarmupPromise;
      } finally {
        if (selectionWarmupPromiseRef.current === selectionWarmupPromise) {
          selectionWarmupPromiseRef.current = null;
        }
      }
    },
    [
      activeSourceLabelRef,
      audioSinkRef,
      cancelSelectionWarmup,
      clampTime,
      loadingPreview,
      playbackReadyRangeRef,
      playingRef,
      selectionWarmupAudioIteratorRef,
      selectionWarmupGenerationRef,
      selectionWarmupPromiseRef,
      selectionWarmupVideoIteratorRef,
      setPlaybackReadyRange,
      skipLiveWaitRef,
      sourceTimelineOffsetRef,
      videoSinkRef,
      warmClipStart,
    ],
  );

  const scheduleSelectionWarmupExtension = useCallback(
    (clipStart: number, clipEnd: number) => {
      cancelScheduledSelectionWarmupExtension();

      if (
        loadingPreview ||
        playingRef.current ||
        activeSourceLabelRef.current !== "HLS stream"
      ) {
        return;
      }

      const normalizedStart = Number(clampTime(clipStart).toFixed(6));
      const normalizedEnd = Number(clampTime(clipEnd).toFixed(6));
      if (
        !Number.isFinite(normalizedStart) ||
        !Number.isFinite(normalizedEnd) ||
        normalizedEnd <= normalizedStart
      ) {
        return;
      }

      selectionWarmupExtensionTimeoutRef.current = window.setTimeout(() => {
        selectionWarmupExtensionTimeoutRef.current = null;

        if (
          loadingPreview ||
          playingRef.current ||
          activeSourceLabelRef.current !== "HLS stream"
        ) {
          return;
        }

        void warmClipSelection(normalizedStart, normalizedEnd);
      }, SEEK_SELECTION_EXTENSION_DELAY_MS);
    },
    [
      activeSourceLabelRef,
      cancelScheduledSelectionWarmupExtension,
      clampTime,
      loadingPreview,
      playingRef,
      selectionWarmupExtensionTimeoutRef,
      warmClipSelection,
    ],
  );

  useEffect(() => {
    if (loadingPreview || activeSourceLabel !== "HLS stream") {
      autoWarmupSessionKeyRef.current = null;
      setPlaybackReadyRange(null);
      return;
    }

    const normalizedStart = Number(clampTime(startTime).toFixed(6));
    const normalizedEnd = Number(clampTime(endTime).toFixed(6));
    if (
      !Number.isFinite(normalizedStart) ||
      !Number.isFinite(normalizedEnd) ||
      normalizedEnd <= normalizedStart
    ) {
      setPlaybackReadyRange(null);
      return;
    }

    const nextRange = createIdlePlaybackReadyRange(
      normalizedStart,
      normalizedEnd,
    );

    setPlaybackReadyRange((current) =>
      samePlaybackReadyRange(current, nextRange) ? current : nextRange,
    );

    const warmupSessionKey = `${sessionId}:hls:${normalizedStart}:${normalizedEnd}`;
    if (autoWarmupSessionKeyRef.current === warmupSessionKey) {
      return;
    }

    autoWarmupSessionKeyRef.current = warmupSessionKey;
    void warmClipSelection(startTimeRef.current, endTimeRef.current, {
      extendToSelectionEnd: false,
    });
    scheduleSelectionWarmupExtension(startTimeRef.current, endTimeRef.current);
  }, [
    activeSourceLabel,
    autoWarmupSessionKeyRef,
    clampTime,
    endTime,
    endTimeRef,
    loadingPreview,
    scheduleSelectionWarmupExtension,
    sessionId,
    setPlaybackReadyRange,
    startTime,
    startTimeRef,
    warmClipSelection,
  ]);

  useEffect(() => {
    if (
      wasPlayingRef.current &&
      !playing &&
      !loadingPreview &&
      activeSourceLabel === "HLS stream"
    ) {
      const currentReadyRange = playbackReadyRangeRef.current;
      if (currentReadyRange && currentReadyRange.status !== "ready") {
        const selectionStart = clampTime(startTimeRef.current);
        if (selectionStart < endTimeRef.current) {
          void warmClipSelection(selectionStart, endTimeRef.current, {
            extendToSelectionEnd: false,
          });
          scheduleSelectionWarmupExtension(selectionStart, endTimeRef.current);
        }
      }
    }

    wasPlayingRef.current = playing;
  }, [
    activeSourceLabel,
    clampTime,
    currentTime,
    endTimeRef,
    loadingPreview,
    playbackReadyRangeRef,
    playing,
    scheduleSelectionWarmupExtension,
    startTimeRef,
    warmClipSelection,
    wasPlayingRef,
  ]);

  useEffect(() => {
    if (!playing || activeSourceLabel !== "HLS stream") {
      return;
    }

    const normalizedCurrent = Number(clampTime(currentTime).toFixed(6));
    setPlaybackReadyRange((current) => {
      if (
        !current ||
        normalizedCurrent < current.startTime ||
        normalizedCurrent > current.endTime
      ) {
        return current;
      }

      const readyUntilTime = Math.max(
        current.readyUntilTime,
        normalizedCurrent,
      );
      const status = readyUntilTime >= current.endTime ? "ready" : "warming";

      if (
        current.status === status &&
        Math.abs(current.readyUntilTime - readyUntilTime) < 1e-6
      ) {
        return current;
      }

      return markPlaybackReadyRangeFresh({
        ...current,
        readyUntilTime,
        status,
      });
    });
  }, [
    activeSourceLabel,
    clampTime,
    currentTime,
    playing,
    setPlaybackReadyRange,
  ]);

  return {
    cancelSelectionWarmup,
    warmClipSelection,
    scheduleSelectionWarmupExtension,
  };
}
