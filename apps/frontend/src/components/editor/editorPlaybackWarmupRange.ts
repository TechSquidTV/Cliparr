import type { PlaybackReadyRange } from "@/components/editor/editorPlaybackWarmupTypes";

export const PLAYBACK_READY_RANGE_FRESH_MS = 30_000;

const READY_RANGE_EPSILON = 1e-6;

export function createIdlePlaybackReadyRange(
  startTime: number,
  endTime: number,
): PlaybackReadyRange {
  return {
    startTime,
    endTime,
    readyUntilTime: startTime,
    status: "idle",
  };
}

export function markPlaybackReadyRangeFresh(
  range: PlaybackReadyRange,
  nowMs = Date.now(),
): PlaybackReadyRange {
  if (range.status === "idle") {
    return {
      startTime: range.startTime,
      endTime: range.endTime,
      readyUntilTime: range.readyUntilTime,
      status: range.status,
    };
  }

  return {
    ...range,
    updatedAtMs: nowMs,
    expiresAtMs: nowMs + PLAYBACK_READY_RANGE_FRESH_MS,
  };
}

export function resetPlaybackReadyRangeWarmState(
  range: PlaybackReadyRange,
): PlaybackReadyRange {
  return createIdlePlaybackReadyRange(range.startTime, range.endTime);
}

export function isPlaybackReadyRangeVisible(
  range: PlaybackReadyRange,
  nowMs = Date.now(),
) {
  if (range.status === "idle") {
    return false;
  }

  if (range.expiresAtMs !== undefined && range.expiresAtMs <= nowMs) {
    return false;
  }

  if (range.status === "warming") {
    return true;
  }

  return range.readyUntilTime - range.startTime > READY_RANGE_EPSILON;
}

export function samePlaybackReadyRange(
  left: Pick<PlaybackReadyRange, "startTime" | "endTime"> | null | undefined,
  right: Pick<PlaybackReadyRange, "startTime" | "endTime">,
) {
  return (
    left !== null &&
    left !== undefined &&
    Math.abs(left.startTime - right.startTime) < READY_RANGE_EPSILON &&
    Math.abs(left.endTime - right.endTime) < READY_RANGE_EPSILON
  );
}
