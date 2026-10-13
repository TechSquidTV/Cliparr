// Converter functions and types shared with @cliparr/www.
// Keep this dependency graph free of React and CSS; UI exports belong in ./ui.
import type { InputVideoTrack } from "mediabunny";

import type { MediaDimensions } from "../components/editor/editorMedia";
import type { ExportClipOptions } from "../lib/export/exportClip";
import { getVideoTrackDimensions as readVideoTrackDimensions } from "../lib/export/mediabunny/mediabunnyTrackAccess";

export {
  buildLocalEditorSession,
  type EditorFileMediaSource,
  type EditorMediaSource,
  type EditorSession,
  type MediaDimensions,
  titleFromFileName,
} from "../components/editor/editorMedia";
export { downloadBlob } from "../lib/downloadBlob";
export type { ExportAudioPlan } from "../lib/export/exportAudio";
export type {
  ExportClipOptions,
  ExportPhase,
  ExportVideoEncodingPlan,
} from "../lib/export/exportClip";
export {
  calibratedEstimatedVideoBitrateBps,
  EXPORT_AUDIO_BITRATE_BPS,
  EXPORT_ENCODING_POLICY_VERSION,
  EXPORT_ESTIMATE_CONTAINER_OVERHEAD,
  type ExportAudioCodec,
  exportAudioCodecPriorities,
  type ExportVideoCodec,
  exportVideoCodecPriorities,
  formatCanCopyVideoCodec,
  type ResolvedVideoEncodingPlan,
  resolveVideoEncodingPlan,
  type VideoEncodingPlan,
  videoEncodingPlanKey,
  videoTargetBitrateBps,
} from "../lib/export/exportEncodingPolicy";
export {
  type AudioExportFormat,
  exportFormatFor,
  exportFormats,
  exportIncludesAudio,
  type ExportMode,
  isAudioExportFormat,
  type VideoExportFormat,
} from "../lib/export/exportFormats";
export type { ExportFormat, ExportResolution } from "../lib/export/exportTypes";
export type { ExportSourcePreference } from "../lib/export/exportTypes";
export {
  DEFAULT_GIF_EXPORT_PRESET,
  DEFAULT_VIDEO_EXPORT_QUALITY,
  estimateExportOutputSize,
  EXPORT_SIZE_ESTIMATE_ALGORITHM_VERSION,
  exportFormatDurationDisabledReason,
  type ExportOutputDimensions,
  exportQualityDescriptionFor,
  exportQualityOptionFor,
  exportQualityOptions,
  exportQualityOptionsForFormat,
  type ExportQualityPreset,
  type ExportSizeEstimate,
  formatExportByteSize,
  formatExportSizeEstimate,
  type GifExportPreset,
  gifExportPresetOptions,
  type GifExportSettings,
  gifExportSettingsForPreset,
  resolveExportOutputDimensions,
  videoExportQualityOptions,
  type VideoExportQualityPreset,
} from "../lib/export/exportTypes";
export { createCliparrInputFromSource } from "../lib/export/mediabunny/mediabunnyInput";
export {
  assessVideoTrackDecodability,
  getTrackTimelineOffsetSeconds,
  isPlaybackVideoTrack,
  videoTrackPreviewUnavailableMessage,
} from "../lib/export/mediabunny/mediabunnyTrackAccess";
export { selectPreferredPairableAudioTrack } from "../lib/subtitles/selectPreferredAudioTrack";
export type { MediaExportMetadata } from "../providers/types";

export async function exportClip(options: ExportClipOptions) {
  const module = await import("../lib/export/exportClip");

  return module.exportClip(options);
}

export function getVideoTrackDimensions(
  track: InputVideoTrack,
): Promise<MediaDimensions> {
  return readVideoTrackDimensions(track);
}
