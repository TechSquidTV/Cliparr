import type { Timeline } from "@xzdarcy/react-timeline-editor";
import type { ComponentProps } from "react";

export const MIN_CLIP_SECONDS = 0.1;
export const TIMELINE_START_LEFT = 24;
const MAX_TIMELINE_ZOOM_SCALE_COUNT = 2000;
export const TIMELINE_ZOOM_WHEEL_STEP = 80;
const MIN_FOCUSED_TIMELINE_SELECTION_PIXELS = 96;
const MAX_FOCUSED_TIMELINE_SELECTION_PIXELS = 280;
const TIMELINE_ZOOM_WIDTH_MULTIPLIERS = [0.64, 0.72, 0.8, 0.88, 0.96, 1.04, 1.12, 1.2] as const;

type TimelineZoomPreset = {
  scale: number;
  scaleSplitCount: number;
  scaleWidth: number;
};

export type TimelineZoomLevel = TimelineZoomPreset;

const TIMELINE_ZOOM_PRESETS: readonly TimelineZoomPreset[] = [
  { scale: 1, scaleSplitCount: 10, scaleWidth: 160 },
  { scale: 2, scaleSplitCount: 8, scaleWidth: 152 },
  { scale: 5, scaleSplitCount: 5, scaleWidth: 120 },
  { scale: 10, scaleSplitCount: 5, scaleWidth: 124 },
  { scale: 15, scaleSplitCount: 5, scaleWidth: 128 },
  { scale: 30, scaleSplitCount: 6, scaleWidth: 136 },
  { scale: 60, scaleSplitCount: 6, scaleWidth: 140 },
  { scale: 120, scaleSplitCount: 6, scaleWidth: 144 },
  { scale: 300, scaleSplitCount: 5, scaleWidth: 148 },
  { scale: 600, scaleSplitCount: 5, scaleWidth: 152 },
];

