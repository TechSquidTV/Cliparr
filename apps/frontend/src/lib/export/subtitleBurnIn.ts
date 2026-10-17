import type { VideoSample } from "mediabunny";

import { getActiveSubtitleCues } from "#/lib/subtitles/getActiveSubtitleCue";
import { renderSubtitleCues } from "#/lib/subtitles/renderSubtitleCue";
import type { SubtitleCue, SubtitleStyleSettings } from "#/lib/subtitles/types";

export function buildSubtitleBurnInProcessor(
  cues: readonly SubtitleCue[],
  styleSettings: SubtitleStyleSettings,
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a subtitle rendering canvas.");
  }

  return (sample: VideoSample) => {
    const width = Math.max(1, sample.displayWidth);
    const height = Math.max(1, sample.displayHeight);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.clearRect(0, 0, width, height);
    sample.draw(context, 0, 0, width, height);

    const activeCues = getActiveSubtitleCues(cues, sample.timestamp);
    if (activeCues.length > 0) {
      renderSubtitleCues(context, activeCues, styleSettings, width, height);
    }

    return canvas;
  };
}
