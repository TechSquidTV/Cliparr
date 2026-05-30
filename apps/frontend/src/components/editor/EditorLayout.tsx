import { Eye } from "lucide-react";
import type { ReactNode } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  EDITOR_PANEL_SIZES,
  EDITOR_RESIZE_TARGET_MINIMUM_SIZE,
} from "./editorLayoutSizing";
import { EditorSidebar } from "./EditorSidebar";

export type EditorLayoutVariant = "desktop" | "mobile";

export function EditorPreviewPane({
  error,
  variant,
  children,
}: {
  error: string | null;
  variant: EditorLayoutVariant;
  children: ReactNode;
}) {
  const previewStage = (
    <section
      className={
        variant === "desktop"
          ? "flex min-h-0 flex-1 items-center justify-center overflow-hidden border border-editor-border bg-editor-monitor p-2"
          : "flex min-h-editor-preview-min flex-none items-center justify-center overflow-hidden border border-editor-border bg-editor-monitor p-2 sm:min-h-editor-preview-sm-min"
      }
    >
      {children}
    </section>
  );

  if (variant === "mobile") {
    return previewStage;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {error && (
        <div className="shrink-0 border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
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
          : "shrink-0 overflow-hidden border border-editor-border bg-editor-panel text-foreground"
      }
    >
      {controls}

      {!hasDuration && (
        <div className="border-t border-editor-border px-3 py-3 text-sm text-muted-foreground">
          Waiting for media duration.
        </div>
      )}

      {hasDuration &&
        (variant === "desktop" ? (
          <div className="min-h-0 flex-1">{timeline}</div>
        ) : (
          timeline
        ))}
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
      icon={Eye}
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
  propertiesActive,
  previewPane,
  timelinePane,
  propertiesContent,
}: {
  playbackSidebarOpen: boolean;
  onPlaybackSidebarOpenChange: (open: boolean) => void;
  propertiesActive: boolean;
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
          >
            <EditorPropertiesPanel
              open={playbackSidebarOpen}
              onOpenChange={onPlaybackSidebarOpenChange}
              active={propertiesActive}
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
            active={propertiesActive}
          >
            <div />
          </EditorPropertiesPanel>
        </ResizablePanel>
      )}
    </ResizablePanelGroup>
  );
}

export function EditorMobileLayout({
  error,
  playbackSourcePanel,
  previewPane,
  timelinePane,
  subtitlePanel,
}: {
  error: string | null;
  playbackSourcePanel: ReactNode;
  previewPane: ReactNode;
  timelinePane: ReactNode;
  subtitlePanel: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col gap-3">
      {error && (
        <div className="border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {playbackSourcePanel}
      {previewPane}
      {timelinePane}
      {subtitlePanel}
    </div>
  );
}
