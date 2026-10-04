import type { audioBitDepthSummary, ExportAudioPlan } from "#/lib/exportAudio";
import { Switch } from "#/components/ui/switch";
import {
  isAudioExportFormat,
  exportIncludesAudio,
  exportFormatFor,
  exportFormats,
  type ExportMode,
  type ExportOutputType,
} from "#/lib/exportFormats";
import { memo } from "react";
import { Info } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import type {
  ExportPhase,
  ExportFormat,
  ExportResolution,
} from "#/lib/exportClip";
import {
  formatExportSizeEstimate,
  type ExportSizeEstimate,
  exportQualityDescriptionFor,
  exportQualityOptionFor,
  exportQualityOptionsForFormat,
  gifExportPresetOptions,
  type ExportQualityPreset,
  type GifExportPreset,
  type GifExportSettings,
} from "#/lib/exportTypes";
import {
  getExportFileNameTemplateTokens,
  type ExportFileNameTemplateKind,
  type ExportFileNameTemplateSettings,
} from "#/lib/exportFileName";
import type { ExportSourcePreference } from "#/components/editor/EditorExportDialog";
import { fieldLabelWideClasses } from "#/components/ui/control-styles";
import { formatTime } from "#/components/editor/editorUtilities";
import type { MediaDimensions } from "#/lib/editorMedia";

interface ExportOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

const resolutionOptions: ReadonlyArray<ExportOption<ExportResolution>> = [
  {
    value: "original",
    label: "Original",
    description: "Keeps the source dimensions when possible.",
  },
  {
    value: "1080",
    label: "1080p",
    description: "Balanced delivery size for full HD exports.",
  },
  {
    value: "720",
    label: "720p",
    description: "Lighter output for faster downloads and sharing.",
  },
];

const templateOptions: ReadonlyArray<{
  kind: ExportFileNameTemplateKind;
  label: string;
  description: string;
}> = [
  {
    kind: "movie",
    label: "Movies",
    description: "Used for films and non-episode items.",
  },
  {
    kind: "episode",
    label: "TV Shows",
    description: "Used for episode exports with series metadata.",
  },
];

const stableHelperTextClassName =
  "min-h-9 text-xs leading-relaxed text-muted-foreground";

function resolutionOptionFor(resolution: ExportResolution) {
  return (
    resolutionOptions.find((option) => option.value === resolution) ??
    resolutionOptions[0]
  );
}

function gifPresetOptionFor(preset: GifExportPreset) {
  return (
    gifExportPresetOptions.find((option) => option.value === preset) ??
    gifExportPresetOptions[0]
  );
}

function sourceOptionsFor(labels: {
  directSourceLabel: string;
  hlsSourceLabel: string;
}): ReadonlyArray<ExportOption<ExportSourcePreference>> {
  return [
    {
      value: "auto",
      label: "Auto",
      description: "Chooses the best available path.",
    },
    {
      value: "direct",
      label: labels.directSourceLabel,
      description: "Uses direct media when available.",
    },
    {
      value: "hls",
      label: labels.hlsSourceLabel,
      description: "Uses the playback stream.",
    },
  ];
}

function sourceOptionFor(
  preference: ExportSourcePreference,
  labels: { directSourceLabel: string; hlsSourceLabel: string },
) {
  const sourceOptions = sourceOptionsFor(labels);
  return (
    sourceOptions.find((option) => option.value === preference) ??
    sourceOptions[0]
  );
}

function templateOptionFor(kind: ExportFileNameTemplateKind) {
  return (
    templateOptions.find((option) => option.kind === kind) ?? templateOptions[0]
  );
}

function SectionHeader({ children }: { children: string }) {
  return (
    <div className="border-b border-border px-3 py-2">
      <div className={fieldLabelWideClasses}>{children}</div>
    </div>
  );
}

interface EditorExportSettingsSectionProperties {
  selectedFormat: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  selectedQuality: ExportQualityPreset;
  onQualityChange: (quality: ExportQualityPreset) => void;
  outputDimensions: MediaDimensions | null;
  selectedResolution: ExportResolution;
  onResolutionChange: (resolution: ExportResolution) => void;
  selectedSourcePreference?: ExportSourcePreference;
  onSourcePreferenceChange?: (preference: ExportSourcePreference) => void;
  mode: ExportMode;
  onOutputTypeChange: (outputType: ExportOutputType) => void;
  onVideoMutedChange: (muted: boolean) => void;
  mixDownToStereo: boolean;
  onMixDownToStereoChange: (mixdown: boolean) => void;
  audioDisabledReason?: string | null;
  audioBitDepth: ReturnType<typeof audioBitDepthSummary>;
  showSourcePreference?: boolean;
  hasHlsSource?: boolean;
  hasDirectSource?: boolean;
  directSourceLabel?: string;
  hlsSourceLabel?: string;
}

