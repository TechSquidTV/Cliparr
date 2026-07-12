export const MIN_CLIP_SECONDS = 0.1;

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
  const fraction =
    centiseconds > 0 ? `.${centiseconds.toString().padStart(2, "0")}` : "";

  if (hours > 0) {
    return (
      [
        hours,
        minutes.toString().padStart(2, "0"),
        remainingSeconds.toString().padStart(2, "0"),
      ].join(":") + fraction
    );
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}${fraction}`;
}

export function formatTimecodeInput(seconds: number) {
  const roundedCentiseconds = Math.max(
    0,
    Math.round((Number.isFinite(seconds) ? seconds : 0) * 100),
  );
  const totalSeconds = Math.floor(roundedCentiseconds / 100);
  const centiseconds = roundedCentiseconds % 100;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  const fraction = centiseconds.toString().padStart(2, "0");

  if (hours > 0) {
    return `${[
      hours,
      minutes.toString().padStart(2, "0"),
      remainingSeconds.toString().padStart(2, "0"),
    ].join(":")}.${fraction}`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}.${fraction}`;
}

export function parseTimecodeInput(value: string) {
  const trimmed = value.trim();

  if (!trimmed || trimmed.startsWith("-")) {
    return null;
  }

  const numberPattern = /^\d+(?:\.\d+)?$/;
  if (numberPattern.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? roundTimelineTime(seconds) : null;
  }

  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  const hasHours = parts.length === 3;
  const [hoursPart, minutesPart, secondsPart] = hasHours
    ? parts
    : ["0", parts[0], parts[1]];
  if (
    !/^\d+$/.test(hoursPart) ||
    !/^\d+$/.test(minutesPart) ||
    !numberPattern.test(secondsPart)
  ) {
    return null;
  }

  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  const seconds = Number(secondsPart);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    (hasHours && minutes >= 60) ||
    seconds >= 60
  ) {
    return null;
  }

  return roundTimelineTime(hours * 3600 + minutes * 60 + seconds);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Preview failed to load";
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