export type ClipTimelineData = ComponentProps<typeof Timeline>["editorData"];
export type ClipTimelineEffects = ComponentProps<typeof Timeline>["effects"];
export type ClipTimelineAction = ClipTimelineData[number]["actions"][number];

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return "0:00";
  }

  const roundedCentiseconds = Math.max(0, Math.round(seconds * 100));
  const totalSeconds = Math.floor(roundedCentiseconds / 100);
  const centiseconds = roundedCentiseconds % 100;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  const fraction = centiseconds > 0 ? `.${centiseconds.toString().padStart(2, "0")}` : "";

  if (hours > 0) {
    return [
      hours,
      minutes.toString().padStart(2, "0"),
      remainingSeconds.toString().padStart(2, "0"),
    ].join(":") + fraction;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}${fraction}`;
}

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Preview failed to load";
}

export function isAc3FamilyCodec(codec: string | null) {
  return codec === "ac3" || codec === "eac3";
}

export function roundTimelineTime(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return 0;
  }

  return Math.round(seconds * 100) / 100;
}

export function timelineScaleForDuration(seconds: number) {
  if (seconds <= 60) {
    return { scale: 5, scaleSplitCount: 5, scaleWidth: 120 };
  }

  if (seconds <= 5 * 60) {
    return { scale: 15, scaleSplitCount: 5, scaleWidth: 128 };
  }

  if (seconds <= 30 * 60) {
    return { scale: 60, scaleSplitCount: 6, scaleWidth: 140 };
  }

  return { scale: 5 * 60, scaleSplitCount: 5, scaleWidth: 148 };
}

function getTimelineZoomWidthLevels(preset: TimelineZoomPreset) {
  return TIMELINE_ZOOM_WIDTH_MULTIPLIERS.map((widthMultiplier) => ({
    scale: preset.scale,
    scaleSplitCount: preset.scaleSplitCount,
    scaleWidth: Math.max(72, Math.round((preset.scaleWidth * widthMultiplier) / 4) * 4),
  }));
}

export function getTimelineZoomLevels(seconds: number) {
  const safeDuration = Math.max(seconds, MIN_CLIP_SECONDS);
  const availableLevels = new Map<string, TimelineZoomLevel>();

  for (const preset of TIMELINE_ZOOM_PRESETS) {
    if (Math.ceil(safeDuration / preset.scale) > MAX_TIMELINE_ZOOM_SCALE_COUNT) {
      continue;
    }

    for (const zoomLevel of getTimelineZoomWidthLevels(preset)) {
      availableLevels.set(
        `${zoomLevel.scale}:${zoomLevel.scaleSplitCount}:${zoomLevel.scaleWidth}`,
        zoomLevel,
      );
    }
  }

  if (availableLevels.size === 0) {
    const fallbackPreset = TIMELINE_ZOOM_PRESETS[TIMELINE_ZOOM_PRESETS.length - 1];
    const minimumSafeScale = Math.max(1, Math.ceil(safeDuration / MAX_TIMELINE_ZOOM_SCALE_COUNT));
    return getTimelineZoomWidthLevels({
      scale: Math.max(fallbackPreset.scale, minimumSafeScale),
      scaleSplitCount: fallbackPreset.scaleSplitCount,
      scaleWidth: fallbackPreset.scaleWidth,
    });
  }

  return [...availableLevels.values()].sort((left, right) => {
    const zoomDensityDifference = (right.scaleWidth / right.scale) - (left.scaleWidth / left.scale);
    if (zoomDensityDifference !== 0) {
      return zoomDensityDifference;
    }

    return left.scale - right.scale;
  });
}

export function getClosestTimelineZoomIndex(levels: readonly TimelineZoomLevel[], targetScale: TimelineZoomPreset) {
  const targetZoomDensity = targetScale.scaleWidth / targetScale.scale;

  return levels.reduce((closestIndex, level, index) => {
    const closestLevel = levels[closestIndex];
    const closestDensityDistance = Math.abs((closestLevel.scaleWidth / closestLevel.scale) - targetZoomDensity);
    const nextDensityDistance = Math.abs((level.scaleWidth / level.scale) - targetZoomDensity);

    if (nextDensityDistance !== closestDensityDistance) {
      return nextDensityDistance < closestDensityDistance ? index : closestIndex;
    }

    const closestScaleDistance = Math.abs(closestLevel.scale - targetScale.scale);
    const nextScaleDistance = Math.abs(level.scale - targetScale.scale);
    return nextScaleDistance < closestScaleDistance ? index : closestIndex;
  }, 0);
}

export function getFocusedTimelineZoomIndex(
  levels: readonly TimelineZoomLevel[],
  focusDuration: number,
  viewportWidth: number,
) {
  if (levels.length === 0) {
    return 0;
  }

  const safeFocusDuration = Math.max(focusDuration, MIN_CLIP_SECONDS);
  const editableWidth = Math.max(1, viewportWidth - TIMELINE_START_LEFT);
  const targetSelectionPixels = Math.min(
    Math.max(MIN_FOCUSED_TIMELINE_SELECTION_PIXELS, editableWidth * 0.32),
    Math.min(MAX_FOCUSED_TIMELINE_SELECTION_PIXELS, editableWidth * 0.72),
  );
  const maximumComfortableSelectionPixels = Math.max(
    targetSelectionPixels,
    editableWidth * 0.85,
  );

  return levels.reduce((bestIndex, level, index) => {
    const bestLevel = levels[bestIndex];
    const scoreLevel = (candidate: TimelineZoomLevel) => {
      const selectionPixels = (safeFocusDuration / candidate.scale) * candidate.scaleWidth;
      const targetDistance = Math.abs(
        Math.log2(Math.max(selectionPixels, 1) / targetSelectionPixels),
      );
      const undersizedPenalty = Math.max(
        0,
        MIN_FOCUSED_TIMELINE_SELECTION_PIXELS - selectionPixels,
      ) / MIN_FOCUSED_TIMELINE_SELECTION_PIXELS;
      const oversizedPenalty = Math.max(
        0,
        selectionPixels - maximumComfortableSelectionPixels,
      ) / maximumComfortableSelectionPixels;

      return targetDistance + undersizedPenalty * 3 + oversizedPenalty * 1.5;
    };

    return scoreLevel(level) < scoreLevel(bestLevel) ? index : bestIndex;
  }, 0);
}

export function timelinePixelToTime(pixel: number, scale: number, scaleWidth: number, startLeft: number) {
  return ((pixel - startLeft) / scaleWidth) * scale;
}

export function timelineTimeToPixel(time: number, scale: number, scaleWidth: number, startLeft: number) {
  return startLeft + (time / scale) * scaleWidth;
}

export function normalizeWheelDelta(
  deltaY: number,
  deltaMode: number,
  containerSize: number,
) {
  switch (deltaMode) {
    case 1:
      return deltaY * 16;
    case 2:
      return deltaY * containerSize;
    default:
      return deltaY;
  }
}

export function getTimelineMaxScrollLeft(
  duration: number,
  scale: number,
  scaleWidth: number,
  viewportWidth: number,
) {
  return Math.max(
    0,
    Math.ceil(Math.max(duration, MIN_CLIP_SECONDS) / scale) * scaleWidth
    + TIMELINE_START_LEFT
    - viewportWidth,
  );
}

export function getTimelineZoomLevel(
  levels: readonly TimelineZoomLevel[],
  index: number,
  fallback: TimelineZoomLevel,
) {
  return levels[index] ?? fallback;
}

export function themeValue(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
