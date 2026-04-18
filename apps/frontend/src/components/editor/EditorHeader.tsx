import { ArrowLeft, Download } from "lucide-react";

interface EditorHeaderProps {
  title: string;
  onBack: () => void;
  exporting: boolean;
  progress: number;
  onExportClick: () => void;
}

export function EditorHeader({
  title,
  onBack,
  exporting,
  progress,
  onExportClick,
}: EditorHeaderProps) {
  return (
    <header className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex h-8 w-8 items-center justify-center rounded-[2px] border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Edit
        </span>
      </div>
      <div className="min-w-0 text-center text-sm font-medium text-foreground">
        <div className="truncate">{title}</div>
      </div>
      <div className="flex items-center justify-self-end">
        <button
          type="button"
          onClick={onExportClick}
          disabled={exporting}
          className="flex h-8 min-w-36 items-center justify-center gap-2 rounded-[2px] border border-primary bg-primary px-3 text-xs font-semibold uppercase tracking-[0.12em] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
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
      </div>
    </header>
  );
}
