import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
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
  CLIP_TIMELINE_ROW_HEIGHT,
  SOURCE_TIMELINE_ROW_HEIGHT,
  SUBTITLE_TIMELINE_ROW_HEIGHT,
  timelineTimeToPixel,
  type ClipTimelineData,
  type ClipTimelineEffects,
} from "@/components/editor/editorUtilities";
import {
  accumulateTimelineWheelZoomDelta,
  resolveTimelineScrollWheelUpdate,
  resolveTimelineZoomUpdate,
} from "@/components/editor/timelineZoom";
import {
  assignSubtitleCueLanes,
  snapSubtitleCueTimingUpdateToAdjacentCue,
  subtitleCueIdFromActionId,
  subtitleCuesInTimelineWindow,
  subtitleCueTimelineLabel,
  subtitleTimelineActionId,
  type SubtitleCueTimingUpdate,
  type SubtitleCueTimingUpdateMode,
  type SubtitleTimelineTrack,
} from "@/components/editor/subtitleTimeline";

interface UseEditorTimelineProperties {
  duration: number;
  startTime: number;
  endTime: number;
  currentTime: number;
  sessionId: string;
  updateClipRange: (start: number, end: number) => void;
  onClipRangeCommit?: (start: number, end: number) => void;
  subtitleTimelineTrack?: SubtitleTimelineTrack | null;
  updateSubtitleCueTimings?: (
    updates: readonly SubtitleCueTimingUpdate[],
    duration: number,
  ) => void;
}

interface TimelineZoomAnchorOptions {
  anchorClientX?: number;
  anchorTime?: number;
}

