import { cn } from "@/lib/utils";

interface EditorPlaybackSourcePanelProps {
  previewSourceLabel: string;
  fallbackMessage: string | null;
  hasHlsSource: boolean;
  className?: string;
}

function displaySourceLabel(label: string) {
  if (label === "Direct source") {
    return "Direct media";
  }

  if (!label.trim()) {
    return "Resolving stream";
  }

  return label;
}

export function EditorPlaybackSourcePanel({
  previewSourceLabel,
  fallbackMessage,
  hasHlsSource,
  className,
}: EditorPlaybackSourcePanelProps) {
  const sourceNote =
    fallbackMessage ??
    (!hasHlsSource && previewSourceLabel === "Direct source"
      ? "Direct media only."
      : null);

  return (
    <section className={cn("flex min-h-0 flex-col", className)}>
      <div className="overflow-hidden border border-editor-border bg-editor-panel-raised">
        <div className="border-b border-editor-border bg-editor-panel-muted px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground">
            Preview Source
          </div>
        </div>

        <div className="px-3 py-2.5">
          <div className="text-sm font-medium text-sidebar-foreground">
            {displaySourceLabel(previewSourceLabel)}
          </div>

          {sourceNote && (
            <p className="mt-2.5 border-t border-editor-border pt-2.5 text-xs leading-5 text-muted-foreground">
              {sourceNote}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
