import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import type { TimelineState } from "@xzdarcy/react-timeline-editor";
import { 
  getTimelineZoomLevels, 
  getClosestTimelineZoomIndex, 
  getFocusedTimelineZoomIndex,
  getTimelineMaxScrollLeft,
  timelineScaleForDuration, 
  getTimelineZoomLevel, 
  roundTimelineTime, 
  MIN_CLIP_SECONDS, 
  TIMELINE_START_LEFT,
  timelineTimeToPixel,
  type ClipTimelineData,
  type ClipTimelineEffects
} from "./EditorUtils";
import {
  accumulateTimelineWheelZoomDelta,
  resolveTimelineScrollWheelUpdate,
  resolveTimelineZoomUpdate,
} from "./timelineZoom";

interface UseEditorTimelineProps {
  duration: number;
  startTime: number;
  endTime: number;
  currentTime: number;
  sessionId: string;
  updateClipRange: (start: number, end: number) => void;
  onClipRangeCommit?: (start: number, end: number) => void;
}

interface TimelineZoomAnchorOptions {
  anchorClientX?: number;
  anchorTime?: number;
}

function getTimelineRangeScrollLeft({
  start,
  end,
  duration,
  timelineScale,
  viewportWidth,
}: {
  start: number;
  end: number;
  duration: number;
  timelineScale: { scale: number; scaleWidth: number };
  viewportWidth: number;
}) {
  const safeStart = Math.min(Math.max(start, 0), duration);
  const safeEnd = Math.min(Math.max(end, safeStart), duration);
  const startPixel = timelineTimeToPixel(
    safeStart,
    timelineScale.scale,
    timelineScale.scaleWidth,
    TIMELINE_START_LEFT,
  );
  const endPixel = timelineTimeToPixel(
    safeEnd,
    timelineScale.scale,
    timelineScale.scaleWidth,
    TIMELINE_START_LEFT,
  );
  const selectionWidth = Math.max(0, endPixel - startPixel);
  const viewportGutter = Math.min(
    Math.max(TIMELINE_START_LEFT, viewportWidth * 0.18),
    viewportWidth * 0.35,
  );
  const desiredScrollLeft = selectionWidth >= viewportWidth - viewportGutter
    ? startPixel - viewportGutter
    : startPixel - ((viewportWidth - selectionWidth) / 2);
  const maxScrollLeft = getTimelineMaxScrollLeft(
    duration,
    timelineScale.scale,
    timelineScale.scaleWidth,
    viewportWidth,
  );

  return Math.min(maxScrollLeft, Math.max(0, desiredScrollLeft));
}

