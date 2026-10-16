import { Info } from "lucide-react";
import { memo, type ReactNode } from "react";

import type { MediaDimensions } from "#/components/editor/editorMedia";
import {
  gifPresetOptionFor,
  resolutionOptionFor,
  resolutionOptions,
} from "#/components/export/exportOptions";
import {
  exportHelperTextClassName,
  ExportSectionHeader,
} from "#/components/export/ExportSectionHeader";
import { fieldLabelWideClasses } from "#/components/ui/control-styles";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import type { audioBitDepthSummary } from "#/lib/export/exportAudio";
import type { ExportFormat, ExportResolution } from "#/lib/export/exportClip";
import {
  exportFormatFor,
  exportFormats,
  type ExportMode,
  type ExportOutputType,
} from "#/lib/export/exportFormats";
import {
  exportQualityDescriptionFor,
  exportQualityOptionsForFormat,
  type ExportQualityPreset,
} from "#/lib/export/exportTypes";
interface ExportSettingsSectionProperties {
  children?: ReactNode;
  selectedFormat: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  selectedQuality: ExportQualityPreset;
  onQualityChange: (quality: ExportQualityPreset) => void;
  outputDimensions: MediaDimensions | null;
  selectedResolution: ExportResolution;
  onResolutionChange: (resolution: ExportResolution) => void;
  mode: ExportMode;
  onOutputTypeChange: (outputType: ExportOutputType) => void;
  onVideoMutedChange: (muted: boolean) => void;
  mixDownToStereo: boolean;
  onMixDownToStereoChange: (mixdown: boolean) => void;
  audioDisabledReason?: string | null;
  audioBitDepth: ReturnType<typeof audioBitDepthSummary>;
}

