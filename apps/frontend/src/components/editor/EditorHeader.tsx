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
    <header className="flex items-center justify-between p-6 border-b border-border bg-card/50">
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold truncate max-w-md">{title}</h1>
          <p className="text-sm text-muted-foreground">Edit Clip</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <select
          value={resolution}
          onChange={(event) => setResolution(event.target.value as "original" | "1080" | "720")}
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
          disabled={exporting}
        >
          <option value="original">Original Quality</option>
          <option value="1080">1080p</option>
          <option value="720">720p</option>
        </select>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex w-42 items-center justify-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground px-4 py-2 rounded-lg font-medium transition-colors"
        >
          {exporting ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              {Math.round(progress * 100)}%
            </span>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Export MP4
            </>
          )}
        </button>
      </div>
    </header>
  );
}
