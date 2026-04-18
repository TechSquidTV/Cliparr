import { Play } from "lucide-react";
import type { RefObject } from "react";

interface EditorPreviewProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  activeSourceLabel: string;
  playing: boolean;
  loadingPreview: boolean;
  previewStatus: string;
  togglePlay: () => void;
}

export function EditorPreview({
  canvasRef,
  activeSourceLabel,
  playing,
  loadingPreview,
  previewStatus,
  togglePlay,
}: EditorPreviewProps) {
  return (
    <div className="group relative aspect-video h-full max-h-full w-auto max-w-full overflow-hidden bg-black">
      <canvas
        ref={canvasRef}
        className="h-full w-full object-contain"
        onClick={togglePlay}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            togglePlay();
          }}
          aria-label={playing ? "Pause preview" : "Play preview"}
          className={`pointer-events-auto flex h-11 w-11 items-center justify-center border border-white/12 bg-card/92 text-foreground transition-all ${
            playing ? "scale-95 opacity-0" : "scale-100 opacity-100 group-hover:bg-card"
          }`}
        >
          <Play className="ml-0.5 h-5 w-5" />
        </button>
      </div>
      {activeSourceLabel && (
        <div className="pointer-events-none absolute left-3 top-3 border border-white/12 bg-black/72 px-2 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white/80">
          {activeSourceLabel}
        </div>
      )}
      {loadingPreview && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/72 text-sm text-muted-foreground">
          {previewStatus}
        </div>
      )}
    </div>
  );
}
