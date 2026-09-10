import { Play } from "lucide-react";
import { BarsLoader } from "@/components/ui/bars-loader";
import type { RefCallback } from "react";
import type { MediaDimensions } from "@/lib/editorMedia";
import type { ReactNode } from "react";

interface EditorPreviewProperties {
  canvasRef: RefCallback<HTMLCanvasElement>;
  videoDimensions?: MediaDimensions | null;
  playing: boolean;
  loadingPreview: boolean;
  loadingPreviewFrame: boolean;
  posterImageUrl?: string;
  posterViewTransitionName?: string;
  previewStatus: string;
  previewFrameStatus: string;
  togglePlay: () => void;
  overlay?: ReactNode;
}

export function EditorPreview({
  canvasRef,
  videoDimensions,
  playing,
  loadingPreview,
  loadingPreviewFrame,
  posterImageUrl,
  posterViewTransitionName,
  previewStatus,
  previewFrameStatus,
  togglePlay,
  overlay,
}: EditorPreviewProperties) {
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
      aria-busy={showLoadingOverlay}
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full object-contain"
        onClick={togglePlay}
      />
      {overlay}
      {posterImageUrl && (
        <img
          src={posterImageUrl}
          alt=""
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 h-full w-full scale-105 object-cover blur-sm transition-opacity duration-200 ease-out ${
            showLoadingOverlay ? "opacity-75" : "opacity-0"
          }`}
          decoding="async"
          style={
            posterViewTransitionName
              ? { viewTransitionName: posterViewTransitionName }
              : undefined
          }
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
        className={`pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-editor-preview-overlay-foreground transition-opacity duration-200 ease-out motion-reduce:transition-none ${
          showLoadingOverlay ? "opacity-100" : "opacity-0"
        } ${
          hasPosterImage
            ? "bg-editor-preview-overlay/70"
            : "bg-editor-preview-overlay"
        }`}
      >
        {showLoadingOverlay && <BarsLoader label={loadingStatus} showLabel />}
      </div>
    </div>
  );
}
