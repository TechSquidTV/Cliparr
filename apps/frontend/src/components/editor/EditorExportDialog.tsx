import type { audioBitDepthSummary } from "#/lib/exportAudio";
import type { ExportMode, ExportOutputType } from "#/lib/exportFormats";
import { Download, FileText } from "lucide-react";
import { BouncyAccordion } from "@/components/ui/bouncy-accordion";
import type {
  ExportFormat,
  ExportResolution,
  ExportPhase,
} from "@/lib/exportClip";
import {
  type ExportQualityPreset,
  type ExportSizeEstimate,
  type GifExportSettings,
} from "@/lib/exportTypes";
import {
  type ExportFileNameTemplateKind,
  type ExportFileNameTemplateSettings,
} from "@/lib/exportFileName";
import {
  DialogClose,
  DialogFooter,
  DialogWindow,
} from "@/components/ui/dialog";
import {
  compactPrimaryButtonClasses,
  compactSecondaryButtonClasses,
  primaryAlertClasses,
} from "@/components/ui/control-styles";
import {
  ExportStatusPanel,
  EditorExportSettingsSection,
  EditorExportSummaryPanel,
  EditorFilenameTemplateSection,
} from "@/components/editor/EditorExportDialogSections";
import type { MediaDimensions } from "@/lib/editorMedia";

export type ExportSourcePreference = "auto" | "direct" | "hls";

interface EditorExportDialogProperties {
  isOpen: boolean;
  title: string;
  clipStart: number;
  clipEnd: number;
  selectedFormat: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  selectedQuality: ExportQualityPreset;
  onQualityChange: (quality: ExportQualityPreset) => void;
  gifSettings?: GifExportSettings | null;
  outputSizeEstimate: ExportSizeEstimate;
  selectedResolution: ExportResolution;
  onResolutionChange: (resolution: ExportResolution) => void;
  selectedSourcePreference: ExportSourcePreference;
  onSourcePreferenceChange: (preference: ExportSourcePreference) => void;
  mode: ExportMode;
  onOutputTypeChange: (outputType: ExportOutputType) => void;
  onVideoMutedChange: (muted: boolean) => void;
  mixDownToStereo: boolean;
  onMixDownToStereoChange: (mixdown: boolean) => void;
  audioSummary: string;
  audioDisabledReason?: string | null;
  audioBitDepth: ReturnType<typeof audioBitDepthSummary>;
  exporting: boolean;
  progress: number;
  exportPhase: ExportPhase;
  exportNotice: string | null;
  onCancelExport: () => void;
  error: string | null;
  fileNamePreview: string;
  outputDimensions: MediaDimensions | null;
  hasHlsSource: boolean;
  hasDirectSource: boolean;
  directSourceLabel: string;
  hlsSourceLabel: string;
  exportSourceLabel: string;
  exportSourceMessage: string | null;
  exportSourceSummaryMessage: string | null;
  subtitleSummaryLabel: string;
  subtitleSummaryDetail: string;
  subtitleSummaryTone: "muted" | "ready" | "warning";
  exportDisabledReason?: string | null;
  activeTemplateKind: ExportFileNameTemplateKind;
  editingTemplateKind: ExportFileNameTemplateKind;
  onEditingTemplateKindChange: (kind: ExportFileNameTemplateKind) => void;
  fileNameTemplates: ExportFileNameTemplateSettings;
  onFileNameTemplateChange: (
    kind: ExportFileNameTemplateKind,
    template: string,
  ) => void;
  onResetFileNameTemplate: (kind: ExportFileNameTemplateKind) => void;
  onClose: () => void;
  onExport: () => void;
}