function ExportSettingsSectionComponent({
  children,
  selectedFormat,
  onFormatChange,
  selectedQuality,
  onQualityChange,
  outputDimensions,
  selectedResolution,
  onResolutionChange,
  mode,
  onOutputTypeChange,
  onVideoMutedChange,
  mixDownToStereo,
  onMixDownToStereoChange,
  audioDisabledReason,
  audioBitDepth,
}: ExportSettingsSectionProperties) {
  const qualityOptions = exportQualityOptionsForFormat(selectedFormat);
  const gif = selectedFormat === "gif";
  const showMute = mode !== "audio-only" && !gif;
  let outputType: ExportOutputType = "video";
  if (gif) {
    outputType = "gif";
  } else if (mode === "audio-only") {
    outputType = "audio";
  }
  const showBitDepth = selectedFormat === "flac" || selectedFormat === "wav";

  return (
    <section className="rounded-md border border-border bg-card">
      <ExportSectionHeader>Export Settings</ExportSectionHeader>
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-x-3 sm:col-span-2">
          <div className="space-y-1.5">
            <span className={fieldLabelWideClasses}>Export</span>
            <Select
              value={outputType}
              items={{ video: "Video", audio: "Audio", gif: "GIF" }}
              onValueChange={(value) => {
                if (value !== null) {
                  onOutputTypeChange(value);
                }
              }}
            >
              <SelectTrigger size="sm" aria-label="Export mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="audio">Audio</SelectItem>
                <SelectItem value="gif">GIF</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label
            className={`flex h-8 items-center gap-2 self-end text-sm ${showMute ? "" : "invisible"}`}
            aria-hidden={!showMute}
            inert={!showMute}
          >
            <Switch
              checked={mode === "video-only"}
              disabled={!showMute}
              onCheckedChange={onVideoMutedChange}
              aria-label="Mute audio"
            />
            Mute audio
          </label>
        </div>
        {!gif && (
          <label
            className={
              mode === "audio-only" && !showBitDepth
                ? "space-y-1.5 sm:col-span-2"
                : "space-y-1.5"
            }
          >
            <span className={fieldLabelWideClasses}>Format</span>
            <Select
              value={selectedFormat}
              items={exportFormats.map((option) => ({
                value: option.value,
                label: `${option.label} ${option.extension}`,
              }))}
              onValueChange={(value) => {
                if (value !== null) {
                  onFormatChange(value);
                }
              }}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                {(mode === "audio-only"
                  ? ["Lossy", "Lossless"]
                  : ["Video"]
                ).map((group) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {exportFormats
                      .filter((option) => option.group === group)
                      .map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label} {option.extension}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <p className={exportHelperTextClassName}>
              {exportFormatFor(selectedFormat).description}
            </p>
          </label>
        )}

        {showBitDepth && (
          <div
            className="space-y-1.5"
            role="group"
            aria-label="Automatic bit depth"
          >
            <div className="flex items-center gap-1.5">
              <span className={fieldLabelWideClasses}>Bit depth</span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Automatic bit depth details"
                      className="control-focus inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  }
                />
                <TooltipContent side="top" align="start">
                  Matches source precision where possible. Unknown bit depth
                  defaults to 24-bit; mixing uses at least 24-bit. Higher bit
                  depth adds no detail.
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex h-8 items-center text-sm font-medium">
              {audioBitDepth ? `${audioBitDepth.bits}-bit (automatic)` : "Auto"}
            </div>
            <p className={exportHelperTextClassName}>
              {audioBitDepth?.reason ?? "Based on source and channel mixing."}
            </p>
          </div>
        )}

        {mode !== "audio-only" && (
          <>
            <div className="space-y-1.5">
              <span className={fieldLabelWideClasses}>Quality</span>
              <Select
                value={selectedQuality}
                items={qualityOptions}
                onValueChange={(value) => {
                  if (value !== null) {
                    onQualityChange(value);
                  }
                }}
              >
                <SelectTrigger size="sm" aria-label="Export quality">
                  <SelectValue placeholder="Select quality" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Quality</SelectLabel>
                    {qualityOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className={exportHelperTextClassName}>
                {exportQualityDescriptionFor(selectedFormat, selectedQuality)}
              </p>
            </div>

            {gif ? (
              <div
                className="space-y-1.5"
                role="group"
                aria-label="GIF dimensions"
              >
                <div className={fieldLabelWideClasses}>Dimensions</div>
                <div className="flex h-8 items-center text-sm font-medium">
                  {outputDimensions
                    ? `${outputDimensions.width} × ${outputDimensions.height}`
                    : "Determined from source"}
                </div>
                <p className={exportHelperTextClassName}>
                  Up to {gifPresetOptionFor(selectedQuality).settings.maxHeight}
                  p. Smaller sources unchanged.
                </p>
              </div>
            ) : (
              <label className="space-y-1.5">
                <span className={fieldLabelWideClasses}>Resolution</span>
                <Select
                  value={selectedResolution}
                  items={resolutionOptions}
                  onValueChange={(value) => {
                    if (value !== null) {
                      onResolutionChange(value);
                    }
                  }}
                >
                  <SelectTrigger size="sm">
                    <SelectValue placeholder="Select resolution" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Resolutions</SelectLabel>
                      {resolutionOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className={exportHelperTextClassName}>
                  {resolutionOptionFor(selectedResolution).description}
                </p>
              </label>
            )}
          </>
        )}

        {children}

        <div
          className={`space-y-1.5 sm:col-span-2 ${mode === "video-only" ? "invisible" : ""}`}
          aria-hidden={mode === "video-only"}
          inert={mode === "video-only"}
        >
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={mixDownToStereo}
              disabled={Boolean(audioDisabledReason)}
              onCheckedChange={onMixDownToStereoChange}
              aria-label="Mix down to stereo"
            />
            Mix down to stereo
          </label>
          <p className={exportHelperTextClassName}>
            {audioDisabledReason ??
              (mixDownToStereo
                ? "Mixes surround to stereo. Mono unchanged."
                : "Keeps source channels.")}
          </p>
        </div>
      </div>
    </section>
  );
}

export const ExportSettingsSection = memo(ExportSettingsSectionComponent);
