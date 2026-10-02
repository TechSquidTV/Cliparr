import type { ExportClipOptions } from "./lib/exportClip";
import type { InputVideoTrack } from "mediabunny";
import type { MediaDimensions } from "./lib/editorMedia";
import { getVideoTrackDimensions as readVideoTrackDimensions } from "./lib/mediabunnyTrackAccess";

export {
  DEFAULT_GIF_EXPORT_PRESET,
  DEFAULT_VIDEO_EXPORT_QUALITY,
  EXPORT_SIZE_ESTIMATE_ALGORITHM_VERSION,
  estimateExportOutputSize,
  exportFormatDurationDisabledReason,
  exportQualityDescriptionFor,
  exportQualityOptionFor,
  exportQualityOptions,
  exportQualityOptionsForFormat,
  formatExportByteSize,
  formatExportSizeEstimate,
  gifExportPresetOptions,
  gifExportSettingsForPreset,
  resolveExportOutputDimensions,
  videoExportQualityOptions,
  type ExportOutputDimensions,
  type ExportQualityPreset,
  type ExportSizeEstimate,
  type GifExportPreset,
  type GifExportSettings,
  type VideoExportQualityPreset,
} from "./lib/exportTypes";
export type {
  ExportClipOptions,
  ExportVideoEncodingPlan,
  ExportPhase,
} from "./lib/exportClip";
export type { ExportFormat, ExportResolution } from "./lib/exportTypes";
export {
  calibratedEstimatedVideoBitrateBps,
  exportAudioCodecPriorities,
  exportVideoCodecPriorities,
  formatCanCopyVideoCodec,
  resolveVideoEncodingPlan,
  videoEncodingPlanKey,
  videoTargetBitrateBps,
  EXPORT_AUDIO_BITRATE_BPS,
  EXPORT_ENCODING_POLICY_VERSION,
  EXPORT_ESTIMATE_CONTAINER_OVERHEAD,
  type ExportAudioCodec,
  type ExportVideoCodec,
  type VideoEncodingPlan,
  type ResolvedVideoEncodingPlan,
} from "./lib/exportEncodingPolicy";
export { downloadBlob } from "./lib/downloadBlob";
export {
  buildLocalEditorSession,
  titleFromFileName,
  type EditorFileMediaSource,
  type EditorMediaSource,
  type EditorSession,
  type MediaDimensions,
} from "./lib/editorMedia";
export { createCliparrInputFromSource } from "./lib/mediabunnyInput";
export { selectPreferredPairableAudioTrack } from "./lib/selectPreferredAudioTrack";
export {
  assessVideoTrackDecodability,
  isPlaybackVideoTrack,
  getTrackTimelineOffsetSeconds,
  videoTrackPreviewUnavailableMessage,
} from "./lib/mediabunnyTrackAccess";
export type { MediaExportMetadata } from "./providers/types";
export {
  ExportStatusPanel,
  EditorExportSettingsSection,
  EditorExportSummaryPanel,
} from "./components/editor/EditorExportDialogSections";
export type { ExportSourcePreference } from "./components/editor/EditorExportDialog";
export { TooltipProvider } from "./components/ui/tooltip";
export {
  compactPrimaryButtonClasses,
  destructiveAlertClasses,
  primaryAlertClasses,
} from "./components/ui/control-styles";

export async function exportClip(options: ExportClipOptions) {
  const module = await import("./lib/exportClip");

  return module.exportClip(options);
}

export function getVideoTrackDimensions(
  track: InputVideoTrack,
): Promise<MediaDimensions> {
  return readVideoTrackDimensions(track);
}

export { useExportSettings } from "./components/editor/useExportSettings";
export { useExportAudioPlan } from "./components/editor/useExportAudioPlan";
export {
  exportFormatFor,
  exportFormats,
  exportIncludesAudio,
  isAudioExportFormat,
  type ExportMode,
  type AudioExportFormat,
  type VideoExportFormat,
} from "./lib/exportFormats";
export type { ExportAudioPlan } from "./lib/exportAudio";

export { useExportVideoPlan } from "./components/editor/useExportVideoPlan";
