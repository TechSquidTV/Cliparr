import { Menu } from "@base-ui/react/menu";
import { MoreHorizontal, Plus } from "lucide-react";
import { type RefObject, useEffect, useRef } from "react";

import type { EditorLayoutVariant } from "#/components/editor/EditorLayout";
import { EditorSubtitleCueEditor } from "#/components/editor/EditorSubtitleCueEditor";
import { EditorSubtitleStyleControls } from "#/components/editor/EditorSubtitleStyleControls";
import { completeEditorTimecode } from "#/components/editor/EditorTimecodeEdit";
import { SubtitleTrackLabel } from "#/components/editor/SubtitleTrackLabel";
import type { useEditorSubtitles } from "#/components/editor/useEditorSubtitles";
import {
  editorActionButtonClasses,
  editorIconButtonClassName,
} from "#/components/ui/control-styles";
import { Switch } from "#/components/ui/switch";
import { Tabs, TabsList, TabsPanel, TabsTab } from "#/components/ui/tabs";
import { cn } from "#/lib/cn";
import { subtitleTrackKey } from "#/lib/subtitles/selectPreferredSubtitleTrack";

export type EditorSubtitleTab = "text" | "timing" | "style";
export interface EditorSubtitlePanelProperties {
  variant: EditorLayoutVariant;
  subtitles: Pick<
    ReturnType<typeof useEditorSubtitles>,
    | "subtitleTracks"
    | "subtitleOutputEnabled"
    | "setSubtitleEnabled"
    | "subtitleStyleSettings"
    | "setSubtitleStyleSettings"
    | "subtitleLoading"
    | "selectedSubtitleCue"
    | "subtitleCues"
    | "subtitleText"
    | "editSubtitleText"
    | "commitText"
    | "beginTextComposition"
    | "endTextComposition"
    | "selectedSubtitleOutsideRange"
    | "canAddSubtitle"
    | "addSubtitle"
    | "focusRevision"
    | "handleSelectedSubtitleStartCommit"
    | "handleSelectedSubtitleEndCommit"
    | "handleDeleteSelectedSubtitle"
    | "handleSelectPreviousSubtitle"
    | "handleSelectNextSubtitle"
    | "handleSeekToSelectedSubtitle"
    | "canImportSubtitles"
    | "requestImport"
    | "subtitleTrackChangePending"
    | "requestClear"
    | "clearPending"
  >;
  subtitleOptionsTriggerRef: RefObject<HTMLButtonElement | null>;
  tab: EditorSubtitleTab;
  onTabChange: (tab: EditorSubtitleTab) => void;
  consumeFocus: (revision: number) => boolean;
  onEditingFocus?: () => void;
  onDone?: () => void;
  showHeading?: boolean;
  autoFocusCreated?: boolean;
}

const menuItemClasses =
  "min-h-11 rounded px-3 py-2 text-sm outline-none data-[highlighted]:bg-editor-control-hover data-[disabled]:opacity-50";

