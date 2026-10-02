import { useEffect, useRef, type RefObject } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  LocateFixed,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { subtitleTrackKey } from "@/lib/selectPreferredSubtitleTrack";
import { SubtitleTrackLabel } from "@/components/editor/SubtitleTrackLabel";
import type { SubtitleStyleSettings } from "@/lib/subtitles/types";
import {
  EditorPropertyAccordion,
  EditorPropertyAccordionItem,
  EditorColorControl,
  EditorPropertyRow,
  EditorPropertySection,
  EditorRangeControl,
  editorPropertySelectTriggerClassName,
} from "@/components/editor/EditorPropertyControls";
import {
  EDITOR_PROPERTIES_SECTION_ID,
  type EditorPropertiesOpenSections,
  type EditorPropertiesSectionId,
} from "@/components/editor/editorSidebarPreferences";
import { useSubtitleFontOptions } from "@/components/editor/useSubtitleFontOptions";
import { EditorEditableTimecode } from "@/components/editor/EditorEditableTimecode";
import { formatTimecodeInput } from "@/components/editor/editorUtilities";
import type { useEditorSubtitles } from "@/components/editor/useEditorSubtitles";

interface EditorSubtitlePanelProperties {
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
}

const actionClasses =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-editor-border bg-editor-control px-2.5 text-xs text-foreground hover:bg-editor-control-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-accent/35 disabled:opacity-50 disabled:cursor-not-allowed lg:min-h-8";
const menuItemClasses =
  "cursor-default rounded px-3 py-2 text-xs outline-none focus:bg-editor-control-hover data-[disabled]:opacity-50";