function EditorExportSettingsSectionComponent({
  selectedFormat,
  onFormatChange,
  selectedQuality,
  onQualityChange,
  outputDimensions,
  selectedResolution,
  onResolutionChange,
  selectedSourcePreference,
  onSourcePreferenceChange,
  mode,
  onOutputTypeChange,
  onVideoMutedChange,
  mixDownToStereo,
  onMixDownToStereoChange,
  audioDisabledReason,
  audioBitDepth,
  showSourcePreference = true,
  hasHlsSource = false,
  hasDirectSource = false,
  directSourceLabel = "Direct source",
  hlsSourceLabel = "HLS stream",
}: EditorExportSettingsSectionProperties) {
  const sourceOptions = sourceOptionsFor({ directSourceLabel, hlsSourceLabel });
  const qualityOptions = exportQualityOptionsForFormat(selectedFormat);
  const activeSourcePreference = selectedSourcePreference ?? "auto";
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
      <SectionHeader>Export Settings</SectionHeader>
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
            <p className={stableHelperTextClassName}>
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
            <p className={stableHelperTextClassName}>
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
              <p className={stableHelperTextClassName}>
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
                <p className={stableHelperTextClassName}>
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
                <p className={stableHelperTextClassName}>
                  {resolutionOptionFor(selectedResolution).description}
                </p>
              </label>
            )}
          </>
        )}

        {showSourcePreference && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className={fieldLabelWideClasses}>Source</span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Export source details"
                      className="control-focus inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  }
                />
                <TooltipContent side="top" align="start">
                  Chooses the media path used for export.
                </TooltipContent>
              </Tooltip>
            </div>
            <Select
              value={activeSourcePreference}
              items={sourceOptions}
              onValueChange={(value) => {
                if (value !== null) {
                  onSourcePreferenceChange?.(value);
                }
              }}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="Select source" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Sources</SelectLabel>
                  {sourceOptions.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      disabled={
                        (option.value === "direct" && !hasDirectSource) ||
                        (option.value === "hls" && !hasHlsSource)
                      }
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className={stableHelperTextClassName}>
              {
                sourceOptionFor(activeSourcePreference, {
                  directSourceLabel,
                  hlsSourceLabel,
                }).description
              }
            </p>
          </div>
        )}

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
          <p className={stableHelperTextClassName}>
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

export const EditorExportSettingsSection = memo(
  EditorExportSettingsSectionComponent,
);

interface EditorFilenameTemplateSectionProperties {
  editingTemplateKind: ExportFileNameTemplateKind;
  onEditingTemplateKindChange: (kind: ExportFileNameTemplateKind) => void;
  fileNameTemplates: ExportFileNameTemplateSettings;
  onFileNameTemplateChange: (
    kind: ExportFileNameTemplateKind,
    template: string,
  ) => void;
  onResetFileNameTemplate: (kind: ExportFileNameTemplateKind) => void;
}

