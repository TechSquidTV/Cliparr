import type { Dispatch, SetStateAction } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { EditorEditableTimecode } from "@/components/editor/EditorEditableTimecode";
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
import { formatTime } from "@/components/editor/editorUtilities";
import {
  subtitleTrackKey,
  subtitleTrackSupportsBurnIn,
  subtitleTrackUnavailableMessage,
} from "@/lib/selectPreferredSubtitleTrack";
import {
  formatSubtitleTrackLabel,
  formatSubtitleTrackTechnicalSummary,
} from "@/lib/subtitleTrackLabels";
import type { SubtitleStyleSettings } from "@/lib/subtitles/types";
import type { PlaybackSubtitleTrack } from "@/providers/types";
import type { SubtitleTimelineCue } from "@/components/editor/subtitleTimeline";
import type { EditorTimelineSelection } from "@/components/editor/editorTimelineSelection";
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

interface EditorSubtitlePanelProperties {
  showGlobalSubtitles: boolean;
  timelineSelection: EditorTimelineSelection;
  selectedSubtitleCue: SubtitleTimelineCue | null;
  clipStartTime: number;
  clipEndTime: number;
  duration: number;
  onClipStartTimeCommit: (seconds: number) => void;
  onClipEndTimeCommit: (seconds: number) => void;
  onClipDurationCommit: (seconds: number) => void;
  onSubtitleCueStartTimeCommit: (
    cue: SubtitleTimelineCue,
    seconds: number,
  ) => void;
  onSubtitleCueEndTimeCommit: (
    cue: SubtitleTimelineCue,
    seconds: number,
  ) => void;
  onSubtitleCueDurationCommit: (
    cue: SubtitleTimelineCue,
    seconds: number,
  ) => void;
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
}

export function EditorSubtitlePanel({
  showGlobalSubtitles,
  timelineSelection,
  selectedSubtitleCue,
  clipStartTime,
  clipEndTime,
  duration,
  onClipStartTimeCommit,
  onClipEndTimeCommit,
  onClipDurationCommit,
  onSubtitleCueStartTimeCommit,
  onSubtitleCueEndTimeCommit,
  onSubtitleCueDurationCommit,
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
}: EditorSubtitlePanelProperties) {
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
  const selectedClip = timelineSelection.kind === "clip";
  const selectedItemTitle = selectedClip ? "Clip" : "Subtitle";
  const selectedStartTime = selectedSubtitleCue?.startTime ?? clipStartTime;
  const selectedEndTime = selectedSubtitleCue?.endTime ?? clipEndTime;
  const selectedDuration = Math.max(0, selectedEndTime - selectedStartTime);
  const timingDisabled =
    duration <= 0 ||
    (timelineSelection.kind === "subtitle-cue" && !selectedSubtitleCue);
  const timingRows = (
    <>
      <SelectionTimecodeRow
        label="Start"
        value={selectedStartTime}
        disabled={timingDisabled}
        onCommit={(seconds) => {
          if (selectedSubtitleCue) {
            onSubtitleCueStartTimeCommit(selectedSubtitleCue, seconds);
            return;
          }

          onClipStartTimeCommit(seconds);
        }}
      />
      <SelectionTimecodeRow
        label="End"
        value={selectedEndTime}
        disabled={timingDisabled}
        onCommit={(seconds) => {
          if (selectedSubtitleCue) {
            onSubtitleCueEndTimeCommit(selectedSubtitleCue, seconds);
            return;
          }

          onClipEndTimeCommit(seconds);
        }}
      />
      <SelectionTimecodeRow
        label="Duration"
        value={selectedDuration}
        disabled={timingDisabled}
        onCommit={(seconds) => {
          if (selectedSubtitleCue) {
            onSubtitleCueDurationCommit(selectedSubtitleCue, seconds);
            return;
          }

          onClipDurationCommit(seconds);
        }}
      />
    </>
  );

  return (
    <div className="cliparr-editor-scrollbar min-h-0 flex-1 overflow-y-auto bg-editor-panel text-sidebar-foreground">
      <EditorPropertyAccordion<EditorPropertiesSectionId>
        value={editorPropertiesOpenSections}
        onValueChange={onEditorPropertiesOpenSectionsChange}
      >
        <EditorPropertyAccordionItem<EditorPropertiesSectionId>
          value={EDITOR_PROPERTIES_SECTION_ID.selection}
          title="Selection"
        >
          <EditorPropertySection title={selectedItemTitle}>
            {selectedSubtitleCue ? (
              <EditorPropertyRow label="Text" align="start">
                <span className="block max-h-24 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-control)] border border-editor-border bg-editor-control px-2.5 py-2 text-xs leading-relaxed text-sidebar-foreground">
                  {selectedSubtitleCue.lines.join("\n")}
                </span>
              </EditorPropertyRow>
            ) : null}
            {timingRows}
          </EditorPropertySection>
        </EditorPropertyAccordionItem>

        {showGlobalSubtitles ? (
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
                  onChange={(value) =>
                    updateStyleSetting("shadowOffsetY", value)
                  }
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
        ) : null}
      </EditorPropertyAccordion>
    </div>
  );
}

function SelectionTimecodeRow({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (seconds: number) => void;
}) {
  return (
    <EditorPropertyRow label={label}>
      <EditorEditableTimecode
        ariaLabel={`${label.toLowerCase()} time`}
        buttonClassName="h-8 w-full justify-end rounded-[var(--radius-control)] border border-editor-border bg-editor-control px-2.5 font-mono text-xs font-semibold tabular-nums text-sidebar-foreground hover:bg-editor-control-hover focus-visible:ring-editor-accent/35"
        className="w-full justify-end"
        disabled={disabled}
        inputClassName="w-full text-right text-xs"
        inputWidth="100%"
        onCommit={onCommit}
        value={value}
      >
        <span className="block w-full text-right">{formatTime(value)}</span>
      </EditorEditableTimecode>
    </EditorPropertyRow>
  );
}
