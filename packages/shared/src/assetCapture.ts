/** Browser automation contract, installed only by an explicit capture build. */
export interface AssetCaptureSelection {
  inSeconds: number;
  outSeconds: number;
  subtitleTrackKey?: string;
  subtitleFontSize?: number;
}

export interface AssetCaptureState {
  mediaReady: boolean;
  previewReady: boolean;
  duration: number;
  inSeconds: number;
  outSeconds: number;
  currentSeconds: number;
  renderedSeconds: number | null;
  frameStepSeconds: number;
  playing: boolean;
  subtitlesReady: boolean;
  subtitleCueCount: number;
  activeSubtitleCueCount: number;
  subtitleTracks: { key: string; title: string }[];
  error: string;
}

export interface AssetCaptureController {
  inspect: () => AssetCaptureState;
  configure: (selection: AssetCaptureSelection) => void;
  seek: (seconds: number) => void;
  fitSelection: () => void;
  play: () => Promise<void>;
  pause: () => void;
}

declare global {
  interface Window {
    cliparrAssetCapture?: AssetCaptureController;
  }
}
