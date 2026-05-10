import { Download, Info, X } from "lucide-react";
import { useEffect, useRef } from "react";
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
import type { ExportFormat, ExportResolution } from "../../lib/exportClip";
import {
  getExportFileNameTemplateTokens,
  type ExportFileNameTemplateKind,
  type ExportFileNameTemplateSettings,
} from "../../lib/exportFileName";
import { formatTime } from "./EditorUtils";

interface VideoDimensions {
  width: number;
  height: number;
}

export type ExportSourcePreference = "auto" | "direct" | "hls";

interface EditorExportDialogProps {
  isOpen: boolean;
  title: string;
  clipStart: number;
  clipEnd: number;
  selectedFormat: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  selectedResolution: ExportResolution;
  onResolutionChange: (resolution: ExportResolution) => void;
  selectedSourcePreference: ExportSourcePreference;
  onSourcePreferenceChange: (preference: ExportSourcePreference) => void;
  includeAudio: boolean;
  onIncludeAudioChange: (includeAudio: boolean) => void;
  exporting: boolean;
  progress: number;
  error: string | null;
  fileNamePreview: string;
  outputDimensions: VideoDimensions | null;
  hasHlsSource: boolean;
  hasDirectSource: boolean;
  exportSourceLabel: string;
  exportSourceMessage: string | null;
  exportSourceSummaryMessage: string | null;
  activeTemplateKind: ExportFileNameTemplateKind;
  editingTemplateKind: ExportFileNameTemplateKind;
  onEditingTemplateKindChange: (kind: ExportFileNameTemplateKind) => void;
  fileNameTemplates: ExportFileNameTemplateSettings;
  onFileNameTemplateChange: (kind: ExportFileNameTemplateKind, template: string) => void;
  onResetFileNameTemplate: (kind: ExportFileNameTemplateKind) => void;
  onClose: () => void;
  onExport: () => void;
}

const formatOptions: ReadonlyArray<{
  value: ExportFormat;
  label: string;
  extension: string;
  description: string;
}> = [
  {
    value: "mp4",
    label: "MP4",
    extension: ".mp4",
    description: "Best for everyday sharing, browser playback, and platform uploads.",
  },
  {
    value: "webm",
    label: "WEBM",
    extension: ".webm",
    description: "Modern web-first delivery with efficient browser-friendly playback.",
  },
  {
    value: "mov",
    label: "MOV",
    extension: ".mov",
    description: "A professional container that fits Adobe-style editorial workflows.",
  },
  {
    value: "mkv",
    label: "MKV",
    extension: ".mkv",
    description: "A flexible container for preserving a wider range of stream layouts.",
  },
];

