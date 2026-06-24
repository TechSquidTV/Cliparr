import { useCallback } from "react";
import type { CanvasSink, Input, WrappedCanvas } from "mediabunny";
import {
  fromSourceTimelineTime,
  toSourceTimelineTime,
} from "@/lib/mediabunnyTrackAccess";
import { getActiveSubtitleCues } from "@/lib/subtitles/getActiveSubtitleCue";
import { renderSubtitleCues } from "@/lib/subtitles/renderSubtitleCue";
import type { SubtitleCue, SubtitleStyleSettings } from "@/lib/subtitles/types";
import { errorMessage, themeValue } from "@/components/editor/editorUtilities";

type ReferenceValue<T> = {
  current: T;
};

interface StaticVideoFrame {
  canvas: HTMLCanvasElement;
  timestamp: number;
}

interface UseEditorPlaybackRenderLoopOptions {
  canvasRef: ReferenceValue<HTMLCanvasElement | null>;
  inputRef: ReferenceValue<Input | null>;
  videoSinkRef: ReferenceValue<CanvasSink | null>;
  staticVideoFrameRef: ReferenceValue<HTMLCanvasElement | null>;
  videoFrameIteratorRef: ReferenceValue<AsyncGenerator<
    WrappedCanvas,
    void,
    unknown
  > | null>;
  nextFrameRef: ReferenceValue<WrappedCanvas | null>;
  displayedFrameRef: ReferenceValue<WrappedCanvas | null>;
  displayedStaticFrameRef: ReferenceValue<StaticVideoFrame | null>;
  animationFrameRef: ReferenceValue<number | null>;
  renderIntervalRef: ReferenceValue<ReturnType<
    typeof globalThis.setInterval
  > | null>;
  generationRef: ReferenceValue<number>;
  playingRef: ReferenceValue<boolean>;
  playbackTimeAtStartRef: ReferenceValue<number>;
  playbackStopTimeRef: ReferenceValue<number | null>;
  playbackResetTimeRef: ReferenceValue<number | null>;
  sourceTimelineOffsetRef: ReferenceValue<number>;
  skipLiveWaitRef: ReferenceValue<boolean>;
  durationRef: ReferenceValue<number>;
  endTimeRef: ReferenceValue<number>;
  subtitleCuesRef: ReferenceValue<readonly SubtitleCue[]>;
  subtitlesEnabledRef: ReferenceValue<boolean>;
  subtitleStyleSettingsRef: ReferenceValue<SubtitleStyleSettings | undefined>;
  getPlaybackTime: () => number;
  clampTime: (seconds: number) => number;
  pausePlayback: (storeCurrentTime?: boolean) => void;
  setCurrentTime: (seconds: number) => void;
  setCurrentTimeDuringPlayback: (seconds: number) => void;
  onPlaybackTimeUpdate?: (seconds: number) => void;
  setError: (message: string) => void;
}

