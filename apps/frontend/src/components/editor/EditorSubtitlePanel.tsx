import type { Dispatch, SetStateAction } from "react";
import { CheckCircle2, LoaderCircle, Sparkles } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  subtitleTrackSupportsBurnIn,
  subtitleTrackUnavailableMessage,
} from "../../lib/selectPreferredSubtitleTrack";
import type { SubtitleStyleSettings } from "../../lib/subtitles/types";
import type { PlaybackSubtitleTrack } from "../../providers/types";
import { EditorSubtitleStylePreview } from "./EditorSubtitleStylePreview";
import { useSubtitleFontOptions } from "./useSubtitleFontOptions";

interface EditorSubtitlePanelProps {
  providerId?: string;
  subtitleTracks: readonly PlaybackSubtitleTrack[];
  selectedSubtitleTrackKey: string;
  onSelectedSubtitleTrackKeyChange: (value: string) => void;
  subtitlesEnabled: boolean;
  onSubtitlesEnabledChange: (value: boolean) => void;
  subtitleStyleSettings: SubtitleStyleSettings;
  onSubtitleStyleSettingsChange: Dispatch<SetStateAction<SubtitleStyleSettings>>;
  subtitleLoading: boolean;
  subtitleError: string | null;
  selectedSubtitleTrack: PlaybackSubtitleTrack | null;
}

function compactSelectTriggerClassName() {
  return "h-8 w-full min-w-0 rounded-[var(--radius-control)] border-sidebar-border bg-sidebar text-xs font-medium text-sidebar-foreground shadow-none focus-visible:ring-2";
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
  const detailParts = [parts[0] && parts[1] ? parts[1] : null, codec, flags.join(" · ")].filter(Boolean);

  return detailParts.length > 0 ? `${baseLabel} (${detailParts.join(" | ")})` : baseLabel;
}

