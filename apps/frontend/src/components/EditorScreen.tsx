import { useCallback, useState } from "react";
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

    const currentPreviewTime = playbackTimeAtStartRef.current;
    if (currentPreviewTime < roundedStart || currentPreviewTime > roundedEnd) {
      void seekToTime(roundedStart);
    }
  }, [duration, playbackTimeAtStartRef, seekToTime]);

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

  if (!session.mediaUrl) {
    return (
      <div className="min-h-screen bg-background text-foreground p-8 flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">Could not find media file for this session.</p>
          <button onClick={onBack} className="text-primary hover:underline">Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <EditorHeader
        title={session.title}
        onBack={onBack}
        resolution={resolution}
        setResolution={setResolution}
        exporting={exporting}
        progress={progress}
        handleExport={handleExport}
      />

      <main className="flex-1 flex flex-col items-center justify-center p-8 max-w-6xl mx-auto w-full gap-8">
        {error && (
          <div className="w-full bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg text-sm">
            {error}
          </div>
        )}

        <EditorPreview
          canvasRef={canvasRef}
          playing={playing}
          loadingPreview={loadingPreview}
          previewStatus={previewStatus}
          togglePlay={togglePlay}
        />

        <div className="w-full bg-card text-card-foreground border border-border rounded-lg p-6">
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

          <div className="space-y-4">
            {!hasDuration && (
              <div className="bg-secondary/10 border border-secondary/20 text-secondary p-3 rounded-lg text-sm">
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
                duration={duration}
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
          </div>
        </div>
      </main>
    </div>
  );
}
