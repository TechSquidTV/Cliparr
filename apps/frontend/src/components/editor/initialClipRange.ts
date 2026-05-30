import { MIN_CLIP_SECONDS, roundTimelineTime } from "./editorUtils";

const DEFAULT_INITIAL_CLIP_SECONDS = 10;

export interface InitialClipRange {
  startTime: number;
  endTime: number;
}

interface DiscoveredDurationClipRangeInput {
  initialDuration: number;
  currentStartTime: number;
  currentEndTime: number;
  discoveredDuration: number;
  playheadSeconds?: number;
}

function finiteNonNegativeSeconds(value: number | null | undefined) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
}

function roundTimeWithinUpperBound(seconds: number, upperBound: number) {
  return Math.min(roundTimelineTime(seconds), upperBound);
}

export function buildInitialClipRange(
  duration: number,
  playheadSeconds?: number,
): InitialClipRange {
  const safeDuration = finiteNonNegativeSeconds(duration);
  if (safeDuration <= 0) {
    return {
      startTime: 0,
      endTime: 0,
    };
  }

  const minimumClipLength = Math.min(MIN_CLIP_SECONDS, safeDuration);
  const maximumStart = Math.max(safeDuration - minimumClipLength, 0);
  const startTime = roundTimeWithinUpperBound(
    Math.min(finiteNonNegativeSeconds(playheadSeconds), maximumStart),
    maximumStart,
  );
  const preferredEnd = startTime + DEFAULT_INITIAL_CLIP_SECONDS;
  const endTime = roundTimeWithinUpperBound(
    Math.min(
      Math.max(preferredEnd, startTime + minimumClipLength),
      safeDuration,
    ),
    safeDuration,
  );

  return {
    startTime,
    endTime,
  };
}

export function buildClipRangeAfterDurationDiscovery({
  initialDuration,
  currentStartTime,
  currentEndTime,
  discoveredDuration,
  playheadSeconds,
}: DiscoveredDurationClipRangeInput): InitialClipRange | null {
  if (
    finiteNonNegativeSeconds(initialDuration) > 0 ||
    finiteNonNegativeSeconds(discoveredDuration) <= 0 ||
    currentStartTime !== 0 ||
    currentEndTime !== 0
  ) {
    return null;
  }

  return buildInitialClipRange(discoveredDuration, playheadSeconds);
}
