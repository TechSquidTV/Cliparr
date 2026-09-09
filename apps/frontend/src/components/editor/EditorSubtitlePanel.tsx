import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  LocateFixed,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utilities";
import {
  subtitleTrackKey,
  subtitleTrackSupportsBurnIn,
  subtitleTrackUnavailableMessage,
} from "@/lib/selectPreferredSubtitleTrack";
import {
  formatSubtitleTrackLabel,
  formatSubtitleTrackTechnicalSummary,
} from "@/lib/subtitleTrackLabels";
import type { SubtitleCue, SubtitleStyleSettings } from "@/lib/subtitles/types";
import type { PlaybackSubtitleTrack } from "@/providers/types";
import {
  EditorPropertyAccordion,
  EditorPropertyAccordionItem,
  EditorColorControl,
  EditorPropertyRow,
  EditorPropertySection,
  EditorRangeControl,
  editorPropertyLabelClassName,
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

interface EditorSubtitlePanelProperties {
  providerId?: string;
  subtitleTracks: readonly PlaybackSubtitleTrack[];
  selectedSubtitleTrackKey: string;
  onSelectedSubtitleTrackKeyChange: (value: string) => void;
  subtitlesEnabled: boolean;
  onSubtitlesEnabledChange: (value: boolean) => void;
  subtitleStyleSettings: SubtitleStyleSettings;
  onSubtitleStyleSettingsChange: Dispatch<
    SetStateAction<SubtitleStyleSettings>
  >;
  subtitleLoading: boolean;
  subtitleError: string | null;
  selectedSubtitleTrack: PlaybackSubtitleTrack | null;
  editorPropertiesOpenSections: EditorPropertiesOpenSections;
  onEditorPropertiesOpenSectionsChange: (
    openSections: EditorPropertiesOpenSections,
  ) => void;
  selectedSubtitleCue: SubtitleCue | null;
  onSelectedSubtitleTextCommit: (text: string) => void;
  onSelectedSubtitleStartCommit: (time: number) => void;
  onSelectedSubtitleEndCommit: (time: number) => void;
  onDeleteSelectedSubtitle: () => void;
  onSelectPreviousSubtitle: () => void;
  onSelectNextSubtitle: () => void;
  onSeekToSelectedSubtitle: () => void;
}

export function EditorSubtitlePanel({
  providerId,
  subtitleTracks,
  selectedSubtitleTrackKey,
  onSelectedSubtitleTrackKeyChange,
  subtitlesEnabled,
  onSubtitlesEnabledChange,
  subtitleStyleSettings,
  onSubtitleStyleSettingsChange,
  subtitleLoading,
  subtitleError,
  selectedSubtitleTrack,
  editorPropertiesOpenSections,
  onEditorPropertiesOpenSectionsChange,
  selectedSubtitleCue,
  onSelectedSubtitleTextCommit,
  onSelectedSubtitleStartCommit,
  onSelectedSubtitleEndCommit,
  onDeleteSelectedSubtitle,
  onSelectPreviousSubtitle,
  onSelectNextSubtitle,
  onSeekToSelectedSubtitle,
}: EditorSubtitlePanelProperties) {
  const [subtitleTextDraft, setSubtitleTextDraft] = useState("");
  useEffect(() => {
    setSubtitleTextDraft(selectedSubtitleCue?.text ?? "");
  }, [selectedSubtitleCue?.id, selectedSubtitleCue?.text]);
  const canEnableBurnIn = subtitleTrackSupportsBurnIn(selectedSubtitleTrack);
  const styleControlsDisabled = !subtitlesEnabled || !canEnableBurnIn;
  const {
    currentFontOption,
    bundledFontOptions,
    localFontOptions,
    loadingLocalFonts,
    requestLocalFonts,
  } = useSubtitleFontOptions(subtitleStyleSettings.fontFamily);
  const unavailableMessage = subtitleTrackUnavailableMessage(
    selectedSubtitleTrack,
    providerId,
  );
  let subtitleWarning = "Choose a subtitle track.";
  if (subtitleTracks.length === 0) {
    subtitleWarning = "No supported subtitles found.";
  } else if (selectedSubtitleTrack) {
    subtitleWarning =
      unavailableMessage ?? "This subtitle track is not supported.";
  }

  const subtitleToggleTooltip = canEnableBurnIn ? null : subtitleWarning;
  let styleTooltip: string | null = null;
  if (styleControlsDisabled) {
    styleTooltip = subtitlesEnabled
      ? subtitleWarning
      : "Turn subtitles on to edit style.";
  }

  function updateStyleSetting<Key extends keyof SubtitleStyleSettings>(
    key: Key,
    value: SubtitleStyleSettings[Key],
  ) {
    onSubtitleStyleSettingsChange((current) => ({
      ...current,
      [key]: value,
    }));
  }

  const subtitleToggle = (
    <Switch
      aria-label={subtitlesEnabled ? "Disable subtitles" : "Enable subtitles"}
      checked={subtitlesEnabled}
      disabled={!canEnableBurnIn}
      onCheckedChange={onSubtitlesEnabledChange}
      variant="editor"
    />
  );
  const subtitleAction = (
    <span className="flex items-center gap-2">
      <span className="relative h-3.5 w-3.5 shrink-0 text-muted-foreground">
        <LoaderCircle
          aria-hidden={!subtitleLoading}
          className={cn(
            "absolute inset-0 h-3.5 w-3.5 transition-opacity duration-150",
            subtitleLoading ? "animate-spin opacity-100" : "opacity-0",
          )}
        />
        <span className="sr-only" aria-live="polite" role="status">
          {subtitleLoading ? "Loading subtitles." : ""}
        </span>
      </span>
      {subtitleToggle}
    </span>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-editor-panel text-sidebar-foreground">
      <EditorPropertyAccordion<EditorPropertiesSectionId>
        value={editorPropertiesOpenSections}
        onValueChange={onEditorPropertiesOpenSectionsChange}
      >
        <EditorPropertyAccordionItem<EditorPropertiesSectionId>
          value={EDITOR_PROPERTIES_SECTION_ID.globalSubtitles}
          title="Global Subtitles"
          action={
            subtitleToggleTooltip ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex" tabIndex={0}>
                    {subtitleAction}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {subtitleToggleTooltip}
                </TooltipContent>
              </Tooltip>
            ) : (
              subtitleAction
            )
          }
        >
          <EditorPropertySection title="Track">
            <EditorPropertyRow label="Track">
              <Select
                value={selectedSubtitleTrackKey}
                onValueChange={onSelectedSubtitleTrackKeyChange}
              >
                <SelectTrigger
                  size="sm"
                  className={editorPropertySelectTriggerClassName()}
                >
                  <SelectValue placeholder="Select subtitle track" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Subtitle Tracks</SelectLabel>
                    <SelectItem value="none">No subtitles</SelectItem>
                    {subtitleTracks.map((track) => {
                      const trackKey = subtitleTrackKey(track);

                      return (
                        <SelectItem key={trackKey} value={trackKey}>
                          {formatSubtitleTrackLabel(track, {
                            variant: "selector",
                          })}
                        </SelectItem>
                      );
                    })}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </EditorPropertyRow>

            {!canEnableBurnIn && (
              <div className="border border-editor-border bg-editor-warning px-2.5 py-2 text-xs text-editor-warning-foreground">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="space-y-1">
                    <p>{subtitleWarning}</p>
                    {selectedSubtitleTrack && (
                      <p className="text-ui-label text-muted-foreground">
                        {formatSubtitleTrackTechnicalSummary(
                          selectedSubtitleTrack,
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {subtitleError && (
              <div className="border border-destructive/35 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                {subtitleError}
              </div>
            )}
          </EditorPropertySection>

          <EditorPropertySection
            title="Selected Cue"
            action={
              selectedSubtitleCue ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={onSelectPreviousSubtitle}
                    aria-label="Select previous subtitle cue"
                    className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={onSelectNextSubtitle}
                    aria-label="Select next subtitle cue"
                    className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none"
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
                    aria-label="Subtitle cue text"
                    value={subtitleTextDraft}
                    rows={4}
                    onChange={(event) =>
                      setSubtitleTextDraft(event.target.value)
                    }
                    onBlur={() =>
                      onSelectedSubtitleTextCommit(subtitleTextDraft)
                    }
                    onKeyDown={(event) => {
                      if (
                        (event.metaKey || event.ctrlKey) &&
                        event.key === "Enter"
                      ) {
                        event.preventDefault();
                        onSelectedSubtitleTextCommit(subtitleTextDraft);
                      }
                    }}
                    className="w-full resize-y rounded-[var(--radius-control)] border border-editor-border bg-editor-control px-2.5 py-2 text-xs leading-relaxed text-foreground outline-none focus:border-editor-accent focus:ring-2 focus:ring-editor-accent/25"
                  />
                </EditorPropertyRow>
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
                      className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-editor-border bg-editor-control px-2.5 text-xs text-muted-foreground hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none"
                    >
                      <LocateFixed className="h-3.5 w-3.5" />
                      Seek
                    </button>
                    <button
                      type="button"
                      onClick={onDeleteSelectedSubtitle}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 px-2.5 text-xs text-destructive hover:bg-destructive/15 focus-visible:ring-2 focus-visible:ring-destructive/30 focus-visible:outline-none"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                </EditorPropertyRow>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Select a subtitle clip in the timeline to edit its text and
                timing.
              </p>
            )}
          </EditorPropertySection>

          <div
            aria-disabled={styleControlsDisabled}
            className={cn(
              "transition-opacity",
              styleControlsDisabled && "opacity-60",
            )}
          >
            <EditorPropertySection
              title="Text"
              action={
                styleTooltip ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={editorPropertyLabelClassName()}>
                        Locked
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="end">
                      {styleTooltip}
                    </TooltipContent>
                  </Tooltip>
                ) : null
              }
            >
              <EditorPropertyRow label="Font">
                <Select
                  value={subtitleStyleSettings.fontFamily}
                  onValueChange={(value) =>
                    updateStyleSetting("fontFamily", value)
                  }
                  onOpenChange={(open) => {
                    if (open && !styleControlsDisabled) {
                      requestLocalFonts();
                    }
                  }}
                  disabled={styleControlsDisabled}
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
                disabled={styleControlsDisabled}
                onChange={(value) => updateStyleSetting("fontColor", value)}
              />
              <EditorRangeControl
                label="Size"
                value={subtitleStyleSettings.fontSize}
                min={16}
                max={150}
                step={1}
                unit="px"
                disabled={styleControlsDisabled}
                onChange={(value) => updateStyleSetting("fontSize", value)}
              />
            </EditorPropertySection>

            <EditorPropertySection title="Shadow">
              <EditorColorControl
                label="Color"
                value={subtitleStyleSettings.shadowColor}
                disabled={styleControlsDisabled}
                onChange={(value) => updateStyleSetting("shadowColor", value)}
              />
              <EditorRangeControl
                label="Blur"
                value={subtitleStyleSettings.shadowBlur}
                min={0}
                max={24}
                step={1}
                unit="px"
                disabled={styleControlsDisabled}
                onChange={(value) => updateStyleSetting("shadowBlur", value)}
              />
              <EditorRangeControl
                label="Offset"
                value={subtitleStyleSettings.shadowOffsetY}
                min={-16}
                max={24}
                step={1}
                unit="px"
                disabled={styleControlsDisabled}
                onChange={(value) => updateStyleSetting("shadowOffsetY", value)}
              />
            </EditorPropertySection>

            <EditorPropertySection title="Stroke">
              <EditorColorControl
                label="Color"
                value={subtitleStyleSettings.strokeColor}
                disabled={styleControlsDisabled}
                onChange={(value) => updateStyleSetting("strokeColor", value)}
              />
              <EditorRangeControl
                label="Width"
                value={subtitleStyleSettings.strokeWidth}
                min={0}
                max={32}
                step={0.5}
                unit="px"
                disabled={styleControlsDisabled}
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
                disabled={styleControlsDisabled}
                onChange={(value) => updateStyleSetting("positionX", value)}
              />
              <EditorRangeControl
                label="Y"
                value={subtitleStyleSettings.positionY}
                min={0}
                max={100}
                step={1}
                unit="%"
                disabled={styleControlsDisabled}
                onChange={(value) => updateStyleSetting("positionY", value)}
              />
            </EditorPropertySection>
          </div>
        </EditorPropertyAccordionItem>
      </EditorPropertyAccordion>
    </div>
  );
}
