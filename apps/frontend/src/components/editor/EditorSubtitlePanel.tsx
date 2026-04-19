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
import { subtitleTrackSupportsBurnIn } from "../../lib/selectPreferredSubtitleTrack";
import { SUBTITLE_FONT_OPTIONS } from "../../lib/subtitles/settings";
import type { SubtitleStyleSettings } from "../../lib/subtitles/types";
import type { PlaybackSubtitleTrack } from "../../providers/types";

interface EditorSubtitlePanelProps {
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
  return "h-8 w-full min-w-0 rounded-md border-border bg-background px-2.5 text-xs font-medium shadow-none focus-visible:ring-2";
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
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
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
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary"
      />
    </label>
  );
}

function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
          aria-label={label}
        />
        <span className="font-mono text-xs text-foreground">{value.toUpperCase()}</span>
      </div>
    </label>
  );
}

export function EditorSubtitlePanel({
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
  const subtitleStatus = subtitleTracks.length === 0
    ? "No subtitle tracks were exposed by this provider for the active session."
    : !selectedSubtitleTrack
      ? "Choose a subtitle track to preview and burn it into the clip."
      : canEnableBurnIn
        ? "Text subtitle track ready for styled burn-in."
        : "This subtitle track exists, but it is not yet supported for styled burn-in.";

  const previewSampleStyle = {
    fontFamily: subtitleStyleSettings.fontFamily,
    color: subtitleStyleSettings.fontColor,
    textShadow: `0 ${subtitleStyleSettings.shadowOffsetY}px ${subtitleStyleSettings.shadowBlur}px ${subtitleStyleSettings.shadowColor}`,
    WebkitTextStroke: `${subtitleStyleSettings.strokeWidth}px ${subtitleStyleSettings.strokeColor}`,
  };

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
    <section className="flex h-full min-h-0 flex-col border border-border bg-card text-card-foreground">
      <header className="border-b border-border px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-[var(--tracking-caps-md)] text-foreground">
              Subtitles
            </h2>
            <p className="text-xs text-muted-foreground">
              Pull provider subtitles into the editor and tune the burn-in styling.
            </p>
          </div>
          <label className={cn(
            "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)]",
            subtitlesEnabled && canEnableBurnIn
              ? "border-primary/35 bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground"
          )}>
            <input
              type="checkbox"
              checked={subtitlesEnabled}
              disabled={!canEnableBurnIn}
              onChange={(event) => onSubtitlesEnabledChange(event.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Burn In
          </label>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <section className="space-y-3 rounded-md border border-border bg-background/70 p-3">
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
            "rounded-md border px-3 py-2 text-xs",
            canEnableBurnIn
              ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300"
              : subtitleTracks.length === 0
                ? "border-border bg-muted/40 text-muted-foreground"
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
            <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {subtitleError}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-md border border-border bg-background/70 p-3">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
              Style Preview
            </div>
            <div className="rounded-md border border-border bg-[linear-gradient(180deg,rgba(7,10,18,0.65),rgba(7,10,18,0.9))] px-4 py-6 text-center">
              <div className="text-xl font-bold" style={previewSampleStyle}>
                This is what your subtitles will look like
              </div>
            </div>
          </div>

          <label className="space-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
              Font
            </span>
            <Select
              value={subtitleStyleSettings.fontFamily}
              onValueChange={(value) => updateStyleSetting("fontFamily", value)}
            >
              <SelectTrigger size="sm" className={compactSelectTriggerClassName()}>
                <SelectValue placeholder="Select font" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Fonts</SelectLabel>
                  {SUBTITLE_FONT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <ColorControl
              label="Text Color"
              value={subtitleStyleSettings.fontColor}
              onChange={(value) => updateStyleSetting("fontColor", value)}
            />
            <ColorControl
              label="Shadow Color"
              value={subtitleStyleSettings.shadowColor}
              onChange={(value) => updateStyleSetting("shadowColor", value)}
            />
            <ColorControl
              label="Stroke Color"
              value={subtitleStyleSettings.strokeColor}
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
              onChange={(value) => updateStyleSetting("fontSize", value)}
            />
            <NumberSlider
              label="Shadow Blur"
              value={subtitleStyleSettings.shadowBlur}
              min={0}
              max={24}
              step={1}
              unit="px"
              onChange={(value) => updateStyleSetting("shadowBlur", value)}
            />
            <NumberSlider
              label="Shadow Offset"
              value={subtitleStyleSettings.shadowOffsetY}
              min={-16}
              max={24}
              step={1}
              unit="px"
              onChange={(value) => updateStyleSetting("shadowOffsetY", value)}
            />
            <NumberSlider
              label="Stroke Width"
              value={subtitleStyleSettings.strokeWidth}
              min={0}
              max={12}
              step={0.5}
              unit="px"
              onChange={(value) => updateStyleSetting("strokeWidth", value)}
            />
            <NumberSlider
              label="Bottom Margin"
              value={subtitleStyleSettings.bottomMargin}
              min={0}
              max={180}
              step={1}
              unit="px"
              onChange={(value) => updateStyleSetting("bottomMargin", value)}
            />
          </div>
        </section>
      </div>
    </section>
  );
}
