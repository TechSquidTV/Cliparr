import { useCallback, useEffect, useState } from "react";
import { MIN_CLIP_SECONDS, roundTimelineTime } from "./editor/EditorUtils";
import { useEditorPlayback } from "./editor/useEditorPlayback";
import { useEditorTimeline } from "./editor/useEditorTimeline";
import { EditorHeader } from "./editor/EditorHeader";
import { EditorPreview } from "./editor/EditorPreview";
import { EditorControls } from "./editor/EditorControls";
import { EditorTimeline } from "./editor/EditorTimeline";
import type { CurrentlyPlayingItem } from "../providers/types";

interface Props {
  session: CurrentlyPlayingItem;
  onBack: () => void;
}

function isInteractiveKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest("input, textarea, select, button, [contenteditable=\"true\"], [role=\"slider\"]"),
  );
}

export default function EditorScreen({ session, onBack }: Props) {
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(() => Math.min(10, Math.max(session.duration, 0)));
  const [resolution, setResolution] = useState<"original" | "1080" | "720">("original");
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const {
    canvasRef,
    currentTime,
    duration,
    playing,
    loadingPreview,
    previewStatus,
    error,
    volume,
    muted,
    setVolume,
    setMuted,
    togglePlay,
    pausePlayback,
    seekToTime,
    setCurrentTime,
    playbackTimeAtStartRef,
  } = useEditorPlayback({
    mediaUrl: session.mediaUrl ?? "",
    initialDuration: session.duration,
    startTime,
    endTime,
    sessionId: session.id,
  });

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

  const {
    timelineRef,
    timelineWheelRegionRef,
    timelineData,
    timelineEffects,
    activeTimelineScale,
    timelineScaleCount,
    handleTimelineScroll,
    handleTimelineWheel,
    handleTimelineChange,
    hasDuration,
  } = useEditorTimeline({
    duration,
    startTime,
    endTime,
    currentTime,
    sessionId: session.id,
    updateClipRange,
  });

  const handleExport = async () => {
    if (!session.mediaUrl) return;
    setExporting(true);
    setProgress(0);

    try {
      const { exportClip } = await import("../lib/exportClip");
      const blob = await exportClip({
        mediaUrl: session.mediaUrl,
        startTime,
        endTime,
        resolution,
        metadata: session.exportMetadata,
        onProgress: setProgress,
      });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${session.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}-clip.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space") {
        return;
      }

      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (isInteractiveKeyboardTarget(event.target)) {
        return;
      }

      event.preventDefault();
      togglePlay();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [togglePlay]);

  if (!session.mediaUrl) {
    return (
      <div className="flex h-dvh items-center justify-center overflow-hidden bg-background p-8 text-foreground">
        <div className="text-center">
          <p className="text-destructive mb-4">Could not find media file for this session.</p>
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
        resolution={resolution}
        setResolution={setResolution}
        exporting={exporting}
        progress={progress}
        handleExport={handleExport}
      />

      <main className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
        <div className="flex h-full min-h-0 flex-col gap-3">
          {error && (
            <div className="border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <section className="flex min-h-0 flex-1 items-center justify-center overflow-hidden border border-border bg-card p-3">
            <EditorPreview
              canvasRef={canvasRef}
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
            />

            {!hasDuration && (
              <div className="border-t border-border px-3 py-3 text-sm text-muted-foreground">
                Waiting for media duration before clip controls can be adjusted.
              </div>
            )}

            {hasDuration && (
              <EditorTimeline
                timelineRef={timelineRef}
                timelineWheelRegionRef={timelineWheelRegionRef}
                timelineData={timelineData}
                timelineEffects={timelineEffects}
                activeTimelineScale={activeTimelineScale}
                timelineScaleCount={timelineScaleCount}
                loadingPreview={loadingPreview}
                playing={playing}
                handleTimelineScroll={handleTimelineScroll}
                handleTimelineChange={handleTimelineChange}
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
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
