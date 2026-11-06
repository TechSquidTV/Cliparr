import {
  Captions,
  Crop,
  Scissors,
  SlidersHorizontal,
  Volume2,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useRef } from "react";

import {
  EDITOR_PANEL_SIZES,
  EDITOR_RESIZE_TARGET_MINIMUM_SIZE,
} from "@/components/editor/editorLayoutSizing";
import { EditorSidebar } from "@/components/editor/EditorSidebar";
import { BarsLoader } from "@/components/ui/bars-loader";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/cn";
import { motionTransitionFor } from "@/lib/motion";

export type EditorLayoutVariant = "desktop" | "mobile";

const EDITOR_READY_STATE_INITIAL = {
  opacity: 0,
  y: 4,
  filter: "blur(6px)",
};
const EDITOR_READY_STATE_VISIBLE = {
  opacity: 1,
  y: 0,
  filter: "blur(0px)",
};
const EDITOR_READY_STATE_EXIT = {
  opacity: 0,
  y: -3,
  filter: "blur(6px)",
};

export function EditorPreviewPane({
  error,
  variant,
  children,
  cropEditing = false,
  pictureAspectRatio = 16 / 9,
  status,
}: {
  error: string | null;
  variant: EditorLayoutVariant;
  children: ReactNode;
  cropEditing?: boolean;
  pictureAspectRatio?: number;
  status?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const stateTransition = motionTransitionFor("fast", reduceMotion);
  const previewStage = (
    <section
      data-editor-preview-stage
      className={cn(
        "relative overflow-hidden border border-editor-border bg-editor-monitor",
        variant === "desktop"
          ? "flex min-h-0 flex-1 items-center justify-center p-2"
          : "w-full flex-none",
        variant === "mobile" &&
          !cropEditing &&
          "max-h-[var(--editor-preview-height,46dvh)]",
      )}
      style={
        variant === "mobile" && !cropEditing
          ? { aspectRatio: pictureAspectRatio }
          : undefined
      }
    >
      {variant === "mobile" ? (
        <div
          className={cn(
            "flex min-h-0 items-center justify-center",
            !cropEditing && "absolute inset-2",
          )}
        >
          {children}
        </div>
      ) : (
        children
      )}
      {status}
    </section>
  );

  if (variant === "mobile") {
    return previewStage;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <AnimatePresence initial={false}>
        {error && (
          <motion.div
            key="editor-preview-error"
            layout={!reduceMotion}
            className="shrink-0 border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            initial={reduceMotion ? { opacity: 1 } : EDITOR_READY_STATE_INITIAL}
            animate={EDITOR_READY_STATE_VISIBLE}
            exit={EDITOR_READY_STATE_EXIT}
            transition={stateTransition}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>
      {previewStage}
    </div>
  );
}

export function EditorTimelinePane({
  variant,
  controls,
  hasDuration,
  timeline,
}: {
  variant: EditorLayoutVariant;
  controls: ReactNode;
  hasDuration: boolean;
  timeline: ReactNode;
}) {
  return (
    <section
      className={
        variant === "desktop"
          ? "flex h-full min-h-0 flex-col overflow-hidden border border-editor-border bg-editor-panel text-foreground"
          : "flex h-full min-h-0 flex-col overflow-hidden bg-editor-panel text-foreground"
      }
    >
      {controls}

      <div className={"relative min-h-0 flex-1"} aria-busy={!hasDuration}>
        <div
          className={`isolate h-full ${hasDuration ? "" : "opacity-40"}`}
          inert={!hasDuration}
          data-editor-timeline-ready={hasDuration || undefined}
        >
          {timeline}
        </div>
        {!hasDuration && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-editor-panel/70 px-3 text-center text-sm text-muted-foreground"
            data-editor-waiting-duration
          >
            <BarsLoader label="Loading timeline…" showLabel />
          </div>
        )}
      </div>
    </section>
  );
}

function EditorPropertiesPanel({
  open,
  onOpenChange,
  active,
  resizable = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active: boolean;
  resizable?: boolean;
  children: ReactNode;
}) {
  return (
    <EditorSidebar
      open={open}
      onOpenChange={onOpenChange}
      title="Properties"
      icon={SlidersHorizontal}
      active={active}
      resizable={resizable}
    >
      {children}
    </EditorSidebar>
  );
}

export function EditorDesktopLayout({
  playbackSidebarOpen,
  onPlaybackSidebarOpenChange,
  subtitlesActive,
  previewPane,
  timelinePane,
  propertiesContent,
}: {
  playbackSidebarOpen: boolean;
  onPlaybackSidebarOpenChange: (open: boolean) => void;
  subtitlesActive: boolean;
  previewPane: ReactNode;
  timelinePane: ReactNode;
  propertiesContent: ReactNode;
}) {
  return (
    <ResizablePanelGroup
      id="cliparr-editor-root-panels"
      orientation="horizontal"
      resizeTargetMinimumSize={EDITOR_RESIZE_TARGET_MINIMUM_SIZE}
      className="h-full min-h-0"
    >
      <ResizablePanel
        id="cliparr-editor-primary-panel"
        defaultSize={
          playbackSidebarOpen
            ? EDITOR_PANEL_SIZES.primaryOpen
            : EDITOR_PANEL_SIZES.primaryClosed
        }
        minSize={EDITOR_PANEL_SIZES.primaryMin}
      >
        <ResizablePanelGroup
          id="cliparr-editor-primary-stack"
          orientation="vertical"
          resizeTargetMinimumSize={EDITOR_RESIZE_TARGET_MINIMUM_SIZE}
          className="h-full min-h-0"
        >
          <ResizablePanel
            id="cliparr-editor-preview-panel"
            defaultSize={EDITOR_PANEL_SIZES.previewDefault}
            minSize={EDITOR_PANEL_SIZES.previewMin}
          >
            {previewPane}
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
            id="cliparr-editor-timeline-panel"
            defaultSize={EDITOR_PANEL_SIZES.timelineDefault}
            minSize={EDITOR_PANEL_SIZES.timelineMin}
            maxSize={EDITOR_PANEL_SIZES.timelineMax}
          >
            {timelinePane}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>

      {playbackSidebarOpen ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="cliparr-editor-properties-panel"
            defaultSize={EDITOR_PANEL_SIZES.propertiesDefault}
            minSize={EDITOR_PANEL_SIZES.propertiesMin}
            maxSize={EDITOR_PANEL_SIZES.propertiesMax}
            groupResizeBehavior="preserve-pixel-size"
            style={{ overflow: "hidden" }}
          >
            <EditorPropertiesPanel
              open={playbackSidebarOpen}
              onOpenChange={onPlaybackSidebarOpenChange}
              active={subtitlesActive}
              resizable
            >
              {propertiesContent}
            </EditorPropertiesPanel>
          </ResizablePanel>
        </>
      ) : (
        <ResizablePanel
          id="cliparr-editor-properties-rail"
          defaultSize={EDITOR_PANEL_SIZES.propertiesRail}
          minSize={EDITOR_PANEL_SIZES.propertiesRail}
          maxSize={EDITOR_PANEL_SIZES.propertiesRail}
          disabled
          groupResizeBehavior="preserve-pixel-size"
        >
          <EditorPropertiesPanel
            open={playbackSidebarOpen}
            onOpenChange={onPlaybackSidebarOpenChange}
            active={subtitlesActive}
          >
            <div />
          </EditorPropertiesPanel>
        </ResizablePanel>
      )}
    </ResizablePanelGroup>
  );
}

const mobileTools = {
  trim: { label: "Trim", icon: Scissors },
  subtitles: { label: "Subtitles", icon: Captions },
  crop: { label: "Crop", icon: Crop },
  playback: { label: "Playback", icon: Volume2 },
} as const;
export type EditorTool = keyof typeof mobileTools;

export function EditorMobileLayout({
  error,
  previewPane,
  timelinePane,
  tool,
  onToolChange,
  onDone,
  inspector,
  moreControl,
  cropDisabled,
  cropTransport,
}: {
  error: string | null;
  previewPane: ReactNode;
  timelinePane: ReactNode;
  tool: EditorTool | null;
  onToolChange: (tool: EditorTool) => void;
  onDone: () => void;
  inspector: ReactNode;
  moreControl: ReactNode;
  cropDisabled: boolean;
  cropTransport: ReactNode;
}) {
  const inspectorReference = useRef<HTMLElement>(null);
  return (
    <div
      data-tool={tool ?? undefined}
      className="editor-mobile-workspace flex h-full min-h-0 flex-col overflow-y-auto"
    >
      {error && (
        <div
          role="status"
          className="shrink-0 border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      <div className="editor-mobile-preview shrink-0">{previewPane}</div>
      <div
        className={`editor-mobile-timeline flex-1 ${tool ? "min-h-52" : "min-h-72"}`}
        hidden={tool === "crop"}
        inert={tool === "crop"}
      >
        {timelinePane}
      </div>
      {tool === "crop" && (
        <div className="editor-mobile-crop-transport shrink-0">
          {cropTransport}
        </div>
      )}
      <section
        ref={inspectorReference}
        id="editor-mobile-inspector"
        tabIndex={-1}
        aria-label={tool ? mobileTools[tool].label : "Editor tool"}
        hidden={!tool}
        className={cn(
          "editor-mobile-inspector flex min-h-0 shrink-0 flex-col border-t border-editor-border bg-editor-panel",
          tool === "crop" ? "flex-1" : "h-60",
          tool === "subtitles" && "h-80",
        )}
      >
        {tool && tool !== "crop" && tool !== "subtitles" && (
          <div className="flex h-11 shrink-0 items-center justify-between px-3">
            <h2 className="text-sm font-medium">{mobileTools[tool].label}</h2>
            <button
              type="button"
              onClick={onDone}
              className="editor-control-focus min-h-11 px-3 text-sm text-primary"
            >
              Done
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {inspector}
        </div>
      </section>
      <nav
        aria-label="Editing tools"
        className="editor-mobile-tools grid min-h-16 shrink-0 grid-cols-[repeat(auto-fit,minmax(min(100%,3.5rem),1fr))] border-t border-editor-border bg-editor-panel px-1"
      >
        {(Object.keys(mobileTools) as EditorTool[]).map((key) => {
          const { label, icon: Icon } = mobileTools[key];
          return (
            <button
              key={key}
              id={`editor-tool-${key}`}
              type="button"
              onClick={(event) => {
                onToolChange(key);
                if (event.detail === 0) {
                  queueMicrotask(() => {
                    const inspector = inspectorReference.current;
                    if (inspector && !inspector.hidden) {
                      inspector.focus({ preventScroll: true });
                    }
                  });
                }
              }}
              disabled={key === "crop" && cropDisabled}
              aria-label={key === "crop" ? "Crop video" : label}
              aria-expanded={tool === key}
              aria-controls="editor-mobile-inspector"
              className="editor-control-focus flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 text-xs text-muted-foreground aria-expanded:text-primary disabled:opacity-40"
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </button>
          );
        })}
        {moreControl}
      </nav>
    </div>
  );
}
