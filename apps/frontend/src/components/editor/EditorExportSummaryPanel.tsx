import { memo } from "react";

import { formatTime } from "#/components/editor/editorUtilities";
import {
  ExportDurationSummary,
  ExportOutputSummary,
  type ExportOutputSummaryProperties,
  ExportSummaryItem,
  ExportSummaryPanel,
} from "#/components/export/ExportSummary";
import { type ExportFileNameTemplateKind } from "#/lib/export/exportFileName";
import { isAudioExportFormat } from "#/lib/export/exportFormats";
interface EditorExportSummaryPanelProperties extends ExportOutputSummaryProperties {
  title: string;
  clipStart: number;
  clipEnd: number;
  exportSourceLabel?: string;
  exportSourceSummaryMessage?: string | null;
  subtitleSummaryLabel?: string;
  subtitleSummaryDetail?: string;
  subtitleSummaryTone?: "muted" | "ready" | "warning";
  activeTemplateKind?: ExportFileNameTemplateKind;
  filenameTemplateLabel?: string | null;
  fileNamePreview?: string;
}

function EditorExportSummaryPanelComponent({
  title,
  clipStart,
  clipEnd,
  selectedFormat,
  selectedQuality,
  gifSettings,
  outputDimensions,
  exportSourceLabel = "Auto",
  exportSourceSummaryMessage = null,
  mode,
  audioStatus,
  audioPlan,
  subtitleSummaryLabel = "Not included",
  subtitleSummaryDetail = "No supported subtitles found.",
  subtitleSummaryTone = "muted",
  activeTemplateKind = "movie",
  filenameTemplateLabel,
  fileNamePreview = "",
}: EditorExportSummaryPanelProperties) {
  const clipLength = Math.max(0, clipEnd - clipStart);
  const audioOnly = isAudioExportFormat(selectedFormat);
  let subtitleSummaryClassName = "border-border bg-background";
  if (subtitleSummaryTone === "ready") {
    subtitleSummaryClassName = "border-status-ready-border bg-status-ready";
  } else if (subtitleSummaryTone === "warning") {
    subtitleSummaryClassName = "border-status-warning-border bg-status-warning";
  }
  let displayedFilenameTemplateLabel = filenameTemplateLabel;
  if (filenameTemplateLabel === undefined) {
    displayedFilenameTemplateLabel =
      activeTemplateKind === "episode" ? "TV show template" : "Movie template";
  }

  return (
    <ExportSummaryPanel title={title}>
      <ExportSummaryItem label="Clip">
        <dd className="mt-1 font-mono text-xs text-foreground">
          {formatTime(clipStart)} to {formatTime(clipEnd)}
        </dd>
      </ExportSummaryItem>

      <ExportDurationSummary seconds={clipLength} />

      <ExportSummaryItem label="Source">
        <dd className="mt-1 text-xs text-foreground">{exportSourceLabel}</dd>
        {exportSourceSummaryMessage && (
          <dd className="mt-1 text-ui-label text-muted-foreground">
            {exportSourceSummaryMessage}
          </dd>
        )}
      </ExportSummaryItem>

      <ExportOutputSummary
        selectedFormat={selectedFormat}
        selectedQuality={selectedQuality}
        gifSettings={gifSettings}
        outputDimensions={outputDimensions}
        mode={mode}
        audioStatus={audioStatus}
        audioPlan={audioPlan}
      />
      {!audioOnly && (
        <ExportSummaryItem
          label="Subtitles"
          className={subtitleSummaryClassName}
        >
          <dd className="mt-1 text-xs font-medium text-foreground">
            {subtitleSummaryLabel}
          </dd>
          <dd className="mt-1 text-ui-label text-muted-foreground">
            {subtitleSummaryDetail}
          </dd>
        </ExportSummaryItem>
      )}

      <ExportSummaryItem label="Filename">
        {displayedFilenameTemplateLabel ? (
          <dd className="mt-1 text-ui-label font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground">
            {displayedFilenameTemplateLabel}
          </dd>
        ) : null}
        <dd className="mt-1 break-all font-mono text-ui-label text-foreground">
          {fileNamePreview}
        </dd>
      </ExportSummaryItem>
    </ExportSummaryPanel>
  );
}

export const EditorExportSummaryPanel = memo(EditorExportSummaryPanelComponent);
