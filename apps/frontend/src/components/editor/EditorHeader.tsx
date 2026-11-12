import { ArrowLeft, Download } from "lucide-react";
import type { Ref } from "react";

import { editorIconButtonClassName } from "@/components/ui/control-styles";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EditorHeaderProperties {
  title: string;
  onBack: () => void;
  exporting: boolean;
  progress: number;
  exportDisabledReason?: string | null;
  exportButtonRef?: Ref<HTMLButtonElement>;
  onExportClick: () => void;
}

export function EditorHeader({
  title,
  onBack,
  exporting,
  progress,
  exportDisabledReason,
  exportButtonRef,
  onExportClick,
}: EditorHeaderProperties) {
  const exportDisabled = exporting || Boolean(exportDisabledReason);
  const exportTooltip =
    exportDisabledReason ?? (exporting ? "Export in progress." : null);
  const exportButton = (
    <button
      type="button"
      ref={exportButtonRef}
      data-editor-export
      onClick={exportDisabled ? undefined : onExportClick}
      aria-disabled={exportDisabled}
      className="flex h-11 shrink-0 items-center justify-center gap-2 border border-primary bg-primary px-3 text-xs font-semibold text-primary-foreground transition-[background-color,border-color,color,opacity] duration-150 hover:bg-primary/90 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 lg:h-8 lg:w-40 lg:rounded-[var(--radius-control)] lg:uppercase lg:tracking-[var(--tracking-caps-sm)]"
    >
      {exporting ? (
        <span className="flex items-center gap-2">
          <Spinner />
          <span>Exporting</span>
          <span className="inline-block w-[4ch] text-right font-mono tabular-nums">
            {Math.round(progress * 100)}%
          </span>
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
    <header className="grid shrink-0 grid-cols-editor-header items-center gap-2 border-b border-editor-border bg-editor-panel py-1 pl-2 lg:gap-3 lg:px-3 lg:py-2">
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onBack}
                aria-label="Back"
                className={editorIconButtonClassName({
                  variant: "ghost",
                  className: "h-11 w-11 lg:h-8 lg:w-8",
                })}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            }
          />
          <TooltipContent side="bottom">Back</TooltipContent>
        </Tooltip>
        <div className="hidden items-center gap-2 pl-1 lg:flex">
          <img
            src="/logo-light.svg"
            alt="Cliparr Logo"
            className="h-5 w-5"
            width="20"
            height="20"
            decoding="async"
          />
          <span className="text-ui-label font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground">
            Edit
          </span>
        </div>
      </div>
      <div className="min-w-0 text-center text-sm font-medium text-foreground">
        <div className="truncate">{title}</div>
      </div>
      <div className="flex items-center justify-self-end">
        <Tooltip>
          <TooltipTrigger render={exportButton} />
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
