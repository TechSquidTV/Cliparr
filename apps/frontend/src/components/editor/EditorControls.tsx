import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { formatTime } from "./EditorUtils";

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
}: EditorControlsProps) {
  const clipDuration = Math.max(0, endTime - startTime);
  const clipMetrics = [
    { label: "In", value: formatTime(startTime) },
    { label: "Out", value: formatTime(endTime) },
    { label: "Duration", value: formatTime(clipDuration), emphasized: true },
  ];

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
          <div className="font-mono text-sm font-semibold text-foreground">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
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
        </div>
        <div className="min-w-0 flex-1" />
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-right sm:gap-x-6">
          {clipMetrics.map((metric) => (
            <div key={metric.label} className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {metric.label}
              </span>
              <span
                className={`font-mono text-sm font-semibold ${
                  metric.emphasized ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {metric.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
