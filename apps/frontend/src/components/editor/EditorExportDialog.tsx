import { Download } from "lucide-react";
import type { ExportFormat, ExportResolution } from "@/lib/exportClip";
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
  destructiveAlertClasses,
  primaryAlertClasses,
} from "@/components/ui/control-styles";
import {
  EditorExportSettingsSection,
  EditorExportSummaryPanel,
  EditorFilenameTemplateSection,
  formatOptionFor,
} from "@/components/editor/EditorExportDialogSections";

interface VideoDimensions {
  width: number;
  height: number;
}

export type ExportSourcePreference = "auto" | "direct" | "hls";

interface EditorExportDialogProps {
  isOpen: boolean;
  title: string;
  clipStart: number;
  clipEnd: number;
  selectedFormat: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  selectedResolution: ExportResolution;
  onResolutionChange: (resolution: ExportResolution) => void;
  selectedSourcePreference: ExportSourcePreference;
  onSourcePreferenceChange: (preference: ExportSourcePreference) => void;
  includeAudio: boolean;
  onIncludeAudioChange: (includeAudio: boolean) => void;
  exporting: boolean;
  progress: number;
  error: string | null;
  fileNamePreview: string;
  outputDimensions: VideoDimensions | null;
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
  selectedResolution,
  onResolutionChange,
  selectedSourcePreference,
  onSourcePreferenceChange,
  includeAudio,
  onIncludeAudioChange,
  exporting,
  progress,
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
}: EditorExportDialogProps) {
  const selectedFormatOption = formatOptionFor(selectedFormat);

  return (
    <DialogWindow
      open={isOpen}
      onClose={onClose}
      closeDisabled={exporting}
      closeLabel="Close export dialog"
      title="Export Clip"
      description="Review settings before download."
      popupClassName="max-w-4xl"
      headerClassName="bg-card"
    >
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-editor-export">
        <div className="space-y-4">
          {error && <div className={destructiveAlertClasses}>{error}</div>}

          {exportSourceMessage && (
            <div className={primaryAlertClasses}>{exportSourceMessage}</div>
          )}

          <EditorExportSettingsSection
            selectedFormat={selectedFormat}
            onFormatChange={onFormatChange}
            selectedResolution={selectedResolution}
            onResolutionChange={onResolutionChange}
            selectedSourcePreference={selectedSourcePreference}
            onSourcePreferenceChange={onSourcePreferenceChange}
            includeAudio={includeAudio}
            onIncludeAudioChange={onIncludeAudioChange}
            hasHlsSource={hasHlsSource}
            hasDirectSource={hasDirectSource}
            directSourceLabel={directSourceLabel}
            hlsSourceLabel={hlsSourceLabel}
          />

          <EditorFilenameTemplateSection
            editingTemplateKind={editingTemplateKind}
            onEditingTemplateKindChange={onEditingTemplateKindChange}
            fileNameTemplates={fileNameTemplates}
            onFileNameTemplateChange={onFileNameTemplateChange}
            onResetFileNameTemplate={onResetFileNameTemplate}
          />
        </div>

        <EditorExportSummaryPanel
          title={title}
          clipStart={clipStart}
          clipEnd={clipEnd}
          selectedFormat={selectedFormat}
          outputDimensions={outputDimensions}
          exportSourceLabel={exportSourceLabel}
          exportSourceSummaryMessage={exportSourceSummaryMessage}
          includeAudio={includeAudio}
          subtitleSummaryLabel={subtitleSummaryLabel}
          subtitleSummaryDetail={subtitleSummaryDetail}
          subtitleSummaryTone={subtitleSummaryTone}
          activeTemplateKind={activeTemplateKind}
          fileNamePreview={fileNamePreview}
        />
      </div>

      <DialogFooter className="border-t border-border bg-card px-4 py-3">
        {exportDisabledReason && (
          <div className="mr-auto text-xs text-muted-foreground">
            {exportDisabledReason}
          </div>
        )}

        <DialogClose
          disabled={exporting}
          className={compactSecondaryButtonClasses}
        >
          Cancel
        </DialogClose>

        <button
          type="button"
          onClick={onExport}
          disabled={exporting || Boolean(exportDisabledReason)}
          className={`${compactPrimaryButtonClasses} w-44`}
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
              Export {selectedFormatOption.label}
            </>
          )}
        </button>
      </DialogFooter>
    </DialogWindow>
  );
}
