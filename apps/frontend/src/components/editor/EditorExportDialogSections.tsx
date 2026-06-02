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
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ExportFormat, ExportResolution } from "@/lib/exportClip";
import {
  gifExportPresetOptions,
  type GifExportPreset,
  type GifExportSettings,
} from "@/lib/exportTypes";
import {
  getExportFileNameTemplateTokens,
  type ExportFileNameTemplateKind,
  type ExportFileNameTemplateSettings,
} from "@/lib/exportFileName";
import { cn } from "@/lib/utils";
import type { ExportSourcePreference } from "@/components/editor/EditorExportDialog";
import {
  compactSelectTriggerClassName,
  sectionLabelClassName,
} from "@/components/editor/editorDialogStyles";
import { formatTime } from "@/components/editor/editorUtils";

interface VideoDimensions {
  width: number;
  height: number;
}

interface ExportOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

const formatOptions: ReadonlyArray<
  ExportOption<ExportFormat> & {
    extension: string;
  }
> = [
  {
    value: "mp4",
    label: "MP4",
    extension: ".mp4",
    description: "Best for sharing and uploads.",
  },
  {
    value: "webm",
    label: "WEBM",
    extension: ".webm",
    description: "Modern animated web playback.",
  },
  {
    value: "gif",
    label: "GIF",
    extension: ".gif",
    description: "Animated image export for short clips.",
  },
  {
    value: "mov",
    label: "MOV",
    extension: ".mov",
    description: "Good for editing workflows.",
  },
  {
    value: "mkv",
    label: "MKV",
    extension: ".mkv",
    description: "Flexible container support.",
  },
];

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

export function formatOptionFor(format: ExportFormat) {
  return (
    formatOptions.find((option) => option.value === format) ?? formatOptions[0]
  );
}

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
      <div className={sectionLabelClassName()}>{children}</div>
    </div>
  );
}

interface EditorExportSettingsSectionProps {
  selectedFormat: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  selectedGifPreset: GifExportPreset;
  onGifPresetChange: (preset: GifExportPreset) => void;
  selectedResolution: ExportResolution;
  onResolutionChange: (resolution: ExportResolution) => void;
  selectedSourcePreference: ExportSourcePreference;
  onSourcePreferenceChange: (preference: ExportSourcePreference) => void;
  includeAudio: boolean;
  onIncludeAudioChange: (includeAudio: boolean) => void;
  audioDisabledReason?: string | null;
  hasHlsSource: boolean;
  hasDirectSource: boolean;
  directSourceLabel: string;
  hlsSourceLabel: string;
}

