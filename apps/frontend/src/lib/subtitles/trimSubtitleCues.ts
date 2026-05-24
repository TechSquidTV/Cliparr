import type { SubtitleCue } from "./types";

export function trimSubtitleCues(
  cues: readonly SubtitleCue[],
  clipStart: number,
  clipEnd: number
) {
  const clipDuration = Math.max(0, clipEnd - clipStart);

  return cues.flatMap<SubtitleCue>((cue) => {
    const startTime = Math.max(0, cue.startTime - clipStart);
    const endTime = Math.min(clipDuration, cue.endTime - clipStart);

    if (endTime <= 0 || startTime >= clipDuration || endTime <= startTime) {
      return [];
    }

    return [{
      ...cue,
      startTime,
      endTime,
      lines: [...cue.lines],
    }];
  });
}
