import { LoaderCircle, Play } from "lucide-react";
import type { RefObject } from "react";

interface EditorPreviewProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  videoDimensions?: {
    width: number;
    height: number;
  } | null;
  playing: boolean;
  loadingPreview: boolean;
  loadingPreviewFrame: boolean;
  previewStatus: string;
  previewFrameStatus: string;
  togglePlay: () => void;
}

export function EditorPreview({
  canvasRef,
  videoDimensions,
  playing,
  loadingPreview,
  loadingPreviewFrame,
  previewStatus,
  previewFrameStatus,
  togglePlay,
}: EditorPreviewProps) {
  const aspectRatio = videoDimensions && videoDimensions.width > 0 && videoDimensions.height > 0
    ? `${videoDimensions.width} / ${videoDimensions.height}`
    : undefined;
  const showLoadingOverlay = loadingPreview || loadingPreviewFrame;
  const loadingStatus = loadingPreviewFrame ? previewFrameStatus : previewStatus;

  return (
    <div
      className="group relative aspect-video h-full max-h-full w-auto max-w-full overflow-hidden bg-[var(--editor-preview-stage)]"
      style={aspectRatio ? { aspectRatio } : undefined}
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full object-contain"
        onClick={togglePlay}
      />
      {!showLoadingOverlay && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              togglePlay();
            }}
            aria-label={playing ? "Pause playback" : "Play playback"}
            className={`pointer-events-auto flex h-11 w-11 items-center justify-center border border-[var(--editor-preview-overlay-border)] bg-card/92 text-foreground transition-all ${
              playing ? "scale-95 opacity-0" : "scale-100 opacity-100 group-hover:bg-card"
            }`}
          >
            <Play className="ml-0.5 h-5 w-5" />
          </button>
        </div>
      )}
      {showLoadingOverlay && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-[var(--editor-preview-overlay)] text-sm text-[var(--editor-preview-overlay-foreground)]">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          <span>{loadingStatus}</span>
        </div>
      )}
    </div>
  );
}