function NumberSlider({
  label,
  value,
  min,
  max,
  step,
  unit = "",
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}

function ColorControl({
  label,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-sidebar-border bg-sidebar px-2.5 py-2">
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-10 cursor-pointer rounded-[var(--radius-control)] border-0 bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={label}
        />
        <span className="font-mono text-xs text-sidebar-foreground">{value.toUpperCase()}</span>
      </div>
    </label>
  );
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
  const unavailableMessage = subtitleTrackUnavailableMessage(selectedSubtitleTrack, providerId);
  const subtitleStatus = subtitleTracks.length === 0
    ? "No subtitle tracks were exposed by this provider for the active session."
    : !selectedSubtitleTrack
      ? "Choose a subtitle track to preview and burn it into the clip."
      : canEnableBurnIn
        ? "Text subtitle track ready for styled burn-in."
        : unavailableMessage ?? "This subtitle track exists, but it is not yet supported for styled burn-in.";

  function updateStyleSetting<Key extends keyof SubtitleStyleSettings>(
    key: Key,
    value: SubtitleStyleSettings[Key]
  ) {
    onSubtitleStyleSettingsChange((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
      <section className="space-y-3 border border-sidebar-border bg-[color-mix(in_oklch,var(--sidebar-accent)_72%,var(--sidebar))] p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
              Burn-In
            </div>
            <p className="text-xs text-sidebar-foreground">
              Pull provider subtitles into the editor and render them directly into the exported clip.
            </p>
          </div>

          <label className={cn(
            "inline-flex items-center gap-2 rounded-[var(--radius-control)] border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)]",
            subtitlesEnabled && canEnableBurnIn
              ? "border-primary/35 bg-primary/10 text-primary"
              : "border-sidebar-border bg-sidebar text-muted-foreground"
          )}>
            <input
              type="checkbox"
              checked={subtitlesEnabled}
              disabled={!canEnableBurnIn}
              onChange={(event) => onSubtitlesEnabledChange(event.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Enabled
          </label>
        </div>

        <label className="space-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
            Track
          </span>
          <Select value={selectedSubtitleTrackKey} onValueChange={onSelectedSubtitleTrackKeyChange}>
            <SelectTrigger size="sm" className={compactSelectTriggerClassName()}>
              <SelectValue placeholder="Select subtitle track" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Subtitle Tracks</SelectLabel>
                <SelectItem value="none">No subtitles</SelectItem>
                {subtitleTracks.map((track) => (
                  <SelectItem
                    key={`${track.streamId ?? "stream"}:${track.index ?? "index"}`}
                    value={track.streamId ? `stream:${track.streamId}` : `index:${track.index ?? "unknown"}`}
                  >
                    {subtitleTrackLabel(track)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </label>

        <div className={cn(
          "border px-3 py-2 text-xs",
          canEnableBurnIn
            ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300"
            : subtitleTracks.length === 0
              ? "border-sidebar-border bg-sidebar text-muted-foreground"
              : "border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300"
        )}>
          <div className="flex items-start gap-2">
            {canEnableBurnIn ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div className="space-y-1">
              <p>{subtitleStatus}</p>
              {selectedSubtitleTrack && (
                <p className="text-[11px] opacity-85">
                  {selectedSubtitleTrack.codec?.toUpperCase() ?? "Unknown codec"}
                  {selectedSubtitleTrack.languageCode ? ` · ${selectedSubtitleTrack.languageCode.toUpperCase()}` : ""}
                  {selectedSubtitleTrack.isForced ? " · Forced" : ""}
                  {selectedSubtitleTrack.isHearingImpaired ? " · SDH" : ""}
                </p>
              )}
            </div>
          </div>
        </div>

        {subtitleLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            Loading subtitle cues...
          </div>
        )}

        {subtitleError && (
          <div className="border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {subtitleError}
          </div>
        )}
      </section>

      <section
        aria-disabled={styleControlsDisabled}
        className={cn(
          "space-y-3 border border-sidebar-border bg-[color-mix(in_oklch,var(--sidebar-accent)_56%,var(--sidebar))] p-3 transition-opacity",
          styleControlsDisabled && "opacity-65"
        )}
      >
        <EditorSubtitleStylePreview subtitleStyleSettings={subtitleStyleSettings} />

        <div className="flex items-start justify-between gap-3">
          <label className="min-w-0 flex-1 space-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
              Font
            </span>
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
              <SelectTrigger size="sm" className={compactSelectTriggerClassName()}>
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
                    Looking for installed fonts...
                  </div>
                )}
              </SelectContent>
            </Select>
          </label>

          <div className="max-w-36 text-[11px] text-muted-foreground">
            {styleControlsDisabled
              ? "Enable burn-in with a supported text track to tune the subtitle styling."
              : "Changes update the live preview and export together. Installed fonts appear when supported browsers allow them."}
          </div>
        </div>

        <div className="grid gap-3">
          <ColorControl
            label="Text Color"
            value={subtitleStyleSettings.fontColor}
            disabled={styleControlsDisabled}
            onChange={(value) => updateStyleSetting("fontColor", value)}
          />
          <ColorControl
            label="Shadow Color"
            value={subtitleStyleSettings.shadowColor}
            disabled={styleControlsDisabled}
            onChange={(value) => updateStyleSetting("shadowColor", value)}
          />
          <ColorControl
            label="Stroke Color"
            value={subtitleStyleSettings.strokeColor}
            disabled={styleControlsDisabled}
            onChange={(value) => updateStyleSetting("strokeColor", value)}
          />
        </div>

        <div className="space-y-3">
          <NumberSlider
            label="Font Size"
            value={subtitleStyleSettings.fontSize}
            min={16}
            max={96}
            step={1}
            unit="px"
            disabled={styleControlsDisabled}
            onChange={(value) => updateStyleSetting("fontSize", value)}
          />
          <NumberSlider
            label="Shadow Blur"
            value={subtitleStyleSettings.shadowBlur}
            min={0}
            max={24}
            step={1}
            unit="px"
            disabled={styleControlsDisabled}
            onChange={(value) => updateStyleSetting("shadowBlur", value)}
          />
          <NumberSlider
            label="Shadow Offset"
            value={subtitleStyleSettings.shadowOffsetY}
            min={-16}
            max={24}
            step={1}
            unit="px"
            disabled={styleControlsDisabled}
            onChange={(value) => updateStyleSetting("shadowOffsetY", value)}
          />
          <NumberSlider
            label="Stroke Width"
            value={subtitleStyleSettings.strokeWidth}
            min={0}
            max={12}
            step={0.5}
            unit="px"
            disabled={styleControlsDisabled}
            onChange={(value) => updateStyleSetting("strokeWidth", value)}
          />
          <NumberSlider
            label="Bottom Margin"
            value={subtitleStyleSettings.bottomMargin}
            min={0}
            max={180}
            step={1}
            unit="px"
            disabled={styleControlsDisabled}
            onChange={(value) => updateStyleSetting("bottomMargin", value)}
          />
        </div>
      </section>
    </div>
  );
}
