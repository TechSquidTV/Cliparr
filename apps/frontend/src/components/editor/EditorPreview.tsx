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
  posterImageUrl?: string;
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
  posterImageUrl,
  previewStatus,
  previewFrameStatus,
  togglePlay,
}: EditorPreviewProps) {
  const aspectRatio =
    videoDimensions && videoDimensions.width > 0 && videoDimensions.height > 0
      ? `${videoDimensions.width} / ${videoDimensions.height}`
      : undefined;
  const showLoadingOverlay = loadingPreview || loadingPreviewFrame;
  const hasPosterImage = Boolean(posterImageUrl);
  const loadingStatus = loadingPreviewFrame
    ? previewFrameStatus
    : previewStatus;

  return (
    <div
      className="group relative aspect-video h-full max-h-full w-auto max-w-full overflow-hidden bg-editor-monitor"
      style={aspectRatio ? { aspectRatio } : undefined}
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full object-contain"
        onClick={togglePlay}
      />
      {posterImageUrl && (
        <img
          src={posterImageUrl}
          alt=""
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 h-full w-full scale-105 object-cover blur-sm transition-opacity duration-200 ease-out ${
            showLoadingOverlay ? "opacity-75" : "opacity-0"
          }`}
        />
      )}
      {!showLoadingOverlay && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              togglePlay();
            }}
            aria-label={playing ? "Pause playback" : "Play playback"}
            className={`pointer-events-auto flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] border border-editor-border bg-editor-panel/92 text-foreground transition-all focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none ${
              playing
                ? "scale-95 opacity-0"
                : "scale-100 opacity-100 group-hover:bg-editor-panel-raised"
            }`}
          >
            <Play className="ml-0.5 h-5 w-5" />
          </button>
        </div>
      )}
      <div
        aria-hidden={!showLoadingOverlay}
        className={`pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-editor-preview-overlay-foreground transition-opacity duration-200 ease-out ${
          showLoadingOverlay ? "opacity-100" : "opacity-0"
        } ${
          hasPosterImage
            ? "bg-editor-preview-overlay/70"
            : "bg-editor-preview-overlay"
        }`}
      >
        <LoaderCircle className="h-4 w-4 animate-spin" />
        <span>{loadingStatus}</span>
      </div>
    </div>
  );
}
