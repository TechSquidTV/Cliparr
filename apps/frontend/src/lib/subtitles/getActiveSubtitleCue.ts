import type { SubtitleCue } from "@/lib/subtitles/types";

export function getActiveSubtitleCues(
  cues: readonly SubtitleCue[],
  time: number,
) {
  if (!Number.isFinite(time)) {
    return [];
  }

  const activeCues: SubtitleCue[] = [];
  for (const cue of cues) {
    if (cue.startTime > time) {
      break;
    }

    if (time >= cue.startTime && time < cue.endTime) {
      activeCues.push(cue);
    }
  }

  return activeCues;
}

export function getActiveSubtitleCue(
  cues: readonly SubtitleCue[],
  time: number,
) {
  return getActiveSubtitleCues(cues, time)[0];
}