const resolutionOptions: ReadonlyArray<{
  value: ExportResolution;
  label: string;
  description: string;
}> = [
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

const sourceOptions: ReadonlyArray<{
  value: ExportSourcePreference;
  label: string;
  description: string;
}> = [
  {
    value: "auto",
    label: "Auto",
    description: "Lets Cliparr choose the safest export path for this session.",
  },
  {
    value: "direct",
    label: "Direct/original",
    description: "Uses the direct media path when available, usually best for preserving source quality.",
  },
  {
    value: "hls",
    label: "HLS playback",
    description: "Uses the media server playback stream, which may include server-side transcoding.",
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

function compactSelectTriggerClassName() {
  return "h-8 w-full min-w-0 rounded-md border-border bg-background px-2.5 text-xs font-medium shadow-none focus-visible:ring-2";
}

export function EditorExportDialog({
  isOpen,
  title,
  clipStart,
  clipEnd,
  selectedFormat,
  onFormatChange,
  selectedResolution,
  onResolutionChange,
  selectedSourcePreference,
  onSourcePreferenceChange,
  includeAudio,
  onIncludeAudioChange,
  exporting,
  progress,
  error,
  fileNamePreview,
  outputDimensions,
  hasHlsSource,
  hasDirectSource,
  exportSourceLabel,
  exportSourceMessage,
  exportSourceSummaryMessage,
  activeTemplateKind,
  editingTemplateKind,
  onEditingTemplateKindChange,
  fileNameTemplates,
  onFileNameTemplateChange,
  onResetFileNameTemplate,
  onClose,
  onExport,
}: EditorExportDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const clipLength = Math.max(0, clipEnd - clipStart);
  const selectedFormatOption = formatOptions.find((option) => option.value === selectedFormat) ?? formatOptions[0];
  const selectedSourceOption = sourceOptions.find((option) => option.value === selectedSourcePreference) ?? sourceOptions[0];
  const editingTemplateOption = templateOptions.find((option) => option.kind === editingTemplateKind) ?? templateOptions[0];
  const visibleTokens = getExportFileNameTemplateTokens(editingTemplateKind);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    lastFocusedElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const frameId = window.requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!exporting) {
          onClose();
        }
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }

      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((element) => element.getAttribute("aria-hidden") !== "true");

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstFocusable = focusable[0];
      const lastFocusable = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey) {
        if (activeElement === firstFocusable || !dialog.contains(activeElement)) {
          event.preventDefault();
          lastFocusable?.focus();
        }
        return;
      }

      if (activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      lastFocusedElementRef.current?.focus();
    };
  }, [exporting, isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklch,var(--foreground)_40%,transparent)] p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => {
        if (!exporting) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cliparr-export-dialog-title"
        tabIndex={-1}
        className="mx-auto flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-b border-border bg-card px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 id="cliparr-export-dialog-title" className="text-sm font-semibold uppercase tracking-[var(--tracking-caps-md)] text-foreground">
                Export Clip
              </h2>
              <p className="text-xs text-muted-foreground">
                Configure export settings and review the output filename before download.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={exporting}
              aria-label="Close export dialog"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {exportSourceMessage && (
              <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-foreground">
                {exportSourceMessage}
              </div>
            )}

            <section className="rounded-md border border-border bg-card">
              <div className="border-b border-border px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
                  Export Settings
                </div>
              </div>
              <div className="grid gap-3 p-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
                    Format
                  </span>
                  <Select value={selectedFormat} onValueChange={(value) => onFormatChange(value as ExportFormat)}>
                    <SelectTrigger size="sm" className={compactSelectTriggerClassName()}>
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
                  <p className="text-xs text-muted-foreground">{selectedFormatOption.description}</p>
                </label>

                <label className="space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
                    Resolution
                  </span>
                  <Select value={selectedResolution} onValueChange={(value) => onResolutionChange(value as ExportResolution)}>
                    <SelectTrigger size="sm" className={compactSelectTriggerClassName()}>
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
                  <p className="text-xs text-muted-foreground">
                    {resolutionOptions.find((option) => option.value === selectedResolution)?.description}
                  </p>
                </label>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
                      Source
                    </span>
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
                        Track and timing detection can still use HLS metadata when Cliparr can read it. This only chooses which media path is used for the exported file.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Select
                    value={selectedSourcePreference}
                    onValueChange={(value) => onSourcePreferenceChange(value as ExportSourcePreference)}
                  >
                    <SelectTrigger size="sm" className={compactSelectTriggerClassName()}>
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
                              (option.value === "direct" && !hasDirectSource)
                              || (option.value === "hls" && !hasHlsSource)
                            }
                          >
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{selectedSourceOption.description}</p>
                </div>

                <label className="space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
                    Audio
                  </span>
                  <Select
                    value={includeAudio ? "included" : "video-only"}
                    onValueChange={(value) => onIncludeAudioChange(value === "included")}
                  >
                    <SelectTrigger size="sm" className={compactSelectTriggerClassName()}>
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
                  <p className="text-xs text-muted-foreground">
                    {includeAudio ? "Keeps a stereo mix when source audio exists." : "Exports without an audio track."}
                  </p>
                </label>
              </div>
            </section>

            <section className="rounded-md border border-border bg-card">
              <div className="border-b border-border px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
                  Filename Template
                </div>
              </div>
              <div className="space-y-3 p-3">
                <div className="grid gap-3 sm:grid-cols-[12rem_auto] sm:items-end">
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
                      Template Set
                    </span>
                    <Select
                      value={editingTemplateKind}
                      onValueChange={(value) => onEditingTemplateKindChange(value as ExportFileNameTemplateKind)}
                    >
                      <SelectTrigger size="sm" className={compactSelectTriggerClassName()}>
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
                  <span className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
                    Pattern
                  </span>
                  <input
                    type="text"
                    value={fileNameTemplates[editingTemplateKind]}
                    onChange={(event) => onFileNameTemplateChange(editingTemplateKind, event.target.value)}
                    className="h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/40"
                    spellCheck={false}
                  />
                </label>

                <p className="text-xs text-muted-foreground">{editingTemplateOption.description}</p>

                <div className="rounded-md border border-border bg-background px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
                    Available Tokens
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {visibleTokens.map((token) => (
                      <code
                        key={token}
                        className="rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-foreground"
                      >
                        {`{${token}}`}
                      </code>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <aside className="space-y-3 rounded-md border border-border bg-card p-3">
            <div className="border-b border-border pb-2">
              <div className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
                Summary
              </div>
            </div>

            <div className="text-sm font-medium text-foreground">{title}</div>

            <dl className="grid gap-2 text-sm">
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">Clip</dt>
                <dd className="mt-1 font-mono text-xs text-foreground">
                  {formatTime(clipStart)} to {formatTime(clipEnd)}
                </dd>
              </div>

              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">Duration</dt>
                <dd className="mt-1 font-mono text-xs text-foreground">{formatTime(clipLength)}</dd>
              </div>

              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">Source</dt>
                <dd className="mt-1 text-xs text-foreground">
                  {exportSourceLabel}
                </dd>
                {exportSourceSummaryMessage ? (
                  <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {exportSourceSummaryMessage}
                  </dd>
                ) : null}
              </div>

              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">Output</dt>
                <dd className="mt-1 text-xs text-foreground">{selectedFormatOption.label}</dd>
                <dd className="mt-1 font-mono text-[11px] text-foreground">
                  {outputDimensions ? `${outputDimensions.width} x ${outputDimensions.height}` : "Unknown size"}
                </dd>
              </div>

              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">Audio</dt>
                <dd className="mt-1 text-xs text-foreground">
                  {includeAudio ? "Included when available" : "Video only"}
                </dd>
              </div>

              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">Filename</dt>
                <dd className="mt-1 text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground">
                  {activeTemplateKind === "episode" ? "TV show template" : "Movie template"}
                </dd>
                <dd className="mt-1 break-all font-mono text-[11px] text-foreground">{fileNamePreview}</dd>
              </div>
            </dl>
          </aside>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-3 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                Exporting {Math.round(progress * 100)}%
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Export {selectedFormatOption.label}
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
