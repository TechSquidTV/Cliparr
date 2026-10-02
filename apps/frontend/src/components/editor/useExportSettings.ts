import { useCallback, useMemo, useReducer } from "react";
import {
  isAudioExportFormat,
  type AudioExportFormat,
  type ExportFormat,
  type ExportMode,
  type ExportOutputType,
  type VideoExportFormat,
} from "#/lib/exportFormats";
import {
  DEFAULT_GIF_EXPORT_PRESET,
  DEFAULT_VIDEO_EXPORT_QUALITY,
  gifExportSettingsForPreset,
  type ExportQualityPreset,
  type ExportResolution,
  type GifExportPreset,
  type VideoExportQualityPreset,
} from "#/lib/exportTypes";

interface ExportSelection {
  outputType: ExportOutputType;
  videoMuted: boolean;
  video: VideoExportFormat;
  audio: AudioExportFormat;
  videoResolution: ExportResolution;
  videoQuality: VideoExportQualityPreset;
  gifPreset: GifExportPreset;
  mixDownToStereo: boolean;
}
type SelectionAction =
  | { outputType: ExportOutputType }
  | { videoMuted: boolean }
  | { format: ExportFormat }
  | { resolution: ExportResolution }
  | { quality: ExportQualityPreset }
  | { mixDownToStereo: boolean };

export function reduceExportSelection(
  state: ExportSelection,
  action: SelectionAction,
): ExportSelection {
  if ("outputType" in action) {
    return { ...state, outputType: action.outputType };
  }
  if ("videoMuted" in action) {
    return { ...state, videoMuted: action.videoMuted };
  }
  if ("mixDownToStereo" in action) {
    return { ...state, mixDownToStereo: action.mixDownToStereo };
  }
  if ("resolution" in action) {
    return state.outputType === "video"
      ? { ...state, videoResolution: action.resolution }
      : state;
  }
  if ("quality" in action) {
    if (state.outputType === "gif") {
      return { ...state, gifPreset: action.quality };
    }
    return state.outputType === "video" && action.quality !== "efficient"
      ? { ...state, videoQuality: action.quality }
      : state;
  }
  if (action.format === "gif") {
    return { ...state, outputType: "gif" };
  }
  if (isAudioExportFormat(action.format)) {
    return { ...state, outputType: "audio", audio: action.format };
  }
  return { ...state, outputType: "video", video: action.format };
}

export function useExportSettings(onChange: () => void) {
  const [selection, dispatch] = useReducer(reduceExportSelection, {
    outputType: "video",
    videoMuted: false,
    video: "mp4",
    audio: "mp3",
    videoResolution: "original",
    videoQuality: DEFAULT_VIDEO_EXPORT_QUALITY,
    gifPreset: DEFAULT_GIF_EXPORT_PRESET,
    mixDownToStereo: true,
  });
  const updateSelection = useCallback(
    (action: SelectionAction) => {
      dispatch(action);
      onChange();
    },
    [onChange],
  );
  const setOutputType = useCallback(
    (outputType: ExportOutputType) => updateSelection({ outputType }),
    [updateSelection],
  );
  const setVideoMuted = useCallback(
    (videoMuted: boolean) => updateSelection({ videoMuted }),
    [updateSelection],
  );
  const setFormat = useCallback(
    (format: ExportFormat) => updateSelection({ format }),
    [updateSelection],
  );
  const setResolution = useCallback(
    (resolution: ExportResolution) => updateSelection({ resolution }),
    [updateSelection],
  );
  const setQuality = useCallback(
    (quality: ExportQualityPreset) => updateSelection({ quality }),
    [updateSelection],
  );
  const setMixDownToStereo = useCallback(
    (mixDownToStereo: boolean) => updateSelection({ mixDownToStereo }),
    [updateSelection],
  );
  const gifSettings = useMemo(
    () => gifExportSettingsForPreset(selection.gifPreset),
    [selection.gifPreset],
  );
  let mode: ExportMode = "video-audio";
  if (selection.outputType === "audio") {
    mode = "audio-only";
  } else if (selection.videoMuted || selection.outputType === "gif") {
    mode = "video-only";
  }
  const format: ExportFormat =
    selection.outputType === "gif" ? "gif" : selection[selection.outputType];
  const resolution: ExportResolution =
    selection.outputType === "video" ? selection.videoResolution : "original";
  return {
    mode,
    format,
    resolution,
    videoQuality: selection.videoQuality,
    gifSettings,
    selectedQuality:
      selection.outputType === "gif"
        ? selection.gifPreset
        : selection.videoQuality,
    setQuality,
    setResolution,
    setOutputType,
    setVideoMuted,
    setFormat,
    mixDownToStereo: selection.mixDownToStereo,
    setMixDownToStereo,
  };
}