export function useEditorPlaybackRenderLoop({
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
  setCurrentTimeDuringPlayback,
  onPlaybackTimeUpdate,
  setError,
}: UseEditorPlaybackRenderLoopOptions) {
  const drawCanvasFrame = useCallback(
    (frame: Pick<WrappedCanvas, "canvas" | "timestamp">) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) {
        return;
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(frame.canvas, 0, 0, canvas.width, canvas.height);

      if (subtitlesEnabledRef.current && subtitleStyleSettingsRef.current) {
        const cues = getActiveSubtitleCues(
          subtitleCuesRef.current,
          fromSourceTimelineTime(
            frame.timestamp,
            sourceTimelineOffsetRef.current,
          ),
        );
        if (cues.length > 0) {
          renderSubtitleCues(
            context,
            cues,
            subtitleStyleSettingsRef.current,
            canvas.width,
            canvas.height,
          );
        }
      }
    },
    [
      canvasRef,
      sourceTimelineOffsetRef,
      subtitleCuesRef,
      subtitleStyleSettingsRef,
      subtitlesEnabledRef,
    ],
  );

  const drawFrame = useCallback(
    (frame: WrappedCanvas) => {
      drawCanvasFrame(frame);
      displayedFrameRef.current = frame;
      displayedStaticFrameRef.current = null;
    },
    [displayedFrameRef, displayedStaticFrameRef, drawCanvasFrame],
  );

  const drawStaticFrame = useCallback(() => {
    const staticFrameCanvas = staticVideoFrameRef.current;
    if (!staticFrameCanvas) {
      return false;
    }

    const frame = {
      canvas: staticFrameCanvas,
      timestamp: toSourceTimelineTime(
        getPlaybackTime(),
        sourceTimelineOffsetRef.current,
      ),
    };
    drawCanvasFrame(frame);
    displayedFrameRef.current = null;
    displayedStaticFrameRef.current = frame;
    return true;
  }, [
    displayedFrameRef,
    displayedStaticFrameRef,
    drawCanvasFrame,
    getPlaybackTime,
    sourceTimelineOffsetRef,
    staticVideoFrameRef,
  ]);

  const drawPlaceholder = useCallback(
    (message: string) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) {
        return;
      }
      if (!canvas.width || !canvas.height) {
        canvas.width = 1280;
        canvas.height = 720;
      }
      const bodyStyles = getComputedStyle(document.body);
      context.fillStyle = themeValue(
        "--editor-preview-stage",
        bodyStyles.backgroundColor,
      );
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = themeValue(
        "--editor-preview-overlay-foreground",
        bodyStyles.color,
      );
      context.font = `${themeValue(
        "--text-editor-preview-fallback",
        bodyStyles.fontSize,
      )} ${themeValue("--font-sans", bodyStyles.fontFamily)}`;
      context.textAlign = "center";
      context.fillText(message, canvas.width / 2, canvas.height / 2);
      displayedFrameRef.current = null;
      displayedStaticFrameRef.current = null;
    },
    [canvasRef, displayedFrameRef, displayedStaticFrameRef],
  );

  const startVideoIterator = useCallback(async () => {
    const videoSink = videoSinkRef.current;
    const generation = ++generationRef.current;
    void videoFrameIteratorRef.current?.return();
    videoFrameIteratorRef.current = null;
    nextFrameRef.current = null;

    if (!videoSink) {
      if (!drawStaticFrame()) {
        drawPlaceholder("Audio only");
      }
      return;
    }

    const packetRetrievalOptions = skipLiveWaitRef.current
      ? { skipLiveWait: true }
      : undefined;
    videoFrameIteratorRef.current = videoSink.canvases(
      toSourceTimelineTime(getPlaybackTime(), sourceTimelineOffsetRef.current),
      Infinity,
      packetRetrievalOptions,
    );
    const firstResult = await videoFrameIteratorRef.current.next();
    const secondResult = await videoFrameIteratorRef.current.next();
    const firstFrame = firstResult.done
      ? null
      : (firstResult.value as WrappedCanvas);
    const secondFrame = secondResult.done
      ? null
      : (secondResult.value as WrappedCanvas);

    if (generation !== generationRef.current) {
      return;
    }

    nextFrameRef.current = secondFrame;
    if (firstFrame) {
      drawFrame(firstFrame);
    }
  }, [
    drawFrame,
    drawStaticFrame,
    drawPlaceholder,
    generationRef,
    getPlaybackTime,
    nextFrameRef,
    skipLiveWaitRef,
    sourceTimelineOffsetRef,
    videoFrameIteratorRef,
    videoSinkRef,
  ]);

  const updateNextFrame = useCallback(
    async (generation: number) => {
      const iterator = videoFrameIteratorRef.current;
      if (!iterator) {
        return;
      }

      try {
        while (generation === generationRef.current) {
          const result = await iterator.next();
          const nextCandidateFrame = result.done
            ? null
            : (result.value as WrappedCanvas);
          if (!nextCandidateFrame || generation !== generationRef.current) {
            break;
          }

          const playbackTime = getPlaybackTime();
          if (
            fromSourceTimelineTime(
              nextCandidateFrame.timestamp,
              sourceTimelineOffsetRef.current,
            ) <= playbackTime
          ) {
            drawFrame(nextCandidateFrame);
          } else {
            nextFrameRef.current = nextCandidateFrame;
            break;
          }
        }
      } catch (error) {
        if (generation === generationRef.current) {
          setError(errorMessage(error));
        }
      }
    },
    [
      drawFrame,
      generationRef,
      getPlaybackTime,
      nextFrameRef,
      setError,
      sourceTimelineOffsetRef,
      videoFrameIteratorRef,
    ],
  );

  const renderFrame = useCallback(() => {
    if (!inputRef.current) {
      return;
    }

    const playbackTime = getPlaybackTime();
    onPlaybackTimeUpdate?.(playbackTime);
    const duration = durationRef.current;
    const stopTime =
      playbackStopTimeRef.current ??
      Math.min(endTimeRef.current || duration, duration);

    if (playingRef.current && playbackTime >= stopTime) {
      pausePlayback(false);
      const nextTime = clampTime(playbackResetTimeRef.current ?? stopTime);
      playbackTimeAtStartRef.current = nextTime;
      setCurrentTime(nextTime);
      playbackStopTimeRef.current = null;
      playbackResetTimeRef.current = null;
      if (nextTime < duration) {
        void startVideoIterator();
      }
      return;
    }

    const nextFrame = nextFrameRef.current;
    if (
      nextFrame &&
      fromSourceTimelineTime(
        nextFrame.timestamp,
        sourceTimelineOffsetRef.current,
      ) <= playbackTime
    ) {
      drawFrame(nextFrame);
      nextFrameRef.current = null;
      void updateNextFrame(generationRef.current);
    }

    setCurrentTimeDuringPlayback(playbackTime);
  }, [
    clampTime,
    drawFrame,
    durationRef,
    endTimeRef,
    generationRef,
    getPlaybackTime,
    inputRef,
    nextFrameRef,
    pausePlayback,
    playbackResetTimeRef,
    playbackStopTimeRef,
    playbackTimeAtStartRef,
    playingRef,
    onPlaybackTimeUpdate,
    setCurrentTime,
    setCurrentTimeDuringPlayback,
    sourceTimelineOffsetRef,
    startVideoIterator,
    updateNextFrame,
  ]);

  const stopRenderLoop = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (renderIntervalRef.current !== null) {
      globalThis.clearInterval(renderIntervalRef.current);
      renderIntervalRef.current = null;
    }
  }, [animationFrameRef, renderIntervalRef]);

  const startRenderLoop = useCallback(() => {
    stopRenderLoop();
    const tick = () => {
      renderFrame();
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    animationFrameRef.current = requestAnimationFrame(tick);
    renderIntervalRef.current = globalThis.setInterval(renderFrame, 500);
  }, [animationFrameRef, renderFrame, renderIntervalRef, stopRenderLoop]);

  return {
    drawCanvasFrame,
    drawFrame,
    drawPlaceholder,
    startVideoIterator,
    startRenderLoop,
    stopRenderLoop,
  };
}
