import { formatTimecode } from "@techsquidtv/canvas-timeline/utils";

export const MIN_CLIP_SECONDS = 0.1;

export function formatTime(seconds: number) {
  return formatTimecode(seconds).replace(/\.00$/, "");
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Preview failed to load";
}

export function roundTimelineTime(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return 0;
  }

  return Math.round(seconds * 100) / 100;
}

export function clampPlaybackTime(seconds: number, duration: number) {
  if (
    !Number.isFinite(seconds) ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return 0;
  }

  return roundTimelineTime(Math.min(Math.max(seconds, 0), duration));
}

export function clampClipStartTime(
  nextStart: number,
  currentEnd: number,
  duration: number,
) {
  if (
    !Number.isFinite(nextStart) ||
    !Number.isFinite(currentEnd) ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return 0;
  }

  const minClipLength = Math.min(MIN_CLIP_SECONDS, duration);
  const boundedEnd = Math.min(Math.max(currentEnd, minClipLength), duration);
  const maxStart = Math.max(boundedEnd - minClipLength, 0);

  return roundTimelineTime(Math.min(Math.max(nextStart, 0), maxStart));
}

export function clampClipEndTime(
  nextEnd: number,
  currentStart: number,
  duration: number,
) {
  if (
    !Number.isFinite(nextEnd) ||
    !Number.isFinite(currentStart) ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return 0;
  }

  const minClipLength = Math.min(MIN_CLIP_SECONDS, duration);
  const boundedStart = Math.min(
    Math.max(currentStart, 0),
    Math.max(duration - minClipLength, 0),
  );
  const minEnd = boundedStart + minClipLength;

  return roundTimelineTime(Math.min(Math.max(nextEnd, minEnd), duration));
}
