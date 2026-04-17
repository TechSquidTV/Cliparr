import { ArrowLeft, Download } from "lucide-react";

interface EditorHeaderProps {
  title: string;
  onBack: () => void;
  resolution: "original" | "1080" | "720";
  setResolution: (res: "original" | "1080" | "720") => void;
  exporting: boolean;
  progress: number;
  handleExport: () => void;
}

export function EditorHeader({
  title,
  onBack,
  resolution,
  setResolution,
  exporting,
  progress,
  handleExport,
}: EditorHeaderProps) {
  return (
    <header className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        <button
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
      <div className="flex items-center justify-self-end gap-2">
        <select
          value={resolution}
          onChange={(event) => setResolution(event.target.value as "original" | "1080" | "720")}
          className="h-8 rounded-[2px] border border-border bg-background px-2.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
          disabled={exporting}
        >
          <option value="original">Original Quality</option>
          <option value="1080">1080p</option>
          <option value="720">720p</option>
        </select>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex h-8 min-w-28 items-center justify-center gap-2 rounded-[2px] border border-primary bg-primary px-3 text-xs font-semibold uppercase tracking-[0.12em] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? (
            <span className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              {Math.round(progress * 100)}%
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
