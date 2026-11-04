import { type RefObject, useEffect } from "react";

import type { MediaDimensions } from "@/components/editor/editorMedia";
import { getActiveSubtitleCues } from "@/lib/subtitles/getActiveSubtitleCue";
import { renderSubtitleCues } from "@/lib/subtitles/renderSubtitleCue";
import type { SubtitleCue, SubtitleStyleSettings } from "@/lib/subtitles/types";
import { resolveVideoCrop, type VideoCrop } from "#/lib/videoCrop";

interface EditorSubtitlePreviewProperties {
  cues: readonly SubtitleCue[];
  currentTime: number;
  frameReady: boolean;
  enabled: boolean;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
  style: SubtitleStyleSettings;
  videoCanvasRef: RefObject<HTMLCanvasElement | null>;
  videoDimensions?: MediaDimensions | null;
  crop?: VideoCrop | null;
  cropEditing?: boolean;
}

export function EditorSubtitlePreview({
  cues,
  currentTime,
  frameReady,
  enabled,
  overlayCanvasRef,
  style,
  videoCanvasRef,
  videoDimensions,
  crop,
  cropEditing = false,
}: EditorSubtitlePreviewProperties) {
  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;
    const videoCanvas = videoCanvasRef.current;
    if (!overlayCanvas || !videoCanvas) {
      return;
    }

    const context = overlayCanvas.getContext("2d");
    if (!context) {
      return;
    }
    context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Metadata may arrive before frame zero. Its timestamp can equal the
    // paused playhead, so frame readiness must independently trigger rendering.
    if (!frameReady) {
      return;
    }

    let region: ReturnType<typeof resolveVideoCrop>;
    try {
      region = resolveVideoCrop(crop, videoCanvas);
    } catch {
      return;
    }
    const width = region?.width ?? videoCanvas.width;
    const height = region?.height ?? videoCanvas.height;
    if (overlayCanvas.width !== width || overlayCanvas.height !== height) {
      overlayCanvas.width = width;
      overlayCanvas.height = height;
    }

    if (!enabled || overlayCanvas.width <= 0 || overlayCanvas.height <= 0) {
      return;
    }

    renderSubtitleCues(
      context,
      getActiveSubtitleCues(cues, currentTime),
      style,
      overlayCanvas.width,
      overlayCanvas.height,
    );
  }, [
    crop,
    cues,
    currentTime,
    frameReady,
    enabled,
    overlayCanvasRef,
    style,
    videoCanvasRef,
    videoDimensions,
  ]);

  return (
    <canvas
      ref={overlayCanvasRef}
      aria-hidden="true"
      style={
        cropEditing && crop
          ? {
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              width: `${crop.width * 100}%`,
              height: `${crop.height * 100}%`,
            }
          : undefined
      }
      className="pointer-events-none absolute inset-0 h-full w-full object-contain"
    />
  );
}
