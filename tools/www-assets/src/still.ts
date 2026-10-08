import type { AssetCaptureState } from "@cliparr/shared/asset-capture";

export function stillFrameReady(state: AssetCaptureState, seconds: number) {
  return (
    !state.error &&
    !state.playing &&
    state.previewReady &&
    state.subtitlesReady &&
    state.activeSubtitleCueCount > 0 &&
    state.renderedSeconds !== null &&
    Math.abs(state.renderedSeconds - seconds) <= state.frameStepSeconds * 1.5 &&
    Math.abs(state.currentSeconds - seconds) <= state.frameStepSeconds * 1.5
  );
}
