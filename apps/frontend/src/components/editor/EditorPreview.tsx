import { Play } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type RefCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { BarsLoader } from "@/components/ui/bars-loader";
import type { MediaDimensions } from "#/components/editor/editorMedia";
import { resolveVideoCrop, type VideoCrop } from "#/lib/videoCrop";

interface EditorPreviewProperties {
  canvasRef: RefCallback<HTMLCanvasElement>;
  playing: boolean;
  loadingPreview: boolean;
  loadingPreviewFrame: boolean;
  posterImageUrl?: string;
  posterViewTransitionName?: string;
  togglePlay: () => void;
  overlay?: ReactNode;
  cropOverlay?: ReactNode;
  crop?: VideoCrop | null;
  cropEditing?: boolean;
  fitHeight?: boolean;
  videoDimensions?: MediaDimensions | null;
}

export function EditorPreview({
  canvasRef,
  playing,
  loadingPreview,
  loadingPreviewFrame,
  posterImageUrl,
  posterViewTransitionName,
  togglePlay,
  overlay,
  cropOverlay,
  crop,
  cropEditing = false,
  fitHeight = false,
  videoDimensions,
}: EditorPreviewProperties) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const region =
    !cropEditing && videoDimensions
      ? resolveVideoCrop(crop, videoDimensions)
      : null;
  const picture = region ?? videoDimensions;
  const padding = cropEditing ? 24 : 0;
  const scale = picture
    ? Math.min(
        Math.max(0, size.width - padding * 2) / picture.width,
        Math.max(0, size.height - padding * 2) / picture.height,
      )
    : 0;
  const viewport: CSSProperties =
    picture && scale > 0
      ? {
          position: "absolute",
          width: picture.width * scale,
          height: picture.height * scale,
          left: (size.width - picture.width * scale) / 2,
          top: (size.height - picture.height * scale) / 2,
          overflow: cropEditing ? "visible" : "hidden",
        }
      : { position: "absolute", inset: 0 };
  const videoStyle: CSSProperties | undefined =
    region && videoDimensions
      ? {
          position: "absolute",
          width: videoDimensions.width * scale,
          height: videoDimensions.height * scale,
          left: -region.left * scale,
          top: -region.top * scale,
        }
      : undefined;
  const showLoadingOverlay = loadingPreview || loadingPreviewFrame;
  const hasPosterImage = Boolean(posterImageUrl);
  const loadingStatus = loadingPreviewFrame
    ? "Loading preview frame…"
    : "Loading video…";

  return (
    <div
      ref={container}
      className="group relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-editor-monitor"
      style={
        fitHeight
          ? {
              height:
                picture && size.width > 0
                  ? (Math.max(0, size.width - padding * 2) / picture.width) *
                      picture.height +
                    padding * 2
                  : "var(--spacing-editor-crop-preview-max)",
              maxHeight: "var(--spacing-editor-crop-preview-max)",
            }
          : undefined
      }
      aria-busy={showLoadingOverlay}
    >
      <div style={viewport} data-editor-picture>
        <canvas
          ref={canvasRef}
          className="block h-full w-full object-contain"
          style={videoStyle}
          onClick={cropEditing ? undefined : togglePlay}
        />
        {overlay}
        {cropOverlay}
      </div>
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
      {!showLoadingOverlay && !cropEditing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              togglePlay();
            }}
            aria-label={playing ? "Pause playback" : "Play playback"}
            className={`editor-control-focus pointer-events-auto flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] border border-editor-border bg-editor-panel/92 text-foreground transition-all ${
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
