import { useCallback, useEffect, useMemo, useRef, useState, startTransition, type WheelEvent as ReactWheelEvent } from "react";
import type { TimelineState } from "@xzdarcy/react-timeline-editor";
import { 
  getTimelineZoomLevels, 
  getClosestTimelineZoomIndex, 
  timelineScaleForDuration, 
  getTimelineZoomLevel, 
  roundTimelineTime, 
  MIN_CLIP_SECONDS, 
  TIMELINE_START_LEFT, 
  normalizeWheelDelta, 
  getTimelineMaxScrollLeft, 
  TIMELINE_ZOOM_WHEEL_STEP, 
  timelinePixelToTime, 
  timelineTimeToPixel,
  type ClipTimelineData,
  type ClipTimelineEffects
} from "./EditorUtils";

interface UseEditorTimelineProps {
  duration: number;
  startTime: number;
  endTime: number;
  currentTime: number;
  sessionId: string;
  updateClipRange: (start: number, end: number) => void;
}

export function useEditorTimeline({
  duration,
  startTime,
  endTime,
  currentTime,
  sessionId,
  updateClipRange,
}: UseEditorTimelineProps) {
  const timelineRef = useRef<TimelineState>(null);
  const timelineWheelRegionRef = useRef<HTMLDivElement>(null);
  
  const timelineScrollLeftRef = useRef(0);
  const pendingTimelineScrollLeftRef = useRef<number | null>(null);
  const timelineWheelDeltaRef = useRef(0);

  const hasDuration = duration > 0;
  
  const timelineEffects = useMemo<ClipTimelineEffects>(() => ({
    source: { id: "source", name: "Full video" },
    clip: { id: "clip", name: "Clip" },
  }), []);

  const defaultTimelineScale = useMemo(() => timelineScaleForDuration(duration), [duration]);
  const availableTimelineZoomLevels = useMemo(() => getTimelineZoomLevels(duration), [duration]);
  const defaultTimelineZoomIndex = useMemo(
    () => getClosestTimelineZoomIndex(availableTimelineZoomLevels, defaultTimelineScale),
    [availableTimelineZoomLevels, defaultTimelineScale],
  );

  const [timelineZoomIndex, setTimelineZoomIndex] = useState(defaultTimelineZoomIndex);
  const timelineZoomIndexRef = useRef(timelineZoomIndex);

  const activeTimelineScale = getTimelineZoomLevel(
    availableTimelineZoomLevels,
    timelineZoomIndex,
    getTimelineZoomLevel(availableTimelineZoomLevels, defaultTimelineZoomIndex, defaultTimelineScale),
  );

  const timelineScaleCount = useMemo(
    () => Math.max(1, Math.ceil(Math.max(duration, MIN_CLIP_SECONDS) / activeTimelineScale.scale)),
    [duration, activeTimelineScale.scale],
  );

  const timelineData = useMemo<ClipTimelineData>(() => {
    const clipLength = hasDuration ? Math.min(MIN_CLIP_SECONDS, duration) : MIN_CLIP_SECONDS;
    const safeDuration = hasDuration ? roundTimelineTime(duration) : MIN_CLIP_SECONDS;
    const safeStart = hasDuration
      ? roundTimelineTime(Math.min(Math.max(startTime, 0), Math.max(duration - clipLength, 0)))
      : 0;
    const safeEnd = hasDuration
      ? roundTimelineTime(Math.min(Math.max(endTime, safeStart + clipLength), duration))
      : MIN_CLIP_SECONDS;

    return [
      {
        id: "source-media",
        rowHeight: 32,
        actions: [
          {
            id: "full-video",
            start: 0,
            end: safeDuration,
            effectId: "source",
            flexible: false,
            movable: false,
            minStart: 0,
            maxEnd: safeDuration,
          },
        ],
      },
      {
        id: "clip-range",
        rowHeight: 44,
        selected: true,
        actions: [
          {
            id: "selected-clip",
            start: safeStart,
            end: safeEnd,
            effectId: "clip",
            selected: true,
            flexible: hasDuration,
            movable: hasDuration,
            minStart: 0,
            maxEnd: Math.max(duration, safeEnd),
          },
        ],
      },
    ];
  }, [duration, endTime, hasDuration, startTime]);

  useEffect(() => {
    timelineZoomIndexRef.current = timelineZoomIndex;
  }, [timelineZoomIndex]);

  useEffect(() => {
    setTimelineZoomIndex(defaultTimelineZoomIndex);
    timelineZoomIndexRef.current = defaultTimelineZoomIndex;
    timelineScrollLeftRef.current = 0;
    timelineWheelDeltaRef.current = 0;
    timelineRef.current?.setScrollLeft(0);
    pendingTimelineScrollLeftRef.current = 0;
  }, [defaultTimelineZoomIndex, sessionId]);

  useEffect(() => {
    const pendingScrollLeft = pendingTimelineScrollLeftRef.current;
    if (pendingScrollLeft === null) return;

    timelineRef.current?.setScrollLeft(pendingScrollLeft);
    timelineScrollLeftRef.current = pendingScrollLeft;
    pendingTimelineScrollLeftRef.current = null;
  }, [activeTimelineScale.scale, activeTimelineScale.scaleWidth]);

  useEffect(() => {
    if (!timelineRef.current || !hasDuration) return;
    timelineRef.current.setTime(currentTime);
  }, [currentTime, hasDuration]);

  const handleTimelineScroll = useCallback(({ scrollLeft }: { scrollLeft: number }) => {
    timelineScrollLeftRef.current = scrollLeft;
  }, []);

  const handleTimelineWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!hasDuration) return;

    const timelineWheelRegion = timelineWheelRegionRef.current;
    if (!timelineWheelRegion) return;

    const containerHeight = timelineWheelRegion.clientHeight || 1;
    const containerWidth = timelineWheelRegion.clientWidth || 1;

    if (!event.metaKey && !event.ctrlKey) {
      timelineWheelDeltaRef.current = 0;
      const horizontalWheelDelta = normalizeWheelDelta(event.deltaX, event.deltaMode, containerWidth);
      const verticalWheelDelta = normalizeWheelDelta(event.deltaY, event.deltaMode, containerHeight);
      const nextScrollDelta = horizontalWheelDelta + verticalWheelDelta;
      const maxScrollLeft = getTimelineMaxScrollLeft(
        duration,
        activeTimelineScale.scale,
        activeTimelineScale.scaleWidth,
        containerWidth,
      );
      if (nextScrollDelta === 0 || maxScrollLeft <= 0) return;

      event.preventDefault();
      event.stopPropagation();

      const nextScrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, timelineScrollLeftRef.current + nextScrollDelta),
      );
      timelineRef.current?.setScrollLeft(nextScrollLeft);
      timelineScrollLeftRef.current = nextScrollLeft;
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const normalizedDeltaY = normalizeWheelDelta(event.deltaY, event.deltaMode, containerHeight);
    if (normalizedDeltaY === 0 || availableTimelineZoomLevels.length < 2) return;

    if (
      timelineWheelDeltaRef.current !== 0 &&
      Math.sign(timelineWheelDeltaRef.current) !== Math.sign(normalizedDeltaY)
    ) {
      timelineWheelDeltaRef.current = 0;
    }

    timelineWheelDeltaRef.current += normalizedDeltaY;
    const zoomDelta = Math.trunc(timelineWheelDeltaRef.current / TIMELINE_ZOOM_WHEEL_STEP);
    if (zoomDelta === 0) return;

    const currentZoomIndex = timelineZoomIndexRef.current;
    const currentTimelineScale = getTimelineZoomLevel(
      availableTimelineZoomLevels,
      currentZoomIndex,
      activeTimelineScale,
    );
    const currentScrollLeft = pendingTimelineScrollLeftRef.current ?? timelineScrollLeftRef.current;
    timelineWheelDeltaRef.current -= zoomDelta * TIMELINE_ZOOM_WHEEL_STEP;
    const nextZoomIndex = Math.min(
      availableTimelineZoomLevels.length - 1,
      Math.max(0, currentZoomIndex + zoomDelta),
    );
    if (nextZoomIndex === currentZoomIndex) {
      timelineWheelDeltaRef.current = 0;
      return;
    }

    const nextTimelineScale = getTimelineZoomLevel(
      availableTimelineZoomLevels,
      nextZoomIndex,
      currentTimelineScale,
    );
    const regionRect = timelineWheelRegion.getBoundingClientRect();
    const pointerX = Math.min(Math.max(event.clientX - regionRect.left, 0), regionRect.width);
    const anchorPixel = Math.max(TIMELINE_START_LEFT, currentScrollLeft + pointerX);
    const anchorTime = Math.min(
      duration,
      Math.max(
        0,
        timelinePixelToTime(
          anchorPixel,
          currentTimelineScale.scale,
          currentTimelineScale.scaleWidth,
          TIMELINE_START_LEFT,
        ),
      ),
    );
    const nextAnchorPixel = timelineTimeToPixel(
      anchorTime,
      nextTimelineScale.scale,
      nextTimelineScale.scaleWidth,
      TIMELINE_START_LEFT,
    );
    const nextMaxScrollLeft = getTimelineMaxScrollLeft(
      duration,
      nextTimelineScale.scale,
      nextTimelineScale.scaleWidth,
      regionRect.width,
    );
    const nextScrollLeft = Math.min(nextMaxScrollLeft, Math.max(0, nextAnchorPixel - pointerX));
    pendingTimelineScrollLeftRef.current = nextScrollLeft;
    timelineScrollLeftRef.current = nextScrollLeft;
    timelineZoomIndexRef.current = nextZoomIndex;

    startTransition(() => {
      setTimelineZoomIndex(nextZoomIndex);
    });
  }, [hasDuration, duration, activeTimelineScale, availableTimelineZoomLevels]);

  const handleTimelineChange = useCallback((nextData: ClipTimelineData) => {
    const nextAction = nextData
      .flatMap((row) => row.actions)
      .find((action) => action.id === "selected-clip");
    if (!nextAction) return false;

    updateClipRange(nextAction.start, nextAction.end);
  }, [updateClipRange]);

  return {
    timelineRef,
    timelineWheelRegionRef,
    timelineData,
    timelineEffects,
    activeTimelineScale,
    timelineScaleCount,
    handleTimelineScroll,
    handleTimelineWheel,
    handleTimelineChange,
    hasDuration,
  };
}