function EditorFilenameTemplateSectionComponent({
  editingTemplateKind,
  onEditingTemplateKindChange,
  fileNameTemplates,
  onFileNameTemplateChange,
  onResetFileNameTemplate,
}: EditorFilenameTemplateSectionProperties) {
  const editingTemplateOption = templateOptionFor(editingTemplateKind);
  const visibleTokens = getExportFileNameTemplateTokens(editingTemplateKind);

  return (
    <section className="rounded-md border border-border bg-card">
      <SectionHeader>Filename Template</SectionHeader>
      <div className="space-y-3 p-3">
        <div className="grid gap-3 sm:grid-cols-editor-export-template sm:items-end">
          <label className="space-y-1.5">
            <span className={fieldLabelWideClasses}>Template Set</span>
            <Select
              value={editingTemplateKind}
              items={templateOptions.map((option) => ({
                value: option.kind,
                label: option.label,
              }))}
              onValueChange={(value) => {
                if (value !== null) {
                  onEditingTemplateKindChange(value);
                }
              }}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="Select template set" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Templates</SelectLabel>
                  {templateOptions.map((option) => (
                    <SelectItem key={option.kind} value={option.kind}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>

          <button
            type="button"
            onClick={() => onResetFileNameTemplate(editingTemplateKind)}
            className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Reset
          </button>
        </div>

        <label className="block space-y-1.5">
          <span className={fieldLabelWideClasses}>Pattern</span>
          <input
            type="text"
            value={fileNameTemplates[editingTemplateKind]}
            onChange={(event) =>
              onFileNameTemplateChange(editingTemplateKind, event.target.value)
            }
            className="control-focus h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground outline-none transition-colors focus-visible:border-ring"
            spellCheck={false}
          />
        </label>

        <p className={stableHelperTextClassName}>
          {editingTemplateOption.description}
        </p>

        <div className="rounded-md border border-border bg-background px-3 py-2">
          <div className={fieldLabelWideClasses}>Available Tokens</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {visibleTokens.map((token) => (
              <code
                key={token}
                className="rounded-md border border-border bg-card px-2 py-0.5 font-mono text-ui-label text-foreground"
              >
                {`{${token}}`}
              </code>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export const EditorFilenameTemplateSection = memo(
  EditorFilenameTemplateSectionComponent,
);

interface EditorExportSummaryPanelProperties {
  title: string;
  clipStart: number;
  clipEnd: number;
  selectedFormat: ExportFormat;
  selectedQuality: ExportQualityPreset;
  gifSettings?: GifExportSettings | null;
  outputDimensions: MediaDimensions | null;
  exportSourceLabel?: string;
  exportSourceSummaryMessage?: string | null;
  mode: ExportMode;
  audioStatus: string;
  audioPlan: ExportAudioPlan | null;
  showClipSummary?: boolean;
  showSourceSummary?: boolean;
  showSubtitleSummary?: boolean;
  showFilenameSummary?: boolean;
  subtitleSummaryLabel?: string;
  subtitleSummaryDetail?: string;
  subtitleSummaryTone?: "muted" | "ready" | "warning";
  activeTemplateKind?: ExportFileNameTemplateKind;
  filenameTemplateLabel?: string | null;
  fileNamePreview?: string;
}

function EditorExportSummaryPanelComponent({
  title,
  clipStart,
  clipEnd,
  selectedFormat,
  selectedQuality,
  gifSettings,
  outputDimensions,
  exportSourceLabel = "Auto",
  exportSourceSummaryMessage = null,
  mode,
  audioStatus,
  audioPlan,
  showClipSummary = true,
  showSourceSummary = true,
  showSubtitleSummary = true,
  showFilenameSummary = true,
  subtitleSummaryLabel = "Not included",
  subtitleSummaryDetail = "No supported subtitles found.",
  subtitleSummaryTone = "muted",
  activeTemplateKind = "movie",
  filenameTemplateLabel,
  fileNamePreview = "",
}: EditorExportSummaryPanelProperties) {
  const clipLength = Math.max(0, clipEnd - clipStart);
  const selectedFormatOption = exportFormatFor(selectedFormat);
  const audioOnly = isAudioExportFormat(selectedFormat);
  let outputDetail = `${exportQualityOptionFor(selectedQuality).label} quality`;
  if (selectedFormat === "gif" && gifSettings) {
    outputDetail = `${gifPresetOptionFor(gifSettings.preset).label} GIF / ${gifSettings.frameRate} fps`;
  }
  let subtitleSummaryClassName = "border-border bg-background";
  if (subtitleSummaryTone === "ready") {
    subtitleSummaryClassName = "border-status-ready-border bg-status-ready";
  } else if (subtitleSummaryTone === "warning") {
    subtitleSummaryClassName = "border-status-warning-border bg-status-warning";
  }
  let displayedFilenameTemplateLabel = filenameTemplateLabel;
  if (filenameTemplateLabel === undefined) {
    displayedFilenameTemplateLabel =
      activeTemplateKind === "episode" ? "TV show template" : "Movie template";
  }

  return (
    <aside className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="border-b border-border pb-2">
        <div className={fieldLabelWideClasses}>Summary</div>
      </div>

      <div className="text-sm font-medium text-foreground">{title}</div>

      <dl className="grid gap-2 text-sm">
        {showClipSummary && (
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <dt className={fieldLabelWideClasses}>Clip</dt>
            <dd className="mt-1 font-mono text-xs text-foreground">
              {formatTime(clipStart)} to {formatTime(clipEnd)}
            </dd>
          </div>
        )}

        <div className="rounded-md border border-border bg-background px-3 py-2">
          <dt className={fieldLabelWideClasses}>Duration</dt>
          <dd className="mt-1 font-mono text-xs text-foreground">
            {formatTime(clipLength)}
          </dd>
        </div>

        {showSourceSummary && (
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <dt className={fieldLabelWideClasses}>Source</dt>
            <dd className="mt-1 text-xs text-foreground">
              {exportSourceLabel}
            </dd>
            {exportSourceSummaryMessage && (
              <dd className="mt-1 text-ui-label text-muted-foreground">
                {exportSourceSummaryMessage}
              </dd>
            )}
          </div>
        )}

        <div className="rounded-md border border-border bg-background px-3 py-2">
          <dt className={fieldLabelWideClasses}>Output</dt>
          <dd className="mt-1 text-xs text-foreground">
            {selectedFormatOption.label}
          </dd>
          {!audioOnly && (
            <dd className="mt-1 font-mono text-ui-label text-foreground">
              {outputDimensions
                ? `${outputDimensions.width} x ${outputDimensions.height}`
                : "Unknown size"}
            </dd>
          )}
          {audioOnly ? (
            <dd className="mt-2">
              <ExportAudioDetails
                plan={audioPlan}
                status={audioStatus}
                showCodec={selectedFormat === "wav"}
              />
            </dd>
          ) : (
            <dd className="mt-1 text-ui-label text-muted-foreground">
              {outputDetail}
            </dd>
          )}
        </div>

        {!audioOnly && selectedFormat !== "gif" && (
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <dt className={fieldLabelWideClasses}>Audio</dt>
            <dd className="mt-2">
              <ExportAudioDetails
                plan={audioPlan}
                status={
                  exportIncludesAudio(mode, selectedFormat)
                    ? audioStatus
                    : "Video only"
                }
                showCodec
              />
            </dd>
          </div>
        )}

        {showSubtitleSummary && !audioOnly && (
          <div
            className={`rounded-md border px-3 py-2 ${subtitleSummaryClassName}`}
          >
            <dt className={fieldLabelWideClasses}>Subtitles</dt>
            <dd className="mt-1 text-xs font-medium text-foreground">
              {subtitleSummaryLabel}
            </dd>
            <dd className="mt-1 text-ui-label text-muted-foreground">
              {subtitleSummaryDetail}
            </dd>
          </div>
        )}

        {showFilenameSummary && (
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <dt className={fieldLabelWideClasses}>Filename</dt>
            {displayedFilenameTemplateLabel ? (
              <dd className="mt-1 text-ui-label font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground">
                {displayedFilenameTemplateLabel}
              </dd>
            ) : null}
            <dd className="mt-1 break-all font-mono text-ui-label text-foreground">
              {fileNamePreview}
            </dd>
          </div>
        )}
      </dl>
    </aside>
  );
}

export const EditorExportSummaryPanel = memo(EditorExportSummaryPanelComponent);

function ExportAudioDetails({
  plan,
  status,
  showCodec,
}: {
  plan: ExportAudioPlan | null;
  status: string;
  showCodec: boolean;
}) {
  if (!plan) {
    return <p className="text-xs text-muted-foreground">{status}</p>;
  }
  const details: Array<readonly [string, string]> = [];
  if (showCodec) {
    let codec = plan.codec === "opus" ? "Opus" : plan.codec.toUpperCase();
    if (plan.codec.startsWith("pcm-")) {
      codec = plan.codec === "pcm-f32" ? "PCM (float)" : "PCM";
    }
    details.push(["Codec", codec]);
  }
  details.push(
    [
      "Channels",
      { 1: "Mono", 2: "Stereo" }[plan.numberOfChannels] ??
        `${plan.numberOfChannels} channels`,
    ],
    ["Sample rate", `${plan.sampleRate / 1000} kHz`],
  );
  if (plan.bits !== null) {
    details.push(["Bit depth", `${plan.bits}-bit`]);
  } else if (plan.bitrate !== undefined) {
    details.push(["Bitrate", `${plan.bitrate / 1000} kbps`]);
  }
  return (
    <>
      <dl className="space-y-1 text-xs">
        {details.map(([label, value]) => (
          <div
            key={label}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {plan.sampleRate !== plan.source.sampleRate && (
        <p className="mt-2 text-xs text-muted-foreground">
          Resampled from {plan.source.sampleRate / 1000} kHz.
        </p>
      )}
    </>
  );
}

function ExportMemoryGuidance({ bytes }: { bytes: number | null }) {
  return bytes !== null && bytes >= 100 * 1024 * 1024 ? (
    <p className="mt-1 text-xs text-muted-foreground">
      Large export uses browser memory. Shorter clips use less.
    </p>
  ) : null;
}

export function ExportStatusPanel({
  estimate,
  exporting,
  phase,
  progress,
  notice,
  error,
  disabledReason,
}: {
  estimate: ExportSizeEstimate;
  exporting: boolean;
  phase: ExportPhase;
  progress: number;
  notice: string | null;
  error: string | null;
  disabledReason?: string | null;
}) {
  const phaseLabel = {
    preparing: "Preparing media…",
    encoding: `Encoding: ${Math.round(progress * 100)}%`,
    finalizing: "Finalizing file…",
  }[phase];
  const message = exporting ? phaseLabel : (error ?? disabledReason ?? notice);
  return (
    <div className="h-28 min-w-0 overflow-y-auto self-stretch sm:h-20 sm:flex-1">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
        <span className="text-muted-foreground">Estimated size</span>
        <span className="font-mono tabular-nums text-foreground">
          {formatExportSizeEstimate(estimate)}
        </span>
      </div>
      <div
        role="status"
        className={`mt-1 wrap-anywhere text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
      >
        {message}
      </div>
      <ExportMemoryGuidance bytes={estimate.bytes} />
    </div>
  );
}