export function EditorSubtitlePanel({
  variant,
  subtitles,
  subtitleOptionsTriggerRef,
  tab,
  onTabChange,
  consumeFocus,
  onEditingFocus,
  onDone,
  showHeading = true,
  autoFocusCreated = true,
}: EditorSubtitlePanelProperties) {
  const textReference = useRef<HTMLTextAreaElement>(null);
  const panelReference = useRef<HTMLDivElement>(null);
  const { focusRevision } = subtitles;
  useEffect(() => {
    if (!consumeFocus(focusRevision)) {
      return;
    }
    onTabChange("text");
    if (!autoFocusCreated) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      textReference.current?.focus({ preventScroll: true });
      textReference.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRevision, consumeFocus, autoFocusCreated, onTabChange]);
  const textEditor = (
    <EditorSubtitleCueEditor
      section={variant === "desktop" ? "all" : "text"}
      subtitles={subtitles}
      textReference={textReference}
    />
  );
  const styleControls = (
    <EditorSubtitleStyleControls
      subtitleStyleSettings={subtitles.subtitleStyleSettings}
      setSubtitleStyleSettings={subtitles.setSubtitleStyleSettings}
    />
  );
  return (
    <div
      ref={panelReference}
      className={cn(
        "flex h-full min-h-0 flex-col bg-editor-panel text-sidebar-foreground",
        variant === "mobile" && tab === "text" && "min-h-60",
      )}
      onFocusCapture={(event) => {
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement
        ) {
          onEditingFocus?.();
        }
      }}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1 px-2 py-1">
        {showHeading && (
          <h2 className="min-w-16 flex-1 truncate text-sm font-medium">
            Subtitles
          </h2>
        )}
        <button
          type="button"
          aria-label="Add subtitle"
          className={
            variant === "mobile"
              ? editorIconButtonClassName({
                  variant: "ghost",
                  className: "h-11 w-11 shrink-0",
                })
              : `${editorActionButtonClasses} flex-1 border-0 bg-transparent`
          }
          disabled={!subtitles.canAddSubtitle}
          onClick={subtitles.addSubtitle}
        >
          <Plus className="h-4 w-4" />
          {variant === "desktop" && "Add subtitle"}
        </button>
        <label className="inline-flex min-h-11 min-w-11 items-center justify-center">
          <Switch
            aria-label="Show subtitles"
            checked={subtitles.subtitleOutputEnabled}
            onCheckedChange={subtitles.setSubtitleEnabled}
            variant="editor"
          />
        </label>
        <Menu.Root>
          <Menu.Trigger
            render={
              <button
                ref={subtitleOptionsTriggerRef}
                type="button"
                aria-label="Subtitle options"
                className={editorIconButtonClassName({
                  variant: "ghost",
                  className: "h-11 w-11 shrink-0",
                })}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          />
          <Menu.Portal>
            <Menu.Positioner align="end" sideOffset={6} className="z-50">
              <Menu.Popup
                finalFocus={() =>
                  !subtitles.subtitleTrackChangePending &&
                  !subtitles.clearPending
                }
                className="max-h-80 max-w-80 overflow-y-auto rounded border border-editor-border bg-editor-panel p-1 shadow-lg"
              >
                {subtitles.subtitleTracks.length > 0 && (
                  <Menu.Group>
                    <Menu.GroupLabel className="px-3 py-2 text-xs text-muted-foreground">
                      Import subtitle track
                    </Menu.GroupLabel>
                    {subtitles.subtitleTracks.map((track) => (
                      <Menu.Item
                        key={subtitleTrackKey(track)}
                        disabled={!subtitles.canImportSubtitles}
                        onClick={() =>
                          subtitles.requestImport(subtitleTrackKey(track))
                        }
                        className={menuItemClasses}
                      >
                        <SubtitleTrackLabel track={track} />
                      </Menu.Item>
                    ))}
                  </Menu.Group>
                )}
                <Menu.Item
                  disabled={
                    subtitles.subtitleCues.length === 0 &&
                    !subtitles.subtitleLoading
                  }
                  onClick={subtitles.requestClear}
                  className={menuItemClasses}
                >
                  Start blank…
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="editor-control-focus min-h-11 shrink-0 rounded-[var(--radius-control)] px-2 text-editor-property font-medium text-primary hover:bg-editor-control-hover"
          >
            Done
          </button>
        )}
      </div>
      {variant === "desktop" ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {textEditor}
          {styleControls}
        </div>
      ) : (
        <Tabs
          value={tab}
          onValueChange={(value: string) => {
            if (
              panelReference.current &&
              !completeEditorTimecode(panelReference.current)
            ) {
              return;
            }
            if (value === "text" || value === "timing" || value === "style") {
              subtitles.commitText();
              onTabChange(value);
            }
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList
            aria-label="Subtitle editing"
            className="mx-2 mb-2 shrink-0 border-editor-border bg-editor-panel p-0"
            indicatorClassName="bg-editor-control-active"
          >
            <TabsTab
              value="text"
              className="min-h-11 flex-1 text-editor-property font-medium normal-case tracking-normal data-[active]:text-primary"
            >
              Text
            </TabsTab>
            <TabsTab
              value="timing"
              className="min-h-11 flex-1 text-editor-property font-medium normal-case tracking-normal data-[active]:text-primary"
            >
              Timing
            </TabsTab>
            <TabsTab
              value="style"
              className="min-h-11 flex-1 text-editor-property font-medium normal-case tracking-normal data-[active]:text-primary"
            >
              Style
            </TabsTab>
          </TabsList>
          <div
            className={cn(
              "min-h-0 flex-1",
              tab === "text"
                ? "overflow-hidden"
                : "overflow-y-auto overscroll-contain",
            )}
          >
            <TabsPanel value="text" animated={false} className="h-full min-h-0">
              {tab === "text" && textEditor}
            </TabsPanel>
            <TabsPanel value="timing" animated={false}>
              {tab === "timing" && (
                <EditorSubtitleCueEditor
                  section="timing"
                  subtitles={subtitles}
                  textReference={textReference}
                />
              )}
            </TabsPanel>
            <TabsPanel value="style" animated={false}>
              {tab === "style" && styleControls}
            </TabsPanel>
          </div>
        </Tabs>
      )}
    </div>
  );
}
