import { EditorPropertyRow } from "@/components/editor/EditorPropertyControls";
import { cn } from "@/lib/utilities";

interface EditorPlaybackSourcePanelProperties {
  previewSourceLabel: string;
  fallbackMessage: string | null;
  className?: string;
}

function displaySourceLabel(label: string) {
  switch (label) {
    case "HLS stream":
    case "HLS URL": {
      return "HLS";
    }
    case "Direct source": {
      return "Direct";
    }
    default: {
      return label.trim() || "Resolving stream";
    }
  }
}

export function EditorPlaybackSourcePanel({
  previewSourceLabel,
  fallbackMessage,
  className,
}: EditorPlaybackSourcePanelProperties) {
  return (
    <section className={cn("min-h-0", className)}>
      <EditorPropertyRow label="Source">
        <span className="block text-right text-xs text-muted-foreground">
          {displaySourceLabel(previewSourceLabel)}
        </span>
      </EditorPropertyRow>
      {fallbackMessage && (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {fallbackMessage}
        </p>
      )}
    </section>
  );
}
