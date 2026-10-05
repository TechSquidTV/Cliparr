import { Popover } from "@base-ui/react/popover";
import { Info } from "lucide-react";
import type { EditorLayoutVariant } from "@/components/editor/EditorLayout";
import { compactSecondaryButtonClasses } from "@/components/ui/control-styles";

interface EditorPlaybackSourceControlProperties {
  previewSourceLabel: string;
  fallbackMessage: string | null;
  variant: EditorLayoutVariant;
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

export function EditorPlaybackSourceControl({
  previewSourceLabel,
  fallbackMessage,
  variant,
}: EditorPlaybackSourceControlProperties) {
  const label = displaySourceLabel(previewSourceLabel);
  const details = (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">
        Playback source:{" "}
        <span className="font-medium text-foreground">{label}</span>
      </p>
      {fallbackMessage && (
        <p className="leading-5 text-muted-foreground">{fallbackMessage}</p>
      )}
    </div>
  );

  if (variant === "mobile") {
    return (
      <section
        aria-label="Playback details"
        className="mx-3 mb-3 rounded-md border border-editor-border p-3"
      >
        {details}
      </section>
    );
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        className={compactSecondaryButtonClasses}
        aria-label={`Playback source: ${label}. Show playback details`}
      >
        {label}
        <Info
          aria-hidden="true"
          className="h-3.5 w-3.5 text-muted-foreground"
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-50"
        >
          <Popover.Popup
            aria-label="Playback details"
            className="max-w-80 rounded-md border border-editor-border bg-editor-panel p-3 shadow-lg outline-none"
          >
            {details}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