export function EditorSubtitlePanel({
  subtitles,
  subtitleTrackTriggerRef,
  subtitleOptionsTriggerRef,
  editorPropertiesOpenSections,
  onEditorPropertiesOpenSectionsChange,
}: EditorSubtitlePanelProperties) {
  const {
    subtitleTracks,
    subtitleOutputEnabled,
    setSubtitleEnabled,
    subtitleStyleSettings,
    setSubtitleStyleSettings,
    subtitleLoading,
    subtitleError,
    selectedSubtitleCue,
    subtitleCues,
    subtitleText,
    editSubtitleText,
    commitText,
    textError,
    selectedSubtitleOutsideRange,
    canAddSubtitle,
    addSubtitle,
    focusRevision,
    handleSelectedSubtitleStartCommit: onSelectedSubtitleStartCommit,
    handleSelectedSubtitleEndCommit: onSelectedSubtitleEndCommit,
    handleDeleteSelectedSubtitle: onDeleteSelectedSubtitle,
    handleSelectPreviousSubtitle: onSelectPreviousSubtitle,
    handleSelectNextSubtitle: onSelectNextSubtitle,
    handleSeekToSelectedSubtitle: onSeekToSelectedSubtitle,
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
  const {
    currentFontOption,
    bundledFontOptions,
    localFontOptions,
    loadingLocalFonts,
    requestLocalFonts,
  } = useSubtitleFontOptions(subtitleStyleSettings.fontFamily);
  function updateStyleSetting<Key extends keyof SubtitleStyleSettings>(
    key: Key,
    value: SubtitleStyleSettings[Key],
  ) {
    setSubtitleStyleSettings((current) => ({ ...current, [key]: value }));
  }
  return (
    <div
      ref={panelReference}
      className="flex h-full min-h-0 flex-col bg-editor-panel text-sidebar-foreground"
    >
      <div className="sticky top-0 z-10 shrink-0 space-y-2 border-b border-editor-border bg-editor-panel p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Subtitles</h2>
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
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                ref={subtitleTrackTriggerRef}
                type="button"
                className={actionClasses}
                disabled={!subtitles.canImportSubtitles}
              >
                Import…
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                onCloseAutoFocus={(event) => {
                  if (subtitles.subtitleTrackChangePending) {
                    event.preventDefault();
                  }
                }}
                className="z-50 max-h-80 max-w-80 overflow-y-auto rounded border border-editor-border bg-editor-panel p-1 shadow-lg"
              >
                <DropdownMenu.Label className="px-3 py-2 text-xs text-muted-foreground">
                  Import subtitle track
                </DropdownMenu.Label>
                {subtitleTracks.map((track) => (
                  <DropdownMenu.Item
                    key={subtitleTrackKey(track)}
                    className={menuItemClasses}
                    onSelect={() =>
                      subtitles.requestImport(subtitleTrackKey(track))
                    }
                  >
                    <SubtitleTrackLabel track={track} />
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                ref={subtitleOptionsTriggerRef}
                aria-label="Subtitle options"
                className={actionClasses}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                className="z-50 rounded border border-editor-border bg-editor-panel p-1 shadow-lg"
                onCloseAutoFocus={(event) => {
                  if (subtitles.clearPending) {
                    event.preventDefault();
                  }
                }}
              >
                <DropdownMenu.Item
                  disabled={subtitleCues.length === 0 && !subtitleLoading}
                  onSelect={subtitles.requestClear}
                  className={menuItemClasses}
                >
                  Start blank…
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        {subtitleLoading && (
          <div role="status" className="flex items-center gap-2 text-xs">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
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
        <fieldset disabled={subtitleLoading} className="min-w-0">
          <EditorPropertySection
            title="Selected subtitle"
            action={
              selectedSubtitleCue ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={onSelectPreviousSubtitle}
                    aria-label="Select previous subtitle cue"
                    className="flex h-11 w-11 lg:h-7 lg:w-7 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={onSelectNextSubtitle}
                    aria-label="Select next subtitle cue"
                    className="flex h-11 w-11 lg:h-7 lg:w-7 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null
            }
          >
            {selectedSubtitleCue ? (
              <>
                <EditorPropertyRow label="Text" align="start">
                  <textarea
                    aria-label="Subtitle text"
                    ref={textReference}
                    disabled={subtitleLoading}
                    value={subtitleText}
                    rows={4}
                    onChange={(event) => editSubtitleText(event.target.value)}
                    onBlur={commitText}
                    onKeyDown={(event) => {
                      if (
                        (event.metaKey || event.ctrlKey) &&
                        event.key === "Enter"
                      ) {
                        event.preventDefault();
                        commitText();
                      }
                    }}
                    className="w-full resize-y rounded-[var(--radius-control)] border border-editor-border bg-editor-control px-2.5 py-2 text-xs leading-relaxed text-foreground outline-none focus:border-editor-accent focus:ring-2 focus:ring-editor-accent/25"
                  />
                </EditorPropertyRow>
                {textError && (
                  <p role="status" className="px-3 text-xs text-destructive">
                    {textError}
                  </p>
                )}
                {selectedSubtitleOutsideRange && (
                  <p className="px-3 text-xs text-muted-foreground">
                    Outside export range
                  </p>
                )}
                <EditorPropertyRow label="In">
                  <EditorEditableTimecode
                    ariaLabel="subtitle cue in point"
                    value={selectedSubtitleCue.startTime}
                    onCommit={onSelectedSubtitleStartCommit}
                    className="w-full justify-end"
                    buttonClassName="w-full justify-end rounded-[var(--radius-control)] px-2 py-1 font-mono text-xs text-foreground hover:bg-editor-control-hover"
                  >
                    <span>
                      {formatTimecodeInput(selectedSubtitleCue.startTime)}
                    </span>
                  </EditorEditableTimecode>
                </EditorPropertyRow>
                <EditorPropertyRow label="Out">
                  <EditorEditableTimecode
                    ariaLabel="subtitle cue out point"
                    value={selectedSubtitleCue.endTime}
                    onCommit={onSelectedSubtitleEndCommit}
                    className="w-full justify-end"
                    buttonClassName="w-full justify-end rounded-[var(--radius-control)] px-2 py-1 font-mono text-xs text-foreground hover:bg-editor-control-hover"
                  >
                    <span>
                      {formatTimecodeInput(selectedSubtitleCue.endTime)}
                    </span>
                  </EditorEditableTimecode>
                </EditorPropertyRow>
                <EditorPropertyRow
                  label="Duration"
                  value={formatTimecodeInput(
                    selectedSubtitleCue.endTime - selectedSubtitleCue.startTime,
                  )}
                >
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={onSeekToSelectedSubtitle}
                      className="inline-flex min-h-11 lg:min-h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-editor-border bg-editor-control px-2.5 text-xs text-muted-foreground hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none"
                    >
                      <LocateFixed className="h-3.5 w-3.5" />
                      Seek
                    </button>
                    <button
                      type="button"
                      onClick={onDeleteSelectedSubtitle}
                      className="inline-flex min-h-11 lg:min-h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 px-2.5 text-xs text-destructive hover:bg-destructive/15 focus-visible:ring-2 focus-visible:ring-destructive/30 focus-visible:outline-none"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete subtitle
                    </button>
                  </div>
                </EditorPropertyRow>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {subtitleCues.length === 0
                  ? "Add your own text at the playhead, or import subtitles."
                  : "Select a subtitle in the timeline to edit its text and timing."}
              </p>
            )}
          </EditorPropertySection>
        </fieldset>
        <EditorPropertyAccordion<EditorPropertiesSectionId>
          value={editorPropertiesOpenSections}
          onValueChange={onEditorPropertiesOpenSectionsChange}
        >
          <EditorPropertyAccordionItem<EditorPropertiesSectionId>
            value={EDITOR_PROPERTIES_SECTION_ID.subtitleStyle}
            title="Shared style"
          >
            <EditorPropertySection title="Text">
              <EditorPropertyRow label="Font">
                <Select
                  value={subtitleStyleSettings.fontFamily}
                  onValueChange={(value) =>
                    updateStyleSetting("fontFamily", value)
                  }
                  onOpenChange={(open) => {
                    if (open) {
                      requestLocalFonts();
                    }
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className={editorPropertySelectTriggerClassName()}
                  >
                    <SelectValue placeholder="Select font" />
                  </SelectTrigger>
                  <SelectContent>
                    {currentFontOption && (
                      <SelectGroup>
                        <SelectLabel>Current Font</SelectLabel>
                        <SelectItem value={currentFontOption.value}>
                          {currentFontOption.label}
                        </SelectItem>
                      </SelectGroup>
                    )}
                    <SelectGroup>
                      <SelectLabel>Included Fonts</SelectLabel>
                      {bundledFontOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    {localFontOptions.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Installed Fonts</SelectLabel>
                        {localFontOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {loadingLocalFonts && (
                      <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        Loading installed fonts...
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </EditorPropertyRow>

              <EditorColorControl
                label="Color"
                value={subtitleStyleSettings.fontColor}
                onChange={(value) => updateStyleSetting("fontColor", value)}
              />
              <EditorRangeControl
                label="Size"
                value={subtitleStyleSettings.fontSize}
                min={16}
                max={150}
                step={1}
                unit="px"
                onChange={(value) => updateStyleSetting("fontSize", value)}
              />
            </EditorPropertySection>

            <EditorPropertySection title="Shadow">
              <EditorColorControl
                label="Color"
                value={subtitleStyleSettings.shadowColor}
                onChange={(value) => updateStyleSetting("shadowColor", value)}
              />
              <EditorRangeControl
                label="Blur"
                value={subtitleStyleSettings.shadowBlur}
                min={0}
                max={24}
                step={1}
                unit="px"
                onChange={(value) => updateStyleSetting("shadowBlur", value)}
              />
              <EditorRangeControl
                label="Offset"
                value={subtitleStyleSettings.shadowOffsetY}
                min={-16}
                max={24}
                step={1}
                unit="px"
                onChange={(value) => updateStyleSetting("shadowOffsetY", value)}
              />
            </EditorPropertySection>

            <EditorPropertySection title="Stroke">
              <EditorColorControl
                label="Color"
                value={subtitleStyleSettings.strokeColor}
                onChange={(value) => updateStyleSetting("strokeColor", value)}
              />
              <EditorRangeControl
                label="Width"
                value={subtitleStyleSettings.strokeWidth}
                min={0}
                max={32}
                step={0.5}
                unit="px"
                onChange={(value) => updateStyleSetting("strokeWidth", value)}
              />
            </EditorPropertySection>

            <EditorPropertySection title="Position">
              <EditorRangeControl
                label="X"
                value={subtitleStyleSettings.positionX}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={(value) => updateStyleSetting("positionX", value)}
              />
              <EditorRangeControl
                label="Y"
                value={subtitleStyleSettings.positionY}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={(value) => updateStyleSetting("positionY", value)}
              />
            </EditorPropertySection>
          </EditorPropertyAccordionItem>
        </EditorPropertyAccordion>
      </div>
    </div>
  );
}
