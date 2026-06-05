import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utilities";
import { cliparrMotionTransitions } from "@/lib/motionPresets";

interface EditorPlaybackSourcePanelProperties {
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

const SOURCE_NOTE_INITIAL = {
  opacity: 0,
  y: 4,
  filter: "blur(6px)",
};
const SOURCE_NOTE_VISIBLE = {
  opacity: 1,
  y: 0,
  filter: "blur(0px)",
};
const SOURCE_NOTE_EXIT = {
  opacity: 0,
  y: -3,
  filter: "blur(6px)",
};

export function EditorPlaybackSourcePanel({
  previewSourceLabel,
  fallbackMessage,
  hasHlsSource,
  className,
}: EditorPlaybackSourcePanelProperties) {
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion
    ? { duration: 0 }
    : cliparrMotionTransitions.fast;
  const sourceNote =
    fallbackMessage ??
    (!hasHlsSource && previewSourceLabel === "Direct source"
      ? "Direct media only."
      : null);

  return (
    <section className={cn("flex min-h-0 flex-col", className)}>
      <div className="overflow-hidden border border-editor-border bg-editor-panel-raised">
        <div className="border-b border-editor-border bg-editor-panel-muted px-3 py-2">
          <div className="text-ui-micro font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground">
            Preview Source
          </div>
        </div>

        <div className="px-3 py-2.5">
          <div className="text-sm font-medium text-sidebar-foreground">
            {displaySourceLabel(previewSourceLabel)}
          </div>

          <AnimatePresence initial={false}>
            {sourceNote && (
              <motion.p
                key={sourceNote}
                layout={!reduceMotion}
                className="mt-2.5 border-t border-editor-border pt-2.5 text-xs leading-5 text-muted-foreground"
                initial={reduceMotion ? { opacity: 1 } : SOURCE_NOTE_INITIAL}
                animate={SOURCE_NOTE_VISIBLE}
                exit={SOURCE_NOTE_EXIT}
                transition={transition}
              >
                {sourceNote}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
