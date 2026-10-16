import { Menu } from "@base-ui/react/menu";
import { MoreHorizontal, Plus } from "lucide-react";
import { type RefObject, useEffect, useRef } from "react";

import { type EditorPropertiesOpenSections } from "#/components/editor/editorSidebarPreferences";
import { EditorSubtitleCueEditor } from "#/components/editor/EditorSubtitleCueEditor";
import { EditorSubtitleStyleControls } from "#/components/editor/EditorSubtitleStyleControls";
import { SubtitleTrackLabel } from "#/components/editor/SubtitleTrackLabel";
import type { useEditorSubtitles } from "#/components/editor/useEditorSubtitles";
import { Spinner } from "#/components/ui/spinner";
import { Switch } from "#/components/ui/switch";
import { ControlTooltip } from "#/components/ui/tooltip";
import { subtitleTrackKey } from "#/lib/subtitles/selectPreferredSubtitleTrack";

export interface EditorSubtitlePanelProperties {
  subtitles: Pick<
    ReturnType<typeof useEditorSubtitles>,
    | "subtitleTracks"
    | "subtitleOutputEnabled"
    | "setSubtitleEnabled"
    | "subtitleStyleSettings"
    | "setSubtitleStyleSettings"
    | "subtitleLoading"
    | "subtitleError"
    | "selectedSubtitleCue"
    | "subtitleCues"
    | "subtitleText"
    | "editSubtitleText"
    | "commitText"
    | "textError"
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
    | "cancelImport"
    | "subtitleTrackChangePending"
    | "requestClear"
    | "clearPending"
  >;
  subtitleTrackTriggerRef: RefObject<HTMLButtonElement | null>;
  subtitleOptionsTriggerRef: RefObject<HTMLButtonElement | null>;
  editorPropertiesOpenSections: EditorPropertiesOpenSections;
  onEditorPropertiesOpenSectionsChange: (
    sections: EditorPropertiesOpenSections,
  ) => void;
  showHeading?: boolean;
}

const actionClasses =
  "editor-control-focus inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-editor-border bg-editor-control px-2.5 text-xs text-foreground hover:bg-editor-control-hover disabled:opacity-50 disabled:cursor-not-allowed lg:min-h-8";
const menuItemClasses =
  "cursor-default rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-editor-control-hover data-[disabled]:opacity-50";

export function EditorSubtitlePanel({
  subtitles,
  subtitleTrackTriggerRef,
  subtitleOptionsTriggerRef,
  editorPropertiesOpenSections,
  onEditorPropertiesOpenSectionsChange,
  showHeading = true,
}: EditorSubtitlePanelProperties) {
  const {
    subtitleTracks,
    subtitleOutputEnabled,
    setSubtitleEnabled,
    subtitleStyleSettings,
    setSubtitleStyleSettings,
    subtitleLoading,
    subtitleError,
    subtitleCues,
    canAddSubtitle,
    addSubtitle,
    focusRevision,
  } = subtitles;
  const textReference = useRef<HTMLTextAreaElement>(null);
  const panelReference = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusRevision === 0) {
      return;
    }
    panelReference.current?.scrollIntoView({ block: "nearest" });
    textReference.current?.focus({ preventScroll: true });
    textReference.current?.select();
  }, [focusRevision]);
  let importDisabledLabel = "Waiting for media to load";
  if (subtitleLoading) {
    importDisabledLabel = "Subtitle import is in progress";
  } else if (subtitleTracks.length === 0) {
    importDisabledLabel = "No subtitle tracks available to import";
  }
  const importTriggerButton = (
    <button
      ref={subtitleTrackTriggerRef}
      type="button"
      className={actionClasses}
      disabled={!subtitles.canImportSubtitles}
    >
      Import…
    </button>
  );
  return (
    <div
      ref={panelReference}
      className="flex h-full min-h-0 flex-col bg-editor-panel text-sidebar-foreground"
    >
      <div className="sticky top-0 z-10 shrink-0 space-y-2 border-b border-editor-border bg-editor-panel p-3">
        <div
          className={`flex items-center gap-2 ${showHeading ? "justify-between" : "justify-end"}`}
        >
          {showHeading ? (
            <h2 className="text-sm font-semibold">Subtitles</h2>
          ) : null}
          <Switch
            aria-label="Show subtitles"
            checked={subtitleOutputEnabled}
            onCheckedChange={setSubtitleEnabled}
            variant="editor"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={`${actionClasses} flex-1`}
            disabled={!canAddSubtitle}
            onClick={addSubtitle}
          >
            <Plus className="h-3.5 w-3.5" />
            Add subtitle
          </button>
          {subtitles.canImportSubtitles ? (
            <Menu.Root>
              <Menu.Trigger render={importTriggerButton} />
              <Menu.Portal>
                <Menu.Positioner align="end" sideOffset={6} className="z-50">
                  <Menu.Popup
                    finalFocus={() => !subtitles.subtitleTrackChangePending}
                    className="z-50 max-h-80 max-w-80 overflow-y-auto rounded border border-editor-border bg-editor-panel p-1 shadow-lg"
                  >
                    <Menu.Group>
                      <Menu.GroupLabel className="px-3 py-2 text-xs text-muted-foreground">
                        Import subtitle track
                      </Menu.GroupLabel>
                      {subtitleTracks.map((track) => (
                        <Menu.Item
                          key={subtitleTrackKey(track)}
                          className={menuItemClasses}
                          onClick={() =>
                            subtitles.requestImport(subtitleTrackKey(track))
                          }
                        >
                          <SubtitleTrackLabel track={track} />
                        </Menu.Item>
                      ))}
                    </Menu.Group>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          ) : (
            <ControlTooltip disabled label={importDisabledLabel}>
              {importTriggerButton}
            </ControlTooltip>
          )}
          <Menu.Root>
            <Menu.Trigger
              render={
                <button
                  type="button"
                  ref={subtitleOptionsTriggerRef}
                  aria-label="Subtitle options"
                  className={actionClasses}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              }
            />
            <Menu.Portal>
              <Menu.Positioner align="end" sideOffset={6} className="z-50">
                <Menu.Popup
                  className="z-50 rounded border border-editor-border bg-editor-panel p-1 shadow-lg"
                  finalFocus={() => !subtitles.clearPending}
                >
                  <Menu.Item
                    disabled={subtitleCues.length === 0 && !subtitleLoading}
                    onClick={subtitles.requestClear}
                    className={menuItemClasses}
                  >
                    Start blank…
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
        {subtitleLoading && (
          <div role="status" className="flex items-center gap-2 text-xs">
            <Spinner className="h-3.5 w-3.5" />
            Importing subtitles…
            <button
              type="button"
              className="ml-auto underline"
              onClick={subtitles.cancelImport}
            >
              Cancel
            </button>
          </div>
        )}
        {subtitleError && (
          <p role="status" className="text-xs text-destructive">
            {subtitleError}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorSubtitleCueEditor
          subtitles={subtitles}
          textReference={textReference}
        />
        <EditorSubtitleStyleControls
          subtitleStyleSettings={subtitleStyleSettings}
          setSubtitleStyleSettings={setSubtitleStyleSettings}
          editorPropertiesOpenSections={editorPropertiesOpenSections}
          onEditorPropertiesOpenSectionsChange={
            onEditorPropertiesOpenSectionsChange
          }
        />
      </div>
    </div>
  );
}
