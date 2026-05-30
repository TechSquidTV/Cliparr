import {
  getTimelineMaxScrollLeft,
  getTimelineZoomLevel,
  normalizeWheelDelta,
  TIMELINE_START_LEFT,
  TIMELINE_ZOOM_WHEEL_STEP,
  timelinePixelToTime,
  timelineTimeToPixel,
  type TimelineZoomLevel,
} from "@/components/editor/editorUtils";

interface ResolveTimelineZoomUpdateOptions {
  availableTimelineZoomLevels: readonly TimelineZoomLevel[];
  currentZoomIndex: number;
  fallbackTimelineScale: TimelineZoomLevel;
  zoomDelta: number;
  currentScrollLeft: number;
  duration: number;
  regionLeft: number;
  regionWidth: number;
  anchorClientX?: number;
  anchorTime?: number;
}

interface TimelineZoomUpdate {
  nextZoomIndex: number;
  nextScrollLeft: number;
}

interface ResolveTimelineScrollWheelUpdateOptions {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  containerWidth: number;
  containerHeight: number;
  currentScrollLeft: number;
  duration: number;
  timelineScale: TimelineZoomLevel;
}

interface AccumulateTimelineWheelZoomDeltaOptions {
  currentWheelDelta: number;
  deltaY: number;
  deltaMode: number;
  containerHeight: number;
}

export function resolveTimelineZoomUpdate({
  availableTimelineZoomLevels,
  currentZoomIndex,
  fallbackTimelineScale,
  zoomDelta,
  currentScrollLeft,
  duration,
  regionLeft,
  regionWidth,
  anchorClientX,
  anchorTime,
}: ResolveTimelineZoomUpdateOptions): TimelineZoomUpdate | null {
  if (availableTimelineZoomLevels.length < 2 || zoomDelta === 0) {
    return null;
  }

  const currentTimelineScale = getTimelineZoomLevel(
    availableTimelineZoomLevels,
    currentZoomIndex,
    fallbackTimelineScale,
  );
  const nextZoomIndex = Math.min(
    availableTimelineZoomLevels.length - 1,
    Math.max(0, currentZoomIndex + Math.sign(zoomDelta)),
  );
  if (nextZoomIndex === currentZoomIndex) {
    return null;
  }

  const nextTimelineScale = getTimelineZoomLevel(
    availableTimelineZoomLevels,
    nextZoomIndex,
    currentTimelineScale,
  );
  const pointerX =
    typeof anchorClientX === "number"
      ? Math.min(Math.max(anchorClientX - regionLeft, 0), regionWidth)
      : regionWidth / 2;
  const anchorPixel = Math.max(
    TIMELINE_START_LEFT,
    currentScrollLeft + pointerX,
  );
  const resolvedAnchorTime = Math.min(
    duration,
    Math.max(
      0,
      typeof anchorTime === "number"
        ? anchorTime
        : timelinePixelToTime(
            anchorPixel,
            currentTimelineScale.scale,
            currentTimelineScale.scaleWidth,
            TIMELINE_START_LEFT,
          ),
    ),
  );
  const nextAnchorPixel = timelineTimeToPixel(
    resolvedAnchorTime,
    nextTimelineScale.scale,
    nextTimelineScale.scaleWidth,
    TIMELINE_START_LEFT,
  );
  const nextMaxScrollLeft = getTimelineMaxScrollLeft(
    duration,
    nextTimelineScale.scale,
    nextTimelineScale.scaleWidth,
    regionWidth,
  );

  return {
    nextZoomIndex,
    nextScrollLeft: Math.min(
      nextMaxScrollLeft,
      Math.max(0, nextAnchorPixel - pointerX),
    ),
  };
}

export function resolveTimelineScrollWheelUpdate({
  deltaX,
  deltaY,
  deltaMode,
  containerWidth,
  containerHeight,
  currentScrollLeft,
  duration,
  timelineScale,
}: ResolveTimelineScrollWheelUpdateOptions) {
  const horizontalWheelDelta = normalizeWheelDelta(
    deltaX,
    deltaMode,
    containerWidth,
  );
  const verticalWheelDelta = normalizeWheelDelta(
    deltaY,
    deltaMode,
    containerHeight,
  );
  const nextScrollDelta = horizontalWheelDelta + verticalWheelDelta;
  const maxScrollLeft = getTimelineMaxScrollLeft(
    duration,
    timelineScale.scale,
    timelineScale.scaleWidth,
    containerWidth,
  );

  if (nextScrollDelta === 0 || maxScrollLeft <= 0) {
    return null;
  }

  return Math.min(
    maxScrollLeft,
    Math.max(0, currentScrollLeft + nextScrollDelta),
  );
}

export function accumulateTimelineWheelZoomDelta({
  currentWheelDelta,
  deltaY,
  deltaMode,
  containerHeight,
}: AccumulateTimelineWheelZoomDeltaOptions) {
  const normalizedDeltaY = normalizeWheelDelta(
    deltaY,
    deltaMode,
    containerHeight,
  );
  if (normalizedDeltaY === 0) {
    return { accumulatedWheelDelta: currentWheelDelta, zoomDelta: 0 };
  }

  let accumulatedWheelDelta = currentWheelDelta;
  if (
    accumulatedWheelDelta !== 0 &&
    Math.sign(accumulatedWheelDelta) !== Math.sign(normalizedDeltaY)
  ) {
    accumulatedWheelDelta = 0;
  }

  accumulatedWheelDelta += normalizedDeltaY;
  const accumulatedZoomDelta = Math.trunc(
    accumulatedWheelDelta / TIMELINE_ZOOM_WHEEL_STEP,
  );
  if (accumulatedZoomDelta === 0) {
    return { accumulatedWheelDelta, zoomDelta: 0 };
  }

  return {
    accumulatedWheelDelta: 0,
    zoomDelta: Math.sign(accumulatedZoomDelta),
  };
}
