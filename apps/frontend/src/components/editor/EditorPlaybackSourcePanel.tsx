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
  const sourceNote = !hasHlsSource
    ? "This session did not expose an HLS stream, so Cliparr is using the direct media path."
    : fallbackMessage;

  return (
    <section className={cn("flex min-h-0 flex-col gap-3 p-3", className)}>
      <div className="overflow-hidden rounded-md border border-sidebar-border bg-card">
        <div className="border-b border-sidebar-border px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
            Preview Source
          </div>
        </div>

        <div className="p-3">
          <div className="text-sm font-medium text-sidebar-foreground">
            {displaySourceLabel(previewSourceLabel)}
          </div>

          {sourceNote && (
            <p className="mt-3 border-t border-sidebar-border pt-3 text-xs leading-5 text-muted-foreground">
              {sourceNote}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
