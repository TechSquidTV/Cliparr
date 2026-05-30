import { Download } from "lucide-react";
import type { ExportFormat, ExportResolution } from "../../lib/exportClip";
import {
  type ExportFileNameTemplateKind,
  type ExportFileNameTemplateSettings,
} from "../../lib/exportFileName";
import {
  DialogClose,
  DialogFooter,
  DialogWindow,
} from "@/components/ui/dialog";
import {
  EditorExportSettingsSection,
  EditorExportSummaryPanel,
  EditorFilenameTemplateSection,
  formatOptionFor,
} from "./EditorExportDialogSections";

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
          {error && (
            <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {exportSourceMessage && (
            <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-foreground">
              {exportSourceMessage}
            </div>
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
          className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </DialogClose>

        <button
          type="button"
          onClick={onExport}
          disabled={exporting || Boolean(exportDisabledReason)}
          className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-3 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {exporting ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              Exporting {Math.round(progress * 100)}%
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
