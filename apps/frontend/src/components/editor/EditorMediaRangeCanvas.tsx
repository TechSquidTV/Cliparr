import {
  TimelineCanvasLayer,
  resolveTimelineRendererThemeFromElement,
  toSeconds,
  useTimelineTrack,
  type TimelineRendererTheme,
} from "@techsquidtv/canvas-timeline";
import { useCallback, useRef } from "react";
import { EDITOR_MEDIA_TRACK_ID } from "@/components/editor/editorTimelineEngine";

export const EDITOR_MEDIA_RANGE_INSET = 4;
export const EDITOR_MEDIA_RANGE_HANDLE_WIDTH = 12;

export function EditorMediaRangeCanvas() {
  const { rect, track } = useTimelineTrack(EDITOR_MEDIA_TRACK_ID);
  const themeReference = useRef<TimelineRendererTheme | null>(null);
  const connectCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    // Resolve the same CSS theme as CanvasRenderer once, outside the draw loop.
    themeReference.current = canvas
      ? resolveTimelineRendererThemeFromElement(canvas)
      : null;
  }, []);

  return (
    <TimelineCanvasLayer
      ref={connectCanvas}
      aria-hidden="true"
      draw={(context) => {
        const { ctx, state, width, height } = context;
        const theme = themeReference.current;
        if (!theme || !rect || !state.duration) {
          return;
        }

        const top = Math.max(theme.metrics.rulerHeight, rect.y);
        const bottom = Math.min(height, rect.y + rect.height);
        if (bottom <= top) {
          return;
        }

        // Replace only the source row's canvas painting. Its full-length clip
        // remains available to the media adapter, including outside the range.
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, top, width, bottom - top);
        ctx.clip();
        ctx.fillStyle = theme.colors.background;
        ctx.fillRect(0, top, width, bottom - top);
        ctx.fillStyle = theme.colors.track.divider;
        ctx.fillRect(0, rect.y + rect.height - 1, width, 1);

        const start = state.inPoint ? toSeconds(state.inPoint) : 0;
        const end = toSeconds(state.outPoint ?? state.duration);
        const x = start * state.zoomScale - state.scrollLeft;
        const selectionWidth = (end - start) * state.zoomScale;
        const y = rect.y + EDITOR_MEDIA_RANGE_INSET;
        const selectionHeight = rect.height - EDITOR_MEDIA_RANGE_INSET * 2;
        ctx.beginPath();
        ctx.roundRect(x, y, selectionWidth, selectionHeight, 4);
        ctx.fillStyle = theme.colors.clip.bgSelected;
        ctx.fill();
        ctx.strokeStyle = theme.colors.clip.borderSelected;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.clip();

        const handleWidth = Math.min(
          EDITOR_MEDIA_RANGE_HANDLE_WIDTH,
          selectionWidth / 4,
        );
        ctx.fillStyle = theme.colors.clip.borderSelected;
        ctx.globalAlpha = 0.25;
        ctx.fillRect(x, y, handleWidth, selectionHeight);
        ctx.fillRect(
          x + selectionWidth - handleWidth,
          y,
          handleWidth,
          selectionHeight,
        );
        ctx.globalAlpha = 1;
        for (const handleX of [
          x + handleWidth / 2,
          x + selectionWidth - handleWidth / 2,
        ]) {
          ctx.fillRect(handleX - 1, y + (selectionHeight - 14) / 2, 2, 14);
        }

        ctx.beginPath();
        ctx.rect(
          x + handleWidth,
          y,
          Math.max(0, selectionWidth - handleWidth * 2),
          selectionHeight,
        );
        ctx.clip();
        ctx.fillStyle = theme.colors.clip.text;
        ctx.font = theme.fonts.clip;
        ctx.textBaseline = "middle";
        ctx.fillText(
          track?.clips[0]?.label ?? "",
          Math.max(0, x) + 18,
          y + selectionHeight / 2,
        );
        ctx.restore();
      }}
    />
  );
}
