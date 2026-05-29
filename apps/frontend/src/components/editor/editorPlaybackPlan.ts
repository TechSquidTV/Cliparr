type PreviewPlaybackMode = "selection" | "source";

export interface PreviewPlaybackPlan {
  mode: PreviewPlaybackMode;
  startTime: number;
  stopTime: number;
  resetTime: number | null;
}

interface PreviewPlaybackPlanOptions {
  currentTime: number;
  clipStart: number;
  clipEnd: number;
  duration: number;
}

const CLIP_START_PLAY_SNAP_SECONDS = 1;

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function resolvePreviewPlaybackPlan({
  currentTime,
  clipStart,
  clipEnd,
  duration,
}: PreviewPlaybackPlanOptions): PreviewPlaybackPlan {
  const safeDuration = finiteNonNegative(duration);
  const safeClipStart = clamp(finiteNonNegative(clipStart), 0, safeDuration);
  const safeClipEnd = clamp(
    finiteNonNegative(clipEnd || safeDuration),
    safeClipStart,
    safeDuration,
  );
  const safeCurrentTime = clamp(
    finiteNonNegative(currentTime),
    0,
    safeDuration,
  );
  const hasSelection = safeClipEnd > safeClipStart;
  const nearSelectionStart =
    hasSelection &&
    Math.abs(safeCurrentTime - safeClipStart) <= CLIP_START_PLAY_SNAP_SECONDS;
  const insideSelection =
    hasSelection &&
    safeCurrentTime >= safeClipStart &&
    safeCurrentTime < safeClipEnd;

  if (hasSelection && (nearSelectionStart || insideSelection)) {
    return {
      mode: "selection",
      startTime: nearSelectionStart ? safeClipStart : safeCurrentTime,
      stopTime: safeClipEnd,
      resetTime: safeClipStart,
    };
  }

  return {
    mode: "source",
    startTime: safeCurrentTime,
    stopTime: safeDuration,
    resetTime: null,
  };
}
