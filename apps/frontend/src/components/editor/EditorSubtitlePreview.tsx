import { useEffect, type RefObject } from "react";
import { getActiveSubtitleCues } from "@/lib/subtitles/getActiveSubtitleCue";
import { renderSubtitleCues } from "@/lib/subtitles/renderSubtitleCue";
import type { SubtitleCue, SubtitleStyleSettings } from "@/lib/subtitles/types";
import type { MediaDimensions } from "@/lib/editorMedia";

interface EditorSubtitlePreviewProperties {
  cues: readonly SubtitleCue[];
  currentTime: number;
  enabled: boolean;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
  style: SubtitleStyleSettings;
  videoCanvasRef: RefObject<HTMLCanvasElement | null>;
  videoDimensions?: MediaDimensions | null;
}

export function EditorSubtitlePreview({
  cues,
  currentTime,
  enabled,
  overlayCanvasRef,
  style,
  videoCanvasRef,
  videoDimensions,
}: EditorSubtitlePreviewProperties) {
  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;
    const videoCanvas = videoCanvasRef.current;
    if (!overlayCanvas || !videoCanvas) {
      return;
    }

    if (
      overlayCanvas.width !== videoCanvas.width ||
      overlayCanvas.height !== videoCanvas.height
    ) {
      overlayCanvas.width = videoCanvas.width;
      overlayCanvas.height = videoCanvas.height;
    }

    const context = overlayCanvas.getContext("2d");
    if (!context) {
      return;
    }
    context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
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
    cues,
    currentTime,
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
      className="pointer-events-none absolute inset-0 h-full w-full object-contain"
    />
  );
}