const SUBTITLE_TIMELINE_OVERSCAN_SECONDS = 120;
const SUBTITLE_TIMELINE_SNAP_PIXELS = 8;
const SUBTITLE_TIMELINE_MAX_SNAP_SECONDS = 0.25;

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
  const desiredScrollLeft =
    selectionWidth >= viewportWidth - viewportGutter
      ? startPixel - viewportGutter
      : startPixel - (viewportWidth - selectionWidth) / 2;
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
  subtitleTimelineTrack,
  updateSubtitleCueTimings,
}: UseEditorTimelineProperties) {
  const timelineReference = useRef<TimelineState>(null);
  const timelineWheelRegionReference = useRef<HTMLDivElement>(null);

  const timelineScrollLeftReference = useRef(0);
  const pendingTimelineScrollLeftReference = useRef<number | null>(null);
  const timelineWheelDeltaReference = useRef(0);
  const hasUserAdjustedTimelineZoomReference = useRef(false);
  const hasPositionedTimelineViewReference = useRef(false);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);

  const hasDuration = duration > 0;

  const timelineEffects = useMemo<ClipTimelineEffects>(
    () => ({
      source: { id: "source", name: "Source" },
      clip: { id: "clip", name: "Clip" },
      subtitle: { id: "subtitle", name: "Subtitle" },
    }),
    [],
  );

  const defaultTimelineScale = useMemo(
    () => timelineScaleForDuration(duration),
    [duration],
  );
  const availableTimelineZoomLevels = useMemo(
    () => getTimelineZoomLevels(duration),
    [duration],
  );
  const defaultTimelineZoomIndex = useMemo(
    () =>
      getClosestTimelineZoomIndex(
        availableTimelineZoomLevels,
        defaultTimelineScale,
      ),
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

  const [timelineZoomIndex, setTimelineZoomIndex] = useState(
    defaultTimelineZoomIndex,
  );
  const timelineZoomIndexReference = useRef(timelineZoomIndex);

  const activeTimelineScale = getTimelineZoomLevel(
    availableTimelineZoomLevels,
    timelineZoomIndex,
    getTimelineZoomLevel(
      availableTimelineZoomLevels,
      defaultTimelineZoomIndex,
      defaultTimelineScale,
    ),
  );

  const timelineScaleCount = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(
          Math.max(duration, MIN_CLIP_SECONDS) / activeTimelineScale.scale,
        ),
      ),
    [duration, activeTimelineScale.scale],
  );
  const subtitleTimelineSnapThresholdSeconds = useMemo(
    () =>
      Math.min(
        SUBTITLE_TIMELINE_MAX_SNAP_SECONDS,
        (SUBTITLE_TIMELINE_SNAP_PIXELS / activeTimelineScale.scaleWidth) *
          activeTimelineScale.scale,
      ),
    [activeTimelineScale.scale, activeTimelineScale.scaleWidth],
  );

  const timelineData = useMemo<ClipTimelineData>(() => {
    const clipLength = hasDuration
      ? Math.min(MIN_CLIP_SECONDS, duration)
      : MIN_CLIP_SECONDS;
    const safeDuration = hasDuration
      ? roundTimelineTime(duration)
      : MIN_CLIP_SECONDS;
    const safeStart = hasDuration
      ? roundTimelineTime(
          Math.min(Math.max(startTime, 0), Math.max(duration - clipLength, 0)),
        )
      : 0;
    const safeEnd = hasDuration
      ? roundTimelineTime(
          Math.min(Math.max(endTime, safeStart + clipLength), duration),
        )
      : MIN_CLIP_SECONDS;

    const subtitleTimelineCues = subtitleTimelineTrack
      ? subtitleCuesInTimelineWindow({
          cues: subtitleTimelineTrack.cues,
          startTime: Math.max(
            0,
            safeStart - SUBTITLE_TIMELINE_OVERSCAN_SECONDS,
          ),
          endTime: Math.min(
            safeDuration,
            safeEnd + SUBTITLE_TIMELINE_OVERSCAN_SECONDS,
          ),
        })
      : [];
    const subtitleRows =
      subtitleTimelineTrack && subtitleTimelineCues.length > 0
        ? assignSubtitleCueLanes(subtitleTimelineCues).map((lane) => ({
            id: `${subtitleTimelineTrack.id}:lane:${lane.index}`,
            rowHeight: SUBTITLE_TIMELINE_ROW_HEIGHT,
            actions: lane.cues.map((cue) => ({
              id: subtitleTimelineActionId(cue.id),
              start: roundTimelineTime(cue.startTime),
              end: roundTimelineTime(cue.endTime),
              effectId: "subtitle",
              flexible: hasDuration,
              movable: hasDuration,
              minStart: 0,
              maxEnd: safeDuration,
            })),
          }))
        : [];

    return [
      {
        id: "source-media",
        rowHeight: SOURCE_TIMELINE_ROW_HEIGHT,
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
        rowHeight: CLIP_TIMELINE_ROW_HEIGHT,
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
      ...subtitleRows,
    ];
  }, [duration, endTime, hasDuration, startTime, subtitleTimelineTrack]);

  const timelineSubtitleActionLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const cue of subtitleTimelineTrack?.cues ?? []) {
      labels.set(
        subtitleTimelineActionId(cue.id),
        subtitleCueTimelineLabel(cue),
      );
    }
    return labels;
  }, [subtitleTimelineTrack]);

  useEffect(() => {
    timelineZoomIndexReference.current = timelineZoomIndex;
  }, [timelineZoomIndex]);

  useEffect(() => {
    const timelineWheelRegion = timelineWheelRegionReference.current;
    if (!timelineWheelRegion) {
      return;
    }

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
    timelineZoomIndexReference.current = defaultTimelineZoomIndex;
    timelineScrollLeftReference.current = 0;
    timelineWheelDeltaReference.current = 0;
    hasUserAdjustedTimelineZoomReference.current = false;
    hasPositionedTimelineViewReference.current = false;
    timelineReference.current?.setScrollLeft(0);
    pendingTimelineScrollLeftReference.current = 0;
  }, [defaultTimelineZoomIndex, sessionId]);

  useEffect(() => {
    if (
      !hasDuration ||
      timelineViewportWidth <= 0 ||
      hasUserAdjustedTimelineZoomReference.current ||
      hasPositionedTimelineViewReference.current
    ) {
      return;
    }

    const focusedTimelineScale = getTimelineZoomLevel(
      availableTimelineZoomLevels,
      focusedTimelineZoomIndex,
      getTimelineZoomLevel(
        availableTimelineZoomLevels,
        defaultTimelineZoomIndex,
        defaultTimelineScale,
      ),
    );
    const nextScrollLeft = getTimelineRangeScrollLeft({
      start: startTime,
      end: endTime,
      duration,
      timelineScale: focusedTimelineScale,
      viewportWidth: timelineViewportWidth,
    });

    setTimelineZoomIndex(focusedTimelineZoomIndex);
    timelineZoomIndexReference.current = focusedTimelineZoomIndex;
    timelineScrollLeftReference.current = nextScrollLeft;
    timelineWheelDeltaReference.current = 0;
    hasPositionedTimelineViewReference.current = true;
    timelineReference.current?.setScrollLeft(nextScrollLeft);
    pendingTimelineScrollLeftReference.current = nextScrollLeft;
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
    const pendingScrollLeft = pendingTimelineScrollLeftReference.current;
    if (pendingScrollLeft === null) {
      return;
    }

    timelineReference.current?.setScrollLeft(pendingScrollLeft);
    timelineScrollLeftReference.current = pendingScrollLeft;
    pendingTimelineScrollLeftReference.current = null;
  }, [activeTimelineScale.scale, activeTimelineScale.scaleWidth]);

  const setTimelineCurrentTime = useCallback(
    (time: number) => {
      if (!hasDuration) {
        return;
      }

      timelineReference.current?.setTime(time);
    },
    [hasDuration],
  );

  useEffect(() => {
    if (!timelineReference.current || !hasDuration) {
      return;
    }
    setTimelineCurrentTime(currentTime);
  }, [currentTime, hasDuration, setTimelineCurrentTime]);

  const handleTimelineScroll = useCallback(
    ({ scrollLeft }: { scrollLeft: number }) => {
      timelineScrollLeftReference.current = scrollLeft;
    },
    [],
  );

  const getTimelineZoomAnchorTime = useCallback(() => {
    if (currentTime >= startTime && currentTime <= endTime) {
      return currentTime;
    }

    return startTime + (endTime - startTime) / 2;
  }, [currentTime, endTime, startTime]);

  const updateTimelineZoom = useCallback(
    (zoomDelta: number, anchorOptions: TimelineZoomAnchorOptions = {}) => {
      if (
        !hasDuration ||
        availableTimelineZoomLevels.length < 2 ||
        zoomDelta === 0
      ) {
        return;
      }

      const timelineWheelRegion = timelineWheelRegionReference.current;
      if (!timelineWheelRegion) {
        return;
      }

      const currentZoomIndex = timelineZoomIndexReference.current;
      const currentScrollLeft =
        pendingTimelineScrollLeftReference.current ??
        timelineScrollLeftReference.current;
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
        timelineWheelDeltaReference.current = 0;
        return;
      }

      const { nextZoomIndex, nextScrollLeft } = zoomUpdate;
      pendingTimelineScrollLeftReference.current = nextScrollLeft;
      timelineScrollLeftReference.current = nextScrollLeft;
      timelineZoomIndexReference.current = nextZoomIndex;
      hasUserAdjustedTimelineZoomReference.current = true;

      startTransition(() => {
        setTimelineZoomIndex(nextZoomIndex);
      });
    },
    [activeTimelineScale, availableTimelineZoomLevels, duration, hasDuration],
  );

  const handleTimelineZoomIn = useCallback(() => {
    updateTimelineZoom(-1, { anchorTime: getTimelineZoomAnchorTime() });
  }, [getTimelineZoomAnchorTime, updateTimelineZoom]);

  const handleTimelineZoomOut = useCallback(() => {
    updateTimelineZoom(1, { anchorTime: getTimelineZoomAnchorTime() });
  }, [getTimelineZoomAnchorTime, updateTimelineZoom]);

  const handleTimelineWheel = useCallback(
    (event: WheelEvent) => {
      if (!hasDuration) {
        return;
      }

      const timelineWheelRegion = timelineWheelRegionReference.current;
      if (!timelineWheelRegion) {
        return;
      }

      const containerHeight = timelineWheelRegion.clientHeight || 1;
      const containerWidth = timelineWheelRegion.clientWidth || 1;

      if (!event.metaKey && !event.ctrlKey) {
        timelineWheelDeltaReference.current = 0;
        const nextScrollLeft = resolveTimelineScrollWheelUpdate({
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          containerWidth,
          containerHeight,
          currentScrollLeft: timelineScrollLeftReference.current,
          duration,
          timelineScale: activeTimelineScale,
        });
        if (nextScrollLeft === null) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        timelineReference.current?.setScrollLeft(nextScrollLeft);
        timelineScrollLeftReference.current = nextScrollLeft;
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (availableTimelineZoomLevels.length < 2) {
        return;
      }

      const { accumulatedWheelDelta, zoomDelta } =
        accumulateTimelineWheelZoomDelta({
          currentWheelDelta: timelineWheelDeltaReference.current,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          containerHeight,
        });
      timelineWheelDeltaReference.current = accumulatedWheelDelta;
      if (zoomDelta === 0) {
        return;
      }
      updateTimelineZoom(zoomDelta, { anchorClientX: event.clientX });
    },
    [
      hasDuration,
      duration,
      activeTimelineScale,
      availableTimelineZoomLevels,
      updateTimelineZoom,
    ],
  );

  useEffect(() => {
    const timelineWheelRegion = timelineWheelRegionReference.current;
    if (!timelineWheelRegion) {
      return;
    }

    timelineWheelRegion.addEventListener("wheel", handleTimelineWheel, {
      passive: false,
    });

    return () => {
      timelineWheelRegion.removeEventListener("wheel", handleTimelineWheel);
    };
  }, [handleTimelineWheel]);

  const handleTimelineChange = useCallback(() => false, []);

  const commitClipRange = useCallback(
    (start: number, end: number) => {
      const nextStart = roundTimelineTime(start);
      const nextEnd = roundTimelineTime(end);

      updateClipRange(nextStart, nextEnd);
      onClipRangeCommit?.(nextStart, nextEnd);
    },
    [onClipRangeCommit, updateClipRange],
  );

  const commitSubtitleCueTiming = useCallback(
    ({
      action,
      start,
      end,
      mode,
    }: {
      action: { id: string };
      start: number;
      end: number;
      mode: SubtitleCueTimingUpdateMode;
    }) => {
      const cueId = subtitleCueIdFromActionId(action.id);
      if (!cueId) {
        return;
      }

      updateSubtitleCueTimings?.(
        [
          snapSubtitleCueTimingUpdateToAdjacentCue({
            track: subtitleTimelineTrack,
            duration,
            thresholdSeconds: subtitleTimelineSnapThresholdSeconds,
            mode,
            update: {
              cueId,
              startTime: start,
              endTime: end,
            },
          }),
        ],
        duration,
      );
    },
    [
      duration,
      subtitleTimelineSnapThresholdSeconds,
      subtitleTimelineTrack,
      updateSubtitleCueTimings,
    ],
  );

  const handleTimelineActionMoveEnd = useCallback(
    ({
      action,
      start,
      end,
    }: {
      action: { id: string };
      start: number;
      end: number;
    }) => {
      if (action.id !== "selected-clip") {
        commitSubtitleCueTiming({ action, start, end, mode: "move" });
        return;
      }

      commitClipRange(start, end);
    },
    [commitClipRange, commitSubtitleCueTiming],
  );

  const handleTimelineActionResizeEnd = useCallback(
    ({
      action,
      start,
      end,
      dir,
    }: {
      action: { id: string };
      start: number;
      end: number;
      dir?: "right" | "left";
    }) => {
      if (action.id !== "selected-clip") {
        commitSubtitleCueTiming({
          action,
          start,
          end,
          mode: dir === "left" ? "resize-left" : "resize-right",
        });
        return;
      }

      commitClipRange(start, end);
    },
    [commitClipRange, commitSubtitleCueTiming],
  );

  return {
    timelineRef: timelineReference,
    timelineWheelRegionRef: timelineWheelRegionReference,
    timelineData,
    timelineEffects,
    timelineSubtitleActionLabels,
    activeTimelineScale,
    timelineScaleCount,
    timelineViewportWidth,
    handleTimelineScroll,
    handleTimelineZoomIn,
    handleTimelineZoomOut,
    canZoomIn: hasDuration && timelineZoomIndex > 0,
    canZoomOut:
      hasDuration && timelineZoomIndex < availableTimelineZoomLevels.length - 1,
    handleTimelineChange,
    handleTimelineActionMoveEnd,
    handleTimelineActionResizeEnd,
    setTimelineCurrentTime,
    hasDuration,
  };
}
