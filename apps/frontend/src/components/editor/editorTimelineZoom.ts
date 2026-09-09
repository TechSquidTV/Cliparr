import {
  toSeconds,
  type TimelineEngine,
  type RangeScrollbarHandleSide,
  type RangeScrollbarValue,
} from "@techsquidtv/canvas-timeline";

export const EDITOR_MAX_ZOOM_SCALE = 1000;
const ZOOM_DOUBLING_DISTANCE_PIXELS = 120;

export function viewportScrollbarGeometry({
  start,
  span,
  duration,
  minSpan,
  viewportWidth,
}: {
  start: number;
  span: number;
  duration: number;
  minSpan: number;
  viewportWidth: number;
}) {
  // Logarithmic sizing keeps fine zoom levels visibly distinct without a
  // fixed-width plateau. Position still covers the entire scrollable media.
  const minimumWidth = Math.min(1, 56 / Math.max(56, viewportWidth));
  const zoomFraction =
    duration > minSpan
      ? Math.log(Math.max(minSpan, span) / minSpan) /
        Math.log(duration / minSpan)
      : 1;
  const width =
    minimumWidth + (1 - minimumWidth) * Math.min(1, Math.max(0, zoomFraction));
  const scrollableDuration = Math.max(0, duration - span);
  const scrollableFraction = 1 - width;
  const position =
    scrollableDuration > 0
      ? Math.min(1, Math.max(0, start / scrollableDuration))
      : 0;
  return {
    value: {
      start: position * scrollableFraction,
      end: position * scrollableFraction + width,
    },
    scrollableDuration,
    scrollableFraction,
  };
}

export function zoomEditorTimeline(
  engine: TimelineEngine,
  scale: number,
  anchorPixel?: number,
) {
  const state = engine.getState();
  const width = state.viewportWidth ?? 0;
  if (width <= 0) {
    return;
  }
  const playheadX = engine.timeToPixel(state.playheadTime);
  const anchorX = Math.min(
    width,
    Math.max(
      0,
      anchorPixel ??
        (playheadX >= 0 && playheadX <= width ? playheadX : width / 2),
    ),
  );
  const anchorTime = engine.pixelToTime(anchorX);
  engine.setZoomScale(scale);
  engine.setScrollLeft(
    Math.max(0, toSeconds(anchorTime) * engine.zoomScale - anchorX),
  );
  engine.settle();
}

// Pointer travel changes the visible span proportionally, so subtitle-scale
// adjustments have the same precision for a short clip and a feature film.
export function viewportRangeAfterZoomDrag({
  range,
  side,
  deltaPixels,
  minSpan,
  duration,
}: {
  range: RangeScrollbarValue;
  side: RangeScrollbarHandleSide;
  deltaPixels: number;
  minSpan: number;
  duration: number;
}): RangeScrollbarValue {
  const direction = side === "start" ? -1 : 1;
  const scale =
    2 ** ((direction * deltaPixels) / ZOOM_DOUBLING_DISTANCE_PIXELS);
  const span = Math.min(
    duration,
    Math.max(minSpan, (range.end - range.start) * scale),
  );
  const anchoredStart = side === "start" ? range.end - span : range.start;
  const start = Math.min(Math.max(0, anchoredStart), duration - span);
  return { start, end: start + span };
}