export function useEditorTimeline({
  duration,
  startTime,
  endTime,
  currentTime,
  sessionId,
  updateClipRange,
  onClipRangeCommit,
}: UseEditorTimelineProps) {
  const timelineRef = useRef<TimelineState>(null);
  const timelineWheelRegionRef = useRef<HTMLDivElement>(null);
  
  const timelineScrollLeftRef = useRef(0);
  const pendingTimelineScrollLeftRef = useRef<number | null>(null);
  const timelineWheelDeltaRef = useRef(0);
  const hasUserAdjustedTimelineZoomRef = useRef(false);
  const hasPositionedTimelineViewRef = useRef(false);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);

  const hasDuration = duration > 0;
  
  const timelineEffects = useMemo<ClipTimelineEffects>(() => ({
    source: { id: "source", name: "Source" },
    clip: { id: "clip", name: "Clip" },
  }), []);

  const defaultTimelineScale = useMemo(() => timelineScaleForDuration(duration), [duration]);
  const availableTimelineZoomLevels = useMemo(() => getTimelineZoomLevels(duration), [duration]);
  const defaultTimelineZoomIndex = useMemo(
    () => getClosestTimelineZoomIndex(availableTimelineZoomLevels, defaultTimelineScale),
    [availableTimelineZoomLevels, defaultTimelineScale],
  );
  const focusedTimelineZoomIndex = useMemo(() => {
    if (timelineViewportWidth <= 0) {
      return defaultTimelineZoomIndex;
    }

    return getFocusedTimelineZoomIndex(
      availableTimelineZoomLevels,
      Math.max(endTime - startTime, MIN_CLIP_SECONDS),
      timelineViewportWidth,
    );
  }, [
    availableTimelineZoomLevels,
    defaultTimelineZoomIndex,
    endTime,
    startTime,
    timelineViewportWidth,
  ]);

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
    const timelineWheelRegion = timelineWheelRegionRef.current;
    if (!timelineWheelRegion) return;

    const updateViewportWidth = () => {
      setTimelineViewportWidth(timelineWheelRegion.clientWidth || 0);
    };

    updateViewportWidth();

    const resizeObserver = new ResizeObserver(() => {
      updateViewportWidth();
    });

    resizeObserver.observe(timelineWheelRegion);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    setTimelineZoomIndex(defaultTimelineZoomIndex);
    timelineZoomIndexRef.current = defaultTimelineZoomIndex;
    timelineScrollLeftRef.current = 0;
    timelineWheelDeltaRef.current = 0;
    hasUserAdjustedTimelineZoomRef.current = false;
    hasPositionedTimelineViewRef.current = false;
    timelineRef.current?.setScrollLeft(0);
    pendingTimelineScrollLeftRef.current = 0;
    setTimelineScrollLeft(0);
  }, [defaultTimelineZoomIndex, sessionId]);

  useEffect(() => {
    if (
      !hasDuration
      || timelineViewportWidth <= 0
      || hasUserAdjustedTimelineZoomRef.current
      || hasPositionedTimelineViewRef.current
    ) {
      return;
    }

    const focusedTimelineScale = getTimelineZoomLevel(
      availableTimelineZoomLevels,
      focusedTimelineZoomIndex,
      getTimelineZoomLevel(availableTimelineZoomLevels, defaultTimelineZoomIndex, defaultTimelineScale),
    );
    const nextScrollLeft = getTimelineRangeScrollLeft({
      start: startTime,
      end: endTime,
      duration,
      timelineScale: focusedTimelineScale,
      viewportWidth: timelineViewportWidth,
    });

    setTimelineZoomIndex(focusedTimelineZoomIndex);
    timelineZoomIndexRef.current = focusedTimelineZoomIndex;
    timelineScrollLeftRef.current = nextScrollLeft;
    timelineWheelDeltaRef.current = 0;
    hasPositionedTimelineViewRef.current = true;
    timelineRef.current?.setScrollLeft(nextScrollLeft);
    pendingTimelineScrollLeftRef.current = nextScrollLeft;
    setTimelineScrollLeft(nextScrollLeft);
  }, [
    availableTimelineZoomLevels,
    defaultTimelineScale,
    defaultTimelineZoomIndex,
    duration,
    endTime,
    focusedTimelineZoomIndex,
    hasDuration,
    startTime,
    timelineViewportWidth,
  ]);

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
    setTimelineScrollLeft(scrollLeft);
  }, []);

  const getTimelineZoomAnchorTime = useCallback(() => {
    if (currentTime >= startTime && currentTime <= endTime) {
      return currentTime;
    }

    return startTime + ((endTime - startTime) / 2);
  }, [currentTime, endTime, startTime]);

  const updateTimelineZoom = useCallback((zoomDelta: number, anchorOptions: TimelineZoomAnchorOptions = {}) => {
    if (!hasDuration || availableTimelineZoomLevels.length < 2 || zoomDelta === 0) {
      return;
    }

    const timelineWheelRegion = timelineWheelRegionRef.current;
    if (!timelineWheelRegion) return;

    const currentZoomIndex = timelineZoomIndexRef.current;
    const currentScrollLeft = pendingTimelineScrollLeftRef.current ?? timelineScrollLeftRef.current;
    const regionRect = timelineWheelRegion.getBoundingClientRect();
    const zoomUpdate = resolveTimelineZoomUpdate({
      availableTimelineZoomLevels,
      currentZoomIndex,
      fallbackTimelineScale: activeTimelineScale,
      zoomDelta,
      currentScrollLeft,
      duration,
      regionLeft: regionRect.left,
      regionWidth: regionRect.width,
      anchorClientX: anchorOptions.anchorClientX,
      anchorTime: anchorOptions.anchorTime,
    });
    if (!zoomUpdate) {
      timelineWheelDeltaRef.current = 0;
      return;
    }

    const { nextZoomIndex, nextScrollLeft } = zoomUpdate;
    pendingTimelineScrollLeftRef.current = nextScrollLeft;
    timelineScrollLeftRef.current = nextScrollLeft;
    setTimelineScrollLeft(nextScrollLeft);
    timelineZoomIndexRef.current = nextZoomIndex;
    hasUserAdjustedTimelineZoomRef.current = true;

    startTransition(() => {
      setTimelineZoomIndex(nextZoomIndex);
    });
  }, [activeTimelineScale, availableTimelineZoomLevels, duration, hasDuration]);

  const handleTimelineZoomIn = useCallback(() => {
    updateTimelineZoom(-1, { anchorTime: getTimelineZoomAnchorTime() });
  }, [getTimelineZoomAnchorTime, updateTimelineZoom]);

  const handleTimelineZoomOut = useCallback(() => {
    updateTimelineZoom(1, { anchorTime: getTimelineZoomAnchorTime() });
  }, [getTimelineZoomAnchorTime, updateTimelineZoom]);

  const handleTimelineWheel = useCallback((event: WheelEvent) => {
    if (!hasDuration) return;

    const timelineWheelRegion = timelineWheelRegionRef.current;
    if (!timelineWheelRegion) return;

    const containerHeight = timelineWheelRegion.clientHeight || 1;
    const containerWidth = timelineWheelRegion.clientWidth || 1;

    if (!event.metaKey && !event.ctrlKey) {
      timelineWheelDeltaRef.current = 0;
      const nextScrollLeft = resolveTimelineScrollWheelUpdate({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        containerWidth,
        containerHeight,
        currentScrollLeft: timelineScrollLeftRef.current,
        duration,
        timelineScale: activeTimelineScale,
      });
      if (nextScrollLeft === null) return;

      event.preventDefault();
      event.stopPropagation();

      timelineRef.current?.setScrollLeft(nextScrollLeft);
      timelineScrollLeftRef.current = nextScrollLeft;
      setTimelineScrollLeft(nextScrollLeft);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (availableTimelineZoomLevels.length < 2) return;

    const { accumulatedWheelDelta, zoomDelta } = accumulateTimelineWheelZoomDelta({
      currentWheelDelta: timelineWheelDeltaRef.current,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      containerHeight,
    });
    timelineWheelDeltaRef.current = accumulatedWheelDelta;
    if (zoomDelta === 0) return;
    updateTimelineZoom(zoomDelta, { anchorClientX: event.clientX });
  }, [hasDuration, duration, activeTimelineScale, availableTimelineZoomLevels, updateTimelineZoom]);

  useEffect(() => {
    const timelineWheelRegion = timelineWheelRegionRef.current;
    if (!timelineWheelRegion) return;

    timelineWheelRegion.addEventListener("wheel", handleTimelineWheel, { passive: false });

    return () => {
      timelineWheelRegion.removeEventListener("wheel", handleTimelineWheel);
    };
  }, [handleTimelineWheel]);

  const handleTimelineChange = useCallback((nextData: ClipTimelineData) => {
    const nextAction = nextData
      .flatMap((row) => row.actions)
      .find((action) => action.id === "selected-clip");
    if (!nextAction) return false;

    updateClipRange(nextAction.start, nextAction.end);
  }, [updateClipRange]);

  const commitClipRange = useCallback((start: number, end: number) => {
    onClipRangeCommit?.(roundTimelineTime(start), roundTimelineTime(end));
  }, [onClipRangeCommit]);

  const handleTimelineActionMoveEnd = useCallback(({
    action,
    start,
    end,
  }: {
    action: { id: string };
    start: number;
    end: number;
  }) => {
    if (action.id !== "selected-clip") {
      return;
    }

    commitClipRange(start, end);
  }, [commitClipRange]);

  const handleTimelineActionResizeEnd = useCallback(({
    action,
    start,
    end,
  }: {
    action: { id: string };
    start: number;
    end: number;
  }) => {
    if (action.id !== "selected-clip") {
      return;
    }

    commitClipRange(start, end);
  }, [commitClipRange]);

  return {
    timelineRef,
    timelineWheelRegionRef,
    timelineData,
    timelineEffects,
    activeTimelineScale,
    timelineScaleCount,
    timelineScrollLeft,
    timelineViewportWidth,
    handleTimelineScroll,
    handleTimelineZoomIn,
    handleTimelineZoomOut,
    canZoomIn: hasDuration && timelineZoomIndex > 0,
    canZoomOut: hasDuration && timelineZoomIndex < availableTimelineZoomLevels.length - 1,
    handleTimelineChange,
    handleTimelineActionMoveEnd,
    handleTimelineActionResizeEnd,
    hasDuration,
  };
}
