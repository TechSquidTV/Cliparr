import type { SubtitleCue } from "#/lib/subtitles/types";

// Cues are ordered by start time. Keep overlapping cues in paint order.
function collectStartedCues(
  cues: readonly SubtitleCue[],
  startIndex: number,
  time: number,
  active: SubtitleCue[],
) {
  let index = startIndex;
  let lastBoundary = -Infinity;
  while (index < cues.length && cues[index].startTime <= time) {
    const cue = cues[index++];
    lastBoundary = Math.max(
      lastBoundary,
      time < cue.endTime ? cue.startTime : cue.endTime,
    );
    if (time < cue.endTime) {
      active.push(cue);
    }
  }
  return { nextIndex: index, lastBoundary };
}

export function createSubtitlePreviewCueReader(cues: readonly SubtitleCue[]) {
  let nextIndex = 0;
  let from = -Infinity;
  let until = -Infinity;
  let active: SubtitleCue[] = [];

  return (time: number) => {
    if (!Number.isFinite(time)) {
      return [];
    }
    if (time >= from && time < until) {
      return active;
    }
    if (time < from) {
      nextIndex = 0;
      from = -Infinity;
      active = [];
    } else {
      active = active.filter((cue) => {
        if (time < cue.endTime) {
          return true;
        }
        from = Math.max(from, cue.endTime);
        return false;
      });
    }
    const collected = collectStartedCues(cues, nextIndex, time, active);
    nextIndex = collected.nextIndex;
    from = Math.max(from, collected.lastBoundary);
    until = cues[nextIndex]?.startTime ?? Infinity;
    for (const cue of active) {
      until = Math.min(until, cue.endTime);
    }
    return active;
  };
}

export function getActiveSubtitleCues(
  cues: readonly SubtitleCue[],
  time: number,
) {
  if (!Number.isFinite(time)) {
    return [];
  }

  const activeCues: SubtitleCue[] = [];
  collectStartedCues(cues, 0, time, activeCues);
  return activeCues;
}

export function getActiveSubtitleCue(
  cues: readonly SubtitleCue[],
  time: number,
) {
  return getActiveSubtitleCues(cues, time)[0];
}
