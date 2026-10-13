// Converter functions and types shared with @cliparr/www.
// Keep this dependency graph free of React and CSS; UI exports belong in ./ui.
import type { ExportClipOptions } from "../lib/export/exportClip";
import type { InputVideoTrack } from "mediabunny";
import type { MediaDimensions } from "../components/editor/editorMedia";
import { getVideoTrackDimensions as readVideoTrackDimensions } from "../lib/export/mediabunny/mediabunnyTrackAccess";

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
} from "../lib/export/exportTypes";
export type {
  ExportClipOptions,
  ExportVideoEncodingPlan,
  ExportPhase,
} from "../lib/export/exportClip";
export type { ExportFormat, ExportResolution } from "../lib/export/exportTypes";
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
} from "../lib/export/exportEncodingPolicy";
export { downloadBlob } from "../lib/downloadBlob";
export {
  buildLocalEditorSession,
  titleFromFileName,
  type EditorFileMediaSource,
  type EditorMediaSource,
  type EditorSession,
  type MediaDimensions,
} from "../components/editor/editorMedia";
export { createCliparrInputFromSource } from "../lib/export/mediabunny/mediabunnyInput";
export { selectPreferredPairableAudioTrack } from "../lib/subtitles/selectPreferredAudioTrack";
export {
  assessVideoTrackDecodability,
  isPlaybackVideoTrack,
  getTrackTimelineOffsetSeconds,
  videoTrackPreviewUnavailableMessage,
} from "../lib/export/mediabunny/mediabunnyTrackAccess";
export type { MediaExportMetadata } from "../providers/types";
export type { ExportSourcePreference } from "../lib/export/exportTypes";
export {
  exportFormatFor,
  exportFormats,
  exportIncludesAudio,
  isAudioExportFormat,
  type ExportMode,
  type AudioExportFormat,
  type VideoExportFormat,
} from "../lib/export/exportFormats";
export type { ExportAudioPlan } from "../lib/export/exportAudio";

export async function exportClip(options: ExportClipOptions) {
  const module = await import("../lib/export/exportClip");

  return module.exportClip(options);
}

export function getVideoTrackDimensions(
  track: InputVideoTrack,
): Promise<MediaDimensions> {
  return readVideoTrackDimensions(track);
}
