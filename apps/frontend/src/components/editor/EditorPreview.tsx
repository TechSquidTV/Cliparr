import { Play } from "lucide-react";
import { RefObject } from "react";

interface EditorPreviewProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  playing: boolean;
  loadingPreview: boolean;
  previewStatus: string;
  togglePlay: () => void;
}

export function EditorPreview({
  canvasRef,
  playing,
  loadingPreview,
  previewStatus,
  togglePlay,
}: EditorPreviewProps) {
  return (
    <div className="w-full aspect-video bg-background rounded-lg overflow-hidden border border-border shadow-2xl relative group">
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain"
        onClick={togglePlay}
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            togglePlay();
          }}
          className={`pointer-events-auto w-16 h-16 bg-primary/90 text-primary-foreground rounded-full flex items-center justify-center backdrop-blur-sm transition-all ${
            playing ? "opacity-0 scale-90" : "opacity-100 scale-100 group-hover:bg-primary"
          }`}
        >
          <Play className="w-8 h-8 ml-1" />
        </button>
      </div>
      {loadingPreview && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm text-muted-foreground">
          {previewStatus}
        </div>
      )}
    </div>
  );
}
