import type { ExportClipOptions } from "./lib/exportClip";
import type { ExportFormat } from "./lib/exportTypes";
import { formatOptions } from "./components/editor/editorExportOptions";

export {
  DEFAULT_GIF_EXPORT_PRESET,
  DEFAULT_VIDEO_EXPORT_QUALITY,
  EXPORT_SIZE_ESTIMATE_ALGORITHM_VERSION,
  estimateExportOutputSize,
  exportFormatDurationDisabledReason,
  exportFormatSupportsAudio,
  exportQualityDescriptionFor,
  exportQualityOptionFor,
  exportQualityOptions,
  exportQualityOptionsForFormat,
  formatExportByteSize,
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
export type { ExportClipOptions } from "./lib/exportClip";
export type { ExportFormat, ExportResolution } from "./lib/exportTypes";
export { downloadBlob } from "./lib/downloadBlob";
export {
  buildLocalEditorSession,
  titleFromFileName,
  type EditorFileMediaSource,
  type EditorMediaSource,
  type EditorSession,
} from "./lib/editorMedia";
export { createCliparrInputFromSource } from "./lib/mediabunnyInput";
export {
  assessVideoTrackDecodability,
  getTrackTimelineOffsetSeconds,
  getVideoTrackDimensions,
  videoTrackPreviewUnavailableMessage,
} from "./lib/mediabunnyTrackAccess";
export type { MediaExportMetadata } from "./providers/types";
export {
  EditorExportSettingsSection,
  EditorExportSummaryPanel,
} from "./components/editor/EditorExportDialogSections";
export type { ExportSourcePreference } from "./components/editor/EditorExportDialog";
export {
  formatOptionFor,
  formatOptions,
} from "./components/editor/editorExportOptions";
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

export const convertFormatOptions = formatOptions;

export function exportFormatExtension(format: ExportFormat) {
  return (
    convertFormatOptions.find((option) => option.value === format)?.extension ??
    ".mp4"
  );
}
