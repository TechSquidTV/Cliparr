import { ArrowLeft, Download, FileText } from "lucide-react";
import { type RefObject, useState } from "react";

import { EditorExportSourceControl } from "#/components/editor/EditorExportSourceControl";
import { EditorExportSummaryPanel } from "#/components/editor/EditorExportSummaryPanel";
import { EditorFilenameTemplateSection } from "#/components/editor/EditorFilenameTemplateSection";
import type { MediaDimensions } from "#/components/editor/editorMedia";
import { formatTime } from "#/components/editor/editorUtilities";
import { ExportSettingsSection } from "#/components/export/ExportSettingsSection";
import { ExportStatusPanel } from "#/components/export/ExportStatusPanel";
import { BouncyAccordion } from "#/components/ui/bouncy-accordion";
import {
  buttonClassName,
  dialogFooterClasses,
  primaryAlertClasses,
} from "#/components/ui/control-styles";
import { DialogWindow } from "#/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "#/components/ui/drawer";
import type {
  audioBitDepthSummary,
  ExportAudioPlan,
} from "#/lib/export/exportAudio";
import type {
  ExportFormat,
  ExportPhase,
  ExportResolution,
} from "#/lib/export/exportClip";
import {
  type ExportFileNameTemplateKind,
  type ExportFileNameTemplateSettings,
} from "#/lib/export/exportFileName";
import type { ExportMode, ExportOutputType } from "#/lib/export/exportFormats";
import {
  type ExportQualityPreset,
  type ExportSizeEstimate,
  type ExportSourcePreference,
  type GifExportSettings,
} from "#/lib/export/exportTypes";

interface EditorExportDialogProperties {
  isOpen: boolean;
  mobile: boolean;
  leaveConfirmationOpen: boolean;
  finalFocus?: RefObject<HTMLButtonElement | null>;
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
  hasActiveCrop: boolean;
  onResolutionChange: (resolution: ExportResolution) => void;
  selectedSourcePreference: ExportSourcePreference;
  onSourcePreferenceChange: (preference: ExportSourcePreference) => void;
  mode: ExportMode;
  onOutputTypeChange: (outputType: ExportOutputType) => void;
  onVideoMutedChange: (muted: boolean) => void;
  mixDownToStereo: boolean;
  onMixDownToStereoChange: (mixdown: boolean) => void;
  audioPending: boolean;
  audioStatus: string;
  audioPlan: ExportAudioPlan | null;
  sourceAudioChannels: number | null;
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
  mobile,
  leaveConfirmationOpen,
  finalFocus,
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
  hasActiveCrop,
  onResolutionChange,
  selectedSourcePreference,
  onSourcePreferenceChange,
  mode,
  onOutputTypeChange,
  onVideoMutedChange,
  mixDownToStereo,
  onMixDownToStereoChange,
  audioPending,
  audioStatus,
  audioPlan,
  sourceAudioChannels,
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
  const [showDrawer, setShowDrawer] = useState(mobile);
  // Mounting a new drawer or dialog would take focus from the leave confirmation.
  if (!leaveConfirmationOpen && showDrawer !== mobile) {
    setShowDrawer(mobile);
  }

  const summary = (
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
      audioPending={audioPending}
      audioStatus={audioStatus}
      audioPlan={audioPlan}
      subtitleSummaryLabel={subtitleSummaryLabel}
      subtitleSummaryDetail={subtitleSummaryDetail}
      subtitleSummaryTone={subtitleSummaryTone}
      activeTemplateKind={activeTemplateKind}
      fileNamePreview={fileNamePreview}
    />
  );
  const content = (
    <>
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto overscroll-contain p-3 lg:grid-cols-editor-export lg:content-normal lg:p-4">
        <div className="space-y-4">
          {exportSourceMessage && (
            <div className={primaryAlertClasses}>{exportSourceMessage}</div>
          )}

          <fieldset
            disabled={exporting}
            inert={exporting}
            className="min-w-0 space-y-4 disabled:opacity-60"
          >
            <ExportSettingsSection
              selectedFormat={selectedFormat}
              onFormatChange={onFormatChange}
              selectedQuality={selectedQuality}
              onQualityChange={onQualityChange}
              outputDimensions={outputDimensions}
              selectedResolution={selectedResolution}
              hasActiveCrop={hasActiveCrop}
              onResolutionChange={onResolutionChange}
              mode={mode}
              onOutputTypeChange={onOutputTypeChange}
              onVideoMutedChange={onVideoMutedChange}
              mixDownToStereo={mixDownToStereo}
              onMixDownToStereoChange={onMixDownToStereoChange}
              audioStatus={audioStatus}
              sourceAudioChannels={sourceAudioChannels}
              audioBitDepth={audioBitDepth}
            >
              {hasHlsSource && hasDirectSource && (
                <EditorExportSourceControl
                  selectedSourcePreference={selectedSourcePreference}
                  onSourcePreferenceChange={onSourcePreferenceChange}
                  hasHlsSource={hasHlsSource}
                  hasDirectSource={hasDirectSource}
                  directSourceLabel={directSourceLabel}
                  hlsSourceLabel={hlsSourceLabel}
                />
              )}
            </ExportSettingsSection>

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

        {showDrawer ? (
          <details className="rounded-md border border-border">
            <summary className="control-focus cursor-pointer px-3 py-3 text-sm font-medium">
              Export details
            </summary>
            {summary}
          </details>
        ) : (
          summary
        )}
      </div>

      <footer className={`editor-export-footer ${dialogFooterClasses}`}>
        <ExportStatusPanel
          estimate={outputSizeEstimate}
          exporting={exporting}
          phase={exportPhase}
          progress={progress}
          notice={exportNotice}
          error={error}
          disabledReason={exportDisabledReason}
        />

        {exporting ? (
          <button
            type="button"
            onClick={onCancelExport}
            className={buttonClassName({
              tone: "secondary",
              className: "h-12 lg:h-8",
            })}
          >
            Cancel export
          </button>
        ) : (
          <button
            type="button"
            onClick={onExport}
            disabled={Boolean(exportDisabledReason)}
            className={buttonClassName({
              className: "h-12 lg:h-8 lg:min-w-36",
            })}
          >
            <Download className="size-4" /> Export{" "}
            {selectedFormat.toUpperCase()}
          </button>
        )}
      </footer>
    </>
  );

  if (showDrawer) {
    return (
      <Drawer
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
      >
        <DrawerContent
          fullScreen
          finalFocus={finalFocus}
          className="[&_[data-slot=select-trigger]]:min-h-11 [&_input]:min-h-11 [&_input]:text-base"
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
            <DrawerClose
              aria-label="Back to editor"
              className={buttonClassName({
                tone: "icon",
                className: "size-11 shrink-0 p-0",
              })}
            >
              <ArrowLeft className="size-5" />
            </DrawerClose>
            <div className="min-w-0">
              <DrawerTitle>Export clip</DrawerTitle>
              <DrawerDescription className="truncate">
                {formatTime(Math.max(0, clipEnd - clipStart))} · {title}
              </DrawerDescription>
            </div>
          </header>
          {content}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <DialogWindow
      open={isOpen}
      onClose={onClose}
      finalFocus={finalFocus}
      closeLabel="Close export dialog"
      title="Export Clip"
      description="Review settings before download."
      popupClassName="h-[min(48rem,100%)] max-w-4xl"
      headerClassName="shrink-0 bg-card"
    >
      {content}
    </DialogWindow>
  );
}
