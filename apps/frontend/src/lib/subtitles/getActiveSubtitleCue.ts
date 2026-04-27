import type { SubtitleCue } from "./types";

export function getActiveSubtitleCue(cues: readonly SubtitleCue[], time: number) {
  let low = 0;
  let high = cues.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const cue = cues[mid];
    if (!cue) {
      break;
    }

    if (time < cue.startTime) {
      high = mid - 1;
      continue;
    }

    if (time >= cue.endTime) {
      low = mid + 1;
      continue;
    }

    return cue;
  }

  return undefined;
}