function EditorExportSettingsSectionComponent({
  selectedFormat,
  onFormatChange,
  selectedGifPreset,
  onGifPresetChange,
  selectedResolution,
  onResolutionChange,
  selectedSourcePreference,
  onSourcePreferenceChange,
  includeAudio,
  onIncludeAudioChange,
  audioDisabledReason,
  hasHlsSource,
  hasDirectSource,
  directSourceLabel,
  hlsSourceLabel,
}: EditorExportSettingsSectionProps) {
  const sourceOptions = sourceOptionsFor({ directSourceLabel, hlsSourceLabel });
  const selectedGifPresetOption = gifPresetOptionFor(selectedGifPreset);

  return (
    <section className="rounded-md border border-border bg-card">
      <SectionHeader>Export Settings</SectionHeader>
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className={sectionLabelClassName()}>Format</span>
          <Select
            value={selectedFormat}
            onValueChange={(value) => onFormatChange(value as ExportFormat)}
          >
            <SelectTrigger
              size="sm"
              className={compactSelectTriggerClassName()}
            >
              <SelectValue placeholder="Select format" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Formats</SelectLabel>
                {formatOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} {option.extension}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className={stableHelperTextClassName}>
            {formatOptionFor(selectedFormat).description}
          </p>
        </label>

        <label className="space-y-1.5">
          <span className={sectionLabelClassName()}>Resolution</span>
          <Select
            value={selectedResolution}
            onValueChange={(value) =>
              onResolutionChange(value as ExportResolution)
            }
          >
            <SelectTrigger
              size="sm"
              className={compactSelectTriggerClassName()}
            >
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

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className={sectionLabelClassName()}>Source</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Export source details"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" align="start">
                Chooses the media path used for export.
              </TooltipContent>
            </Tooltip>
          </div>
          <Select
            value={selectedSourcePreference}
            onValueChange={(value) =>
              onSourcePreferenceChange(value as ExportSourcePreference)
            }
          >
            <SelectTrigger
              size="sm"
              className={compactSelectTriggerClassName()}
            >
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
              sourceOptionFor(selectedSourcePreference, {
                directSourceLabel,
                hlsSourceLabel,
              }).description
            }
          </p>
        </div>

        <label className="space-y-1.5">
          <span className={sectionLabelClassName()}>Audio</span>
          <Select
            value={includeAudio ? "included" : "video-only"}
            disabled={Boolean(audioDisabledReason)}
            onValueChange={(value) =>
              onIncludeAudioChange(value === "included")
            }
          >
            <SelectTrigger
              size="sm"
              className={compactSelectTriggerClassName()}
            >
              <SelectValue placeholder="Select audio option" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Audio</SelectLabel>
                <SelectItem value="included">Include Audio</SelectItem>
                <SelectItem value="video-only">Video Only</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className={stableHelperTextClassName}>
            {audioDisabledReason ??
              (includeAudio
                ? "Keeps a stereo mix when source audio exists."
                : "Exports without an audio track.")}
          </p>
        </label>
      </div>
      {selectedFormat === "gif" && (
        <div className="border-t border-border px-3 py-3">
          <div className="space-y-1.5">
            <span className={sectionLabelClassName()}>GIF Preset</span>
            <div
              role="radiogroup"
              aria-label="GIF Preset"
              className="grid grid-cols-3 gap-1 rounded-md border border-border bg-background p-1"
            >
              {gifExportPresetOptions.map((option) => {
                const isSelected = option.value === selectedGifPreset;

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => onGifPresetChange(option.value)}
                    className={cn(
                      "h-8 rounded-sm px-2 text-ui-label font-semibold uppercase tracking-[var(--tracking-caps-sm)] transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className={stableHelperTextClassName}>
              {selectedGifPresetOption.description}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export const EditorExportSettingsSection = memo(
  EditorExportSettingsSectionComponent,
);

interface EditorFilenameTemplateSectionProps {
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
}: EditorFilenameTemplateSectionProps) {
  const editingTemplateOption = templateOptionFor(editingTemplateKind);
  const visibleTokens = getExportFileNameTemplateTokens(editingTemplateKind);

  return (
    <section className="rounded-md border border-border bg-card">
      <SectionHeader>Filename Template</SectionHeader>
      <div className="space-y-3 p-3">
        <div className="grid gap-3 sm:grid-cols-editor-export-template sm:items-end">
          <label className="space-y-1.5">
            <span className={sectionLabelClassName()}>Template Set</span>
            <Select
              value={editingTemplateKind}
              onValueChange={(value) =>
                onEditingTemplateKindChange(value as ExportFileNameTemplateKind)
              }
            >
              <SelectTrigger
                size="sm"
                className={compactSelectTriggerClassName()}
              >
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
          <span className={sectionLabelClassName()}>Pattern</span>
          <input
            type="text"
            value={fileNameTemplates[editingTemplateKind]}
            onChange={(event) =>
              onFileNameTemplateChange(editingTemplateKind, event.target.value)
            }
            className="h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/40"
            spellCheck={false}
          />
        </label>

        <p className={stableHelperTextClassName}>
          {editingTemplateOption.description}
        </p>

        <div className="rounded-md border border-border bg-background px-3 py-2">
          <div className={sectionLabelClassName()}>Available Tokens</div>
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

interface EditorExportSummaryPanelProps {
  title: string;
  clipStart: number;
  clipEnd: number;
  selectedFormat: ExportFormat;
  gifSettings?: GifExportSettings | null;
  outputDimensions: VideoDimensions | null;
  exportSourceLabel: string;
  exportSourceSummaryMessage: string | null;
  includeAudio: boolean;
  subtitleSummaryLabel: string;
  subtitleSummaryDetail: string;
  subtitleSummaryTone: "muted" | "ready" | "warning";
  activeTemplateKind: ExportFileNameTemplateKind;
  fileNamePreview: string;
  estimatedSizeLabel: string;
}

function EditorExportSummaryPanelComponent({
  title,
  clipStart,
  clipEnd,
  selectedFormat,
  gifSettings,
  outputDimensions,
  exportSourceLabel,
  exportSourceSummaryMessage,
  includeAudio,
  subtitleSummaryLabel,
  subtitleSummaryDetail,
  subtitleSummaryTone,
  activeTemplateKind,
  fileNamePreview,
  estimatedSizeLabel,
}: EditorExportSummaryPanelProps) {
  const clipLength = Math.max(0, clipEnd - clipStart);
  const selectedFormatOption = formatOptionFor(selectedFormat);
  const outputDetail =
    selectedFormat === "gif" && gifSettings
      ? `${gifPresetOptionFor(gifSettings.preset).label} GIF / ${
          gifSettings.frameRate
        } fps`
      : null;
  const subtitleSummaryClassName =
    subtitleSummaryTone === "ready"
      ? "border-status-ready-border bg-status-ready"
      : subtitleSummaryTone === "warning"
        ? "border-status-warning-border bg-status-warning"
        : "border-border bg-background";

  return (
    <aside className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="border-b border-border pb-2">
        <div className={sectionLabelClassName()}>Summary</div>
      </div>

      <div className="text-sm font-medium text-foreground">{title}</div>

      <dl className="grid gap-2 text-sm">
        <div className="rounded-md border border-border bg-background px-3 py-2">
          <dt className={sectionLabelClassName()}>Clip</dt>
          <dd className="mt-1 font-mono text-xs text-foreground">
            {formatTime(clipStart)} to {formatTime(clipEnd)}
          </dd>
        </div>

        <div className="rounded-md border border-border bg-background px-3 py-2">
          <dt className={sectionLabelClassName()}>Duration</dt>
          <dd className="mt-1 font-mono text-xs text-foreground">
            {formatTime(clipLength)}
          </dd>
        </div>

        <div className="rounded-md border border-border bg-background px-3 py-2">
          <dt className={sectionLabelClassName()}>Source</dt>
          <dd className="mt-1 text-xs text-foreground">{exportSourceLabel}</dd>
          {exportSourceSummaryMessage && (
            <dd className="mt-1 text-ui-label text-muted-foreground">
              {exportSourceSummaryMessage}
            </dd>
          )}
        </div>

        <div className="rounded-md border border-border bg-background px-3 py-2">
          <dt className={sectionLabelClassName()}>Output</dt>
          <dd className="mt-1 text-xs text-foreground">
            {selectedFormatOption.label}
          </dd>
          <dd className="mt-1 font-mono text-ui-label text-foreground">
            {outputDimensions
              ? `${outputDimensions.width} x ${outputDimensions.height}`
              : "Unknown size"}
          </dd>
          {outputDetail && (
            <dd className="mt-1 text-ui-label text-muted-foreground">
              {outputDetail}
            </dd>
          )}
        </div>

        <div className="rounded-md border border-border bg-background px-3 py-2">
          <dt className={sectionLabelClassName()}>Audio</dt>
          <dd className="mt-1 text-xs text-foreground">
            {includeAudio ? "Included when available" : "Video only"}
          </dd>
        </div>

        <div
          className={`rounded-md border px-3 py-2 ${subtitleSummaryClassName}`}
        >
          <dt className={sectionLabelClassName()}>Subtitles</dt>
          <dd className="mt-1 text-xs font-medium text-foreground">
            {subtitleSummaryLabel}
          </dd>
          <dd className="mt-1 text-ui-label text-muted-foreground">
            {subtitleSummaryDetail}
          </dd>
        </div>

        <div className="rounded-md border border-border bg-background px-3 py-2">
          <dt className={sectionLabelClassName()}>Filename</dt>
          <dd className="mt-1 text-ui-label font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground">
            {activeTemplateKind === "episode"
              ? "TV show template"
              : "Movie template"}
          </dd>
          <dd className="mt-1 break-all font-mono text-ui-label text-foreground">
            {fileNamePreview}
          </dd>
        </div>

        <div className="rounded-md border border-border bg-background px-3 py-2">
          <dt className={sectionLabelClassName()}>Estimated size</dt>
          <dd className="mt-1 font-mono text-xs tabular-nums text-foreground">
            {estimatedSizeLabel}
          </dd>
        </div>
      </dl>
    </aside>
  );
}

export const EditorExportSummaryPanel = memo(EditorExportSummaryPanelComponent);