export function EditorExportDialog({
  isOpen,
  title,
  clipStart,
  clipEnd,
  selectedFormat,
  onFormatChange,
  selectedQuality,
  onQualityChange,
  gifSettings,
  outputSizeEstimate,
  selectedResolution,
  onResolutionChange,
  selectedSourcePreference,
  onSourcePreferenceChange,
  mode,
  onOutputTypeChange,
  onVideoMutedChange,
  mixDownToStereo,
  onMixDownToStereoChange,
  audioSummary,
  audioDisabledReason,
  audioBitDepth,
  exporting,
  progress,
  exportPhase,
  exportNotice,
  onCancelExport,
  error,
  fileNamePreview,
  outputDimensions,
  hasHlsSource,
  hasDirectSource,
  directSourceLabel,
  hlsSourceLabel,
  exportSourceLabel,
  exportSourceMessage,
  exportSourceSummaryMessage,
  subtitleSummaryLabel,
  subtitleSummaryDetail,
  subtitleSummaryTone,
  exportDisabledReason,
  activeTemplateKind,
  editingTemplateKind,
  onEditingTemplateKindChange,
  fileNameTemplates,
  onFileNameTemplateChange,
  onResetFileNameTemplate,
  onClose,
  onExport,
}: EditorExportDialogProperties) {
  return (
    <DialogWindow
      open={isOpen}
      onClose={onClose}
      closeDisabled={exporting}
      closeLabel="Close export dialog"
      title="Export Clip"
      description="Review settings before download."
      popupClassName="h-[min(48rem,100%)] max-w-4xl"
      headerClassName="shrink-0 bg-card"
    >
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-editor-export">
        <div className="space-y-4">
          {exportSourceMessage && (
            <div className={primaryAlertClasses}>{exportSourceMessage}</div>
          )}

          <fieldset
            disabled={exporting}
            inert={exporting}
            className="min-w-0 space-y-4 disabled:opacity-60"
          >
            <EditorExportSettingsSection
              selectedFormat={selectedFormat}
              onFormatChange={onFormatChange}
              selectedQuality={selectedQuality}
              onQualityChange={onQualityChange}
              outputDimensions={outputDimensions}
              selectedResolution={selectedResolution}
              onResolutionChange={onResolutionChange}
              selectedSourcePreference={selectedSourcePreference}
              onSourcePreferenceChange={onSourcePreferenceChange}
              mode={mode}
              onOutputTypeChange={onOutputTypeChange}
              onVideoMutedChange={onVideoMutedChange}
              mixDownToStereo={mixDownToStereo}
              onMixDownToStereoChange={onMixDownToStereoChange}
              audioDisabledReason={audioDisabledReason}
              audioBitDepth={audioBitDepth}
              showSourcePreference={hasHlsSource && hasDirectSource}
              hasHlsSource={hasHlsSource}
              hasDirectSource={hasDirectSource}
              directSourceLabel={directSourceLabel}
              hlsSourceLabel={hlsSourceLabel}
            />

            <BouncyAccordion
              items={[
                {
                  id: "filename-settings",
                  title: "Advanced filename settings",
                  icon: <FileText className="h-4 w-4" />,
                  description: (
                    <EditorFilenameTemplateSection
                      editingTemplateKind={editingTemplateKind}
                      onEditingTemplateKindChange={onEditingTemplateKindChange}
                      fileNameTemplates={fileNameTemplates}
                      onFileNameTemplateChange={onFileNameTemplateChange}
                      onResetFileNameTemplate={onResetFileNameTemplate}
                    />
                  ),
                },
              ]}
            />
          </fieldset>
        </div>

        <EditorExportSummaryPanel
          title={title}
          clipStart={clipStart}
          clipEnd={clipEnd}
          selectedFormat={selectedFormat}
          selectedQuality={selectedQuality}
          gifSettings={gifSettings}
          outputDimensions={outputDimensions}
          exportSourceLabel={exportSourceLabel}
          exportSourceSummaryMessage={exportSourceSummaryMessage}
          mode={mode}
          audioSummary={audioSummary}
          subtitleSummaryLabel={subtitleSummaryLabel}
          subtitleSummaryDetail={subtitleSummaryDetail}
          subtitleSummaryTone={subtitleSummaryTone}
          activeTemplateKind={activeTemplateKind}
          fileNamePreview={fileNamePreview}
        />
      </div>

      <DialogFooter className="shrink-0 flex-col gap-3 border-t border-border bg-card px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
        <ExportStatusPanel
          estimate={outputSizeEstimate}
          exporting={exporting}
          phase={exportPhase}
          progress={progress}
          notice={exportNotice}
          error={error}
          disabledReason={exportDisabledReason}
        />

        <div className="flex min-w-0 items-center justify-end gap-2 sm:shrink-0">
          {exporting ? (
            <button
              type="button"
              onClick={onCancelExport}
              className={`${compactSecondaryButtonClasses} w-20 min-w-16 whitespace-nowrap`}
              aria-label="Cancel export"
            >
              Cancel
            </button>
          ) : (
            <DialogClose
              className={`${compactSecondaryButtonClasses} w-20 min-w-16 whitespace-nowrap`}
            >
              Close
            </DialogClose>
          )}

          <button
            type="button"
            onClick={onExport}
            disabled={exporting || Boolean(exportDisabledReason)}
            className={`${compactPrimaryButtonClasses} w-44 shrink-0 whitespace-nowrap`}
          >
            {exporting ? (
              <>
                <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                <span>Exporting</span>
                <span className="inline-block w-[4ch] text-right font-mono tabular-nums">
                  {Math.round(progress * 100)}%
                </span>
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Export {selectedFormat.toUpperCase()}
              </>
            )}
          </button>
        </div>
      </DialogFooter>
    </DialogWindow>
  );
}
