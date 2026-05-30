import type { Dispatch, SetStateAction } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  subtitleTrackKey,
  subtitleTrackSupportsBurnIn,
  subtitleTrackUnavailableMessage,
} from "../../lib/selectPreferredSubtitleTrack";
import type { SubtitleStyleSettings } from "../../lib/subtitles/types";
import type { PlaybackSubtitleTrack } from "../../providers/types";
import {
  EditorColorControl,
  EditorPropertyRow,
  EditorPropertySection,
  EditorRangeControl,
  editorPropertyLabelClassName,
  editorPropertySelectTriggerClassName,
} from "./EditorPropertyUi";
import { useSubtitleFontOptions } from "./useSubtitleFontOptions";

interface EditorSubtitlePanelProps {
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
}

function subtitleTrackLabel(track: PlaybackSubtitleTrack) {
  const parts = [
    track.title?.trim(),
    track.languageCode?.trim()?.toUpperCase(),
  ].filter(Boolean);
  const codec = track.codec?.trim()?.toUpperCase();
  const flags = [
    track.isForced ? "Forced" : null,
    track.isHearingImpaired ? "SDH" : null,
    track.isDefault ? "Default" : null,
    track.isExternal ? "External" : null,
    !subtitleTrackSupportsBurnIn(track) ? "Unsupported" : null,
  ].filter(Boolean);

  const baseLabel = parts[0] ?? parts[1] ?? "Unnamed subtitle track";
  const detailParts = [
    parts[0] && parts[1] ? parts[1] : null,
    codec,
    flags.join(" · "),
  ].filter(Boolean);

  return detailParts.length > 0
    ? `${baseLabel} (${detailParts.join(" | ")})`
    : baseLabel;
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
}: EditorSubtitlePanelProps) {
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
  const subtitleWarning =
    subtitleTracks.length === 0
      ? "No supported subtitles found."
      : !selectedSubtitleTrack
        ? "Choose a subtitle track."
        : (unavailableMessage ?? "This subtitle track is not supported.");
  const subtitleToggleTooltip = !canEnableBurnIn ? subtitleWarning : null;
  const styleTooltip = styleControlsDisabled
    ? subtitlesEnabled
      ? subtitleWarning
      : "Turn subtitles on to edit style."
    : null;

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
    <div className="flex items-center gap-2">
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
    </div>
  );

  return (
    <div className="cliparr-editor-scrollbar min-h-0 flex-1 overflow-y-auto bg-editor-panel text-sidebar-foreground">
      <EditorPropertySection
        title="Subtitles"
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
                      {subtitleTrackLabel(track)}
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
                    {selectedSubtitleTrack.codec?.toUpperCase() ??
                      "Unknown codec"}
                    {selectedSubtitleTrack.languageCode
                      ? ` · ${selectedSubtitleTrack.languageCode.toUpperCase()}`
                      : ""}
                    {selectedSubtitleTrack.isForced ? " · Forced" : ""}
                    {selectedSubtitleTrack.isHearingImpaired ? " · SDH" : ""}
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
              onValueChange={(value) => updateStyleSetting("fontFamily", value)}
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
            label="Bottom"
            value={subtitleStyleSettings.bottomMargin}
            min={0}
            max={180}
            step={1}
            unit="px"
            disabled={styleControlsDisabled}
            onChange={(value) => updateStyleSetting("bottomMargin", value)}
          />
        </EditorPropertySection>
      </div>
    </div>
  );
}
