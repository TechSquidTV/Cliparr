import { useMemo } from "react";
import { Pause, Play, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import { EditorEditableTimecode } from "./EditorEditableTimecode";
import { EditorPreviewTimecode } from "./EditorPreviewTimecode";
import { formatTime, formatTimecodeInput } from "./EditorUtils";

interface EditorControlsProps {
  playing: boolean;
  loadingPreview: boolean;
  togglePlay: () => void;
  currentTime: number;
  duration: number;
  startTime: number;
  endTime: number;
  muted: boolean;
  setMuted: (muted: boolean | ((prev: boolean) => boolean)) => void;
  volume: number;
  setVolume: (volume: number) => void;
  handleTimelineZoomIn: () => void;
  handleTimelineZoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onPreviewTimeCommit: (time: number) => void | Promise<void>;
  onStartTimeCommit: (time: number) => void | Promise<void>;
  onEndTimeCommit: (time: number) => void | Promise<void>;
}

export function EditorControls({
  playing,
  loadingPreview,
  togglePlay,
  currentTime,
  duration,
  startTime,
  endTime,
  muted,
  setMuted,
  volume,
  setVolume,
  handleTimelineZoomIn,
  handleTimelineZoomOut,
  canZoomIn,
  canZoomOut,
  onPreviewTimeCommit,
  onStartTimeCommit,
  onEndTimeCommit,
}: EditorControlsProps) {
  const hasDuration = duration > 0;
  const canEditPreviewTime = !loadingPreview && hasDuration;
  const canEditClipRange = !loadingPreview && !playing && hasDuration;
  const clipMetrics = useMemo(() => {
    const clipDuration = Math.max(0, endTime - startTime);

    return [
      { label: "In", value: startTime, onCommit: onStartTimeCommit },
      { label: "Out", value: endTime, onCommit: onEndTimeCommit },
      { label: "Duration", value: clipDuration, emphasized: true },
    ];
  }, [endTime, onEndTimeCommit, onStartTimeCommit, startTime]);

  return (
    <div className="border-b border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2.5">
          <button
            onClick={togglePlay}
            disabled={loadingPreview}
            aria-label={playing ? "Pause preview" : "Play preview"}
            className="flex h-8 w-8 items-center justify-center border border-border bg-accent text-foreground transition-colors hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
          </button>
          <EditorEditableTimecode
            ariaLabel="preview time"
            buttonClassName="text-foreground"
            disabled={!canEditPreviewTime}
            onCommit={onPreviewTimeCommit}
            value={currentTime}
            valueLabel={`${formatTimecodeInput(currentTime)} of ${formatTimecodeInput(duration)}`}
          >
            <EditorPreviewTimecode ariaHidden currentTime={currentTime} duration={duration} />
          </EditorEditableTimecode>
        </div>
        <div className="h-5 w-px bg-border" />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMuted((current) => !current)}
            className="flex h-8 w-8 items-center justify-center border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={muted || volume === 0 ? "Unmute preview" : "Mute preview"}
          >
            {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(event) => {
              const nextVolume = Number(event.target.value);
              setVolume(nextVolume);
              setMuted(nextVolume === 0);
            }}
            className="w-24 accent-primary sm:w-28"
            aria-label="Preview volume"
          />
          <div className="ml-1 flex items-center overflow-hidden border border-border bg-background">
            <button
              type="button"
              onClick={handleTimelineZoomOut}
              disabled={!canZoomOut}
              className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Zoom timeline out"
              title="Zoom timeline out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleTimelineZoomIn}
              disabled={!canZoomIn}
              className="flex h-8 w-8 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Zoom timeline in"
              title="Zoom timeline in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-w-0 flex-1" />
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-right sm:gap-x-6">
          {clipMetrics.map((metric) => (
            <div key={metric.label} className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
                {metric.label}
              </span>
              {metric.onCommit ? (
                <EditorEditableTimecode
                  ariaLabel={`${metric.label} time`}
                  buttonClassName="font-mono text-sm font-semibold text-muted-foreground hover:text-foreground"
                  disabled={!canEditClipRange}
                  onCommit={metric.onCommit}
                  value={metric.value}
                >
                  <span>{formatTime(metric.value)}</span>
                </EditorEditableTimecode>
              ) : (
                <span
                  className={`font-mono text-sm font-semibold ${
                    metric.emphasized ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {formatTime(metric.value)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
