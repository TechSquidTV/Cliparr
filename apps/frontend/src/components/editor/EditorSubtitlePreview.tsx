import { type RefObject, useEffect, useMemo, useRef } from "react";

import { createSubtitleCueReader } from "@/lib/subtitles/getActiveSubtitleCue";
import { renderSubtitleCues } from "@/lib/subtitles/renderSubtitleCue";
import type { SubtitleCue, SubtitleStyleSettings } from "@/lib/subtitles/types";
import type { PixelDimensions } from "#/lib/mediaDimensions";
import { resolveVideoCrop, type VideoCrop } from "#/lib/videoCrop";

interface EditorSubtitlePreviewProperties {
  cues: readonly SubtitleCue[];
  currentTime: number;
  frameReady: boolean;
  enabled: boolean;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
  style: SubtitleStyleSettings;
  videoCanvasRef: RefObject<HTMLCanvasElement | null>;
  videoDimensions?: PixelDimensions | null;
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
  const readCues = useMemo(() => createSubtitleCueReader(cues), [cues]);
  const painted = useRef<{
    cues: readonly SubtitleCue[];
    style: SubtitleStyleSettings;
    crop: VideoCrop | null | undefined;
  } | null>(null);
  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    const video = videoCanvasRef.current;
    if (!overlay) {
      return;
    }

    const active =
      enabled && frameReady && video ? readCues(currentTime) : null;
    let width = 0;
    let height = 0;
    if (active?.length && video) {
      try {
        const region = resolveVideoCrop(crop, video);
        width = region?.width ?? video.width;
        height = region?.height ?? video.height;
      } catch {
        // An incompatible crop has no preview until the source or crop changes.
      }
    }
    if (!active?.length || !width || !height) {
      if (!enabled && overlay.width > 0) {
        overlay.width = 0;
        overlay.height = 0;
      } else if (painted.current) {
        overlay
          .getContext("2d")
          ?.clearRect(0, 0, overlay.width, overlay.height);
      }
      painted.current = null;
      return;
    }
    const previous = painted.current;
    if (overlay.width !== width || overlay.height !== height) {
      overlay.width = width;
      overlay.height = height;
    } else if (
      previous?.cues === active &&
      previous.style === style &&
      previous.crop === crop
    ) {
      return;
    }
    const context = overlay.getContext("2d");
    if (context) {
      context.clearRect(0, 0, width, height);
      renderSubtitleCues(context, active, style, width, height);
      painted.current = { cues: active, style, crop };
    }
  }, [
    crop,
    readCues,
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
      width={0}
      height={0}
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
