import {
  MIN_CLIP_SECONDS,
  roundTimelineTime,
  type ClipTimelineAction,
} from "@/components/editor/editorUtils";
import type { SubtitleCue } from "@/lib/subtitles/types";

export interface EditableSubtitleCue extends SubtitleCue {
  id: string;
}

export interface SubtitleCueRangeUpdate {
  cueId: string;
  startTime: number;
  endTime: number;
}

const SUBTITLE_TIMELINE_ACTION_PREFIX = "subtitle-cue:";
export const SUBTITLE_LOADING_ACTION_ID = "subtitle-loading";

function sanitizeCueId(value: string) {
  return value.replace(/[^a-zA-Z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "");
}

function stableSubtitleCueId(cue: SubtitleCue, index: number) {
  const sourceId = sanitizeCueId(cue.id?.trim() || "cue");
  const start = roundTimelineTime(cue.startTime).toFixed(2);
  const end = roundTimelineTime(cue.endTime).toFixed(2);

  return sanitizeCueId(`cue-${index + 1}-${sourceId}-${start}-${end}`).slice(
    0,
    96,
  );
}

function sortedSubtitleCues(cues: readonly EditableSubtitleCue[]) {
  return [...cues].sort(
    (left, right) =>
      left.startTime - right.startTime ||
      left.endTime - right.endTime ||
      left.id.localeCompare(right.id),
  );
}

export function subtitleCueTextToLines(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function normalizeEditableSubtitleCues(
  cues: readonly SubtitleCue[],
): EditableSubtitleCue[] {
  return sortedSubtitleCues(
    cues.map((cue, index) => {
      const text = cue.text.replace(/\r\n?/g, "\n").trim();
      const lines =
        cue.lines.length > 0
          ? cue.lines.map((line) => line.trim()).filter(Boolean)
          : subtitleCueTextToLines(text);

      return {
        ...cue,
        id: stableSubtitleCueId(cue, index),
        startTime: roundTimelineTime(cue.startTime),
        endTime: roundTimelineTime(cue.endTime),
        text,
        lines,
      };
    }),
  );
}

export function clampSubtitleCueRange({
  startTime,
  endTime,
  duration,
}: {
  startTime: number;
  endTime: number;
  duration: number;
}) {
  const safeDuration = Math.max(
    0,
    roundTimelineTime(Number.isFinite(duration) ? duration : 0),
  );
  if (safeDuration <= 0) {
    return {
      startTime: 0,
      endTime: 0,
    };
  }

  const minCueDuration = Math.min(MIN_CLIP_SECONDS, safeDuration);
  const safeStart = Number.isFinite(startTime) ? startTime : 0;
  const safeEnd = Number.isFinite(endTime) ? endTime : safeStart;
  const clampedStart = Math.min(
    Math.max(safeStart, 0),
    Math.max(safeDuration - minCueDuration, 0),
  );
  const clampedEnd = Math.min(
    Math.max(safeEnd, clampedStart + minCueDuration),
    safeDuration,
  );

  return {
    startTime: roundTimelineTime(clampedStart),
    endTime: roundTimelineTime(clampedEnd),
  };
}

export function updateEditableSubtitleCueText(
  cues: EditableSubtitleCue[],
  cueId: string,
  text: string,
) {
  const normalizedText = text.replace(/\r\n?/g, "\n");
  let changed = false;
  const nextCues = cues.map((cue) => {
    if (cue.id !== cueId) {
      return cue;
    }

    const lines = subtitleCueTextToLines(normalizedText);
    if (
      cue.text === normalizedText &&
      cue.lines.join("\n") === lines.join("\n")
    ) {
      return cue;
    }

    changed = true;
    return {
      ...cue,
      text: normalizedText,
      lines,
    };
  });

  return changed ? nextCues : cues;
}

export function updateEditableSubtitleCueRanges(
  cues: EditableSubtitleCue[],
  updates: readonly SubtitleCueRangeUpdate[],
  duration: number,
) {
  if (updates.length === 0) {
    return cues;
  }

  const updatesByCueId = new Map(
    updates.map((update) => [update.cueId, update] as const),
  );
  let changed = false;
  const nextCues = cues.map((cue) => {
    const update = updatesByCueId.get(cue.id);
    if (!update) {
      return cue;
    }

    const range = clampSubtitleCueRange({
      startTime: update.startTime,
      endTime: update.endTime,
      duration,
    });
    if (cue.startTime === range.startTime && cue.endTime === range.endTime) {
      return cue;
    }

    changed = true;
    return {
      ...cue,
      ...range,
    };
  });

  return changed ? sortedSubtitleCues(nextCues) : cues;
}

export function subtitleCueActionId(cueId: string) {
  return `${SUBTITLE_TIMELINE_ACTION_PREFIX}${cueId}`;
}

export function subtitleCueIdFromActionId(actionId: string) {
  return actionId.startsWith(SUBTITLE_TIMELINE_ACTION_PREFIX)
    ? actionId.slice(SUBTITLE_TIMELINE_ACTION_PREFIX.length)
    : null;
}

export function buildSubtitleTimelineActions({
  cues,
  duration,
  selectedCueId,
  loading,
}: {
  cues: readonly EditableSubtitleCue[];
  duration: number;
  selectedCueId: string | null;
  loading: boolean;
}) {
  const safeDuration = Math.max(duration, MIN_CLIP_SECONDS);

  if (loading && cues.length === 0) {
    return [
      {
        id: SUBTITLE_LOADING_ACTION_ID,
        start: 0,
        end: safeDuration,
        effectId: "subtitle-placeholder",
        flexible: false,
        movable: false,
        minStart: 0,
        maxEnd: safeDuration,
      },
    ] as ClipTimelineAction[];
  }

  return cues.map((cue) => ({
    id: subtitleCueActionId(cue.id),
    start: cue.startTime,
    end: cue.endTime,
    effectId: "subtitle",
    selected: cue.id === selectedCueId,
    flexible: true,
    movable: true,
    minStart: 0,
    maxEnd: safeDuration,
  })) as ClipTimelineAction[];
}
