import { ArrowLeft, Download } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EditorHeaderProps {
  title: string;
  onBack: () => void;
  exporting: boolean;
  progress: number;
  exportDisabledReason?: string | null;
  onExportClick: () => void;
}

export function EditorHeader({
  title,
  onBack,
  exporting,
  progress,
  exportDisabledReason,
  onExportClick,
}: EditorHeaderProps) {
  const exportDisabled = exporting || Boolean(exportDisabledReason);
  const exportTooltip =
    exportDisabledReason ?? (exporting ? "Export in progress." : null);
  const exportButton = (
    <button
      type="button"
      onClick={onExportClick}
      disabled={exportDisabled}
      className="flex h-8 min-w-36 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-primary bg-primary px-3 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-primary-foreground transition-[background-color,border-color,color,opacity] duration-150 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {exporting ? (
        <span className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
          Exporting {Math.round(progress * 100)}%
        </span>
      ) : (
        <>
          <Download className="h-3.5 w-3.5" />
          Export
        </>
      )}
    </button>
  );

  return (
    <header className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-editor-border bg-editor-panel px-3 py-2">
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border border-editor-border bg-editor-control text-muted-foreground transition-colors hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Back</TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-2 pl-1">
          <img src="/logo-light.svg" alt="Cliparr Logo" className="h-5 w-5" />
          <span className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground">
            Edit
          </span>
        </div>
      </div>
      <div className="min-w-0 text-center text-sm font-medium text-foreground">
        <div className="truncate">{title}</div>
      </div>
      <div className="flex items-center justify-self-end">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex" tabIndex={exportDisabled ? 0 : -1}>
              {exportButton}
            </span>
          </TooltipTrigger>
          {exportTooltip ? (
            <TooltipContent side="bottom" align="end">
              {exportTooltip}
            </TooltipContent>
          ) : null}
        </Tooltip>
      </div>
    </header>
  );
}
