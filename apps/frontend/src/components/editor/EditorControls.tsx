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
  return (
    <div className="flex items-center justify-between mb-6 gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={togglePlay}
          disabled={loadingPreview}
          className="w-10 h-10 bg-secondary hover:bg-secondary/90 text-secondary-foreground disabled:opacity-50 disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-colors"
        >
          {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </button>
        <div className="text-sm font-medium font-mono">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMuted((current) => !current)}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
            aria-label={muted || volume === 0 ? "Unmute preview" : "Mute preview"}
          >
            {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
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
            className="w-24 accent-primary"
            aria-label="Preview volume"
          />
        </div>
        <div className="text-sm font-medium font-mono">
          Clip: {formatTime(startTime)} - {formatTime(endTime)}
        </div>
      </div>
      <div className="text-sm text-muted-foreground font-mono">
        {formatTime(endTime - startTime)}
      </div>
    </div>
  );
}
