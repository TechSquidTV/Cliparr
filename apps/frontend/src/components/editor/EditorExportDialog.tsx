import { Download, FileVideo, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ExportFormat, ExportResolution } from "../../lib/exportClip";
import {
  EXPORT_FILE_NAME_TEMPLATE_TOKENS,
  type ExportFileNameTemplateKind,
  type ExportFileNameTemplateSettings,
} from "../../lib/exportFileName";
import { cn } from "../../lib/utils";
import { formatTime } from "./EditorUtils";

interface EditorExportDialogProps {
  isOpen: boolean;
  title: string;
  clipStart: number;
  clipEnd: number;
  selectedFormat: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  selectedResolution: ExportResolution;
  onResolutionChange: (resolution: ExportResolution) => void;
  includeAudio: boolean;
  onIncludeAudioChange: (includeAudio: boolean) => void;
  exporting: boolean;
  progress: number;
  error: string | null;
  fileNamePreview: string;
  activeTemplateKind: ExportFileNameTemplateKind;
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
  summary: string;
  badge?: string;
}> = [
  {
    value: "mp4",
    label: "MP4",
    extension: ".mp4",
    description: "Best for everyday sharing, browser playback, and platform uploads.",
    summary: "Broad compatibility with the safest handoff for most destinations.",
    badge: "Recommended",
  },
  {
    value: "webm",
    label: "WEBM",
    extension: ".webm",
    description: "Modern web-first delivery with efficient browser-friendly playback.",
    summary: "Ideal when the export is headed straight to the web.",
  },
  {
    value: "mov",
    label: "MOV",
    extension: ".mov",
    description: "A professional container that fits Adobe-style editorial workflows.",
    summary: "A clean choice for post-production round trips and desktop apps.",
  },
  {
    value: "mkv",
    label: "MKV",
    extension: ".mkv",
    description: "A flexible container for preserving a wider range of stream layouts.",
    summary: "Useful when you want a more open, archival-friendly container.",
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

export function EditorExportDialog({
  isOpen,
  title,
  clipStart,
  clipEnd,
  selectedFormat,
  onFormatChange,
  selectedResolution,
  onResolutionChange,
  includeAudio,
  onIncludeAudioChange,
  exporting,
  progress,
  error,
  fileNamePreview,
  activeTemplateKind,
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
      className="fixed inset-0 z-50 bg-[color-mix(in_oklch,var(--foreground)_40%,transparent)] p-4 backdrop-blur-sm sm:p-6"
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
        className="mx-auto flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-[1.25rem] border border-border bg-card text-card-foreground shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-b border-border bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_58%),linear-gradient(180deg,color-mix(in_oklch,var(--muted)_80%,var(--card)),var(--card))] px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <Download className="h-3.5 w-3.5" />
                Advanced Export
              </div>
              <div className="space-y-2">
                <h2 id="cliparr-export-dialog-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  Export Clip
                </h2>
                <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                  Choose the output format, delivery size, and whether this clip should be exported with audio.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={exporting}
              aria-label="Close export dialog"
              className="flex h-10 w-10 items-center justify-center rounded-[0.875rem] border border-border bg-background/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            {error && (
              <div className="rounded-[0.875rem] border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <section className="space-y-3">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Format
                </p>
                <p className="text-sm text-muted-foreground">
                  Pick the container that best fits where the clip is headed next.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {formatOptions.map((option) => {
                  const isSelected = option.value === selectedFormat;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onFormatChange(option.value)}
                      className={cn(
                        "group rounded-[0.875rem] border px-4 py-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-ring/50",
                        isSelected
                          ? "border-primary bg-[color-mix(in_oklch,var(--primary)_14%,var(--card))] text-foreground"
                          : "border-border bg-background/75 text-foreground hover:bg-accent"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-base font-semibold tracking-tight">{option.label}</span>
                            <span className="font-mono text-xs text-muted-foreground">{option.extension}</span>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">{option.description}</p>
                        </div>
                        {option.badge && (
                          <span
                            className={cn(
                              "rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
                              isSelected
                                ? "border-primary/40 bg-primary text-primary-foreground"
                                : "border-border bg-card text-muted-foreground"
                            )}
                          >
                            {option.badge}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Resolution
                </p>
                <p className="text-sm text-muted-foreground">
                  Match the source or deliver a lighter export for easier sharing.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {resolutionOptions.map((option) => {
                  const isSelected = option.value === selectedResolution;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onResolutionChange(option.value)}
                      className={cn(
                        "rounded-[0.875rem] border px-4 py-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-ring/50",
                        isSelected
                          ? "border-primary bg-[color-mix(in_oklch,var(--primary)_14%,var(--card))] text-foreground"
                          : "border-border bg-background/75 text-foreground hover:bg-accent"
                      )}
                    >
                      <div className="text-sm font-semibold uppercase tracking-[0.12em]">{option.label}</div>
                      <p className="mt-2 text-sm text-muted-foreground">{option.description}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Audio
                </p>
                <p className="text-sm text-muted-foreground">
                  Decide whether the export should keep a stereo mixdown of the source audio.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {([
                  {
                    value: true,
                    label: "Include Audio",
                    description: "Keeps audio when the source includes it, exported as a stereo mix.",
                    icon: Volume2,
                  },
                  {
                    value: false,
                    label: "Video Only",
                    description: "Exports the clip without any audio tracks.",
                    icon: VolumeX,
                  },
                ] as const).map((option) => {
                  const isSelected = option.value === includeAudio;
                  const Icon = option.icon;

                  return (
                    <button
                      key={String(option.value)}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onIncludeAudioChange(option.value)}
                      className={cn(
                        "rounded-[0.875rem] border px-4 py-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-ring/50",
                        isSelected
                          ? "border-primary bg-[color-mix(in_oklch,var(--primary)_14%,var(--card))] text-foreground"
                          : "border-border bg-background/75 text-foreground hover:bg-accent"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "flex h-10 w-10 items-center justify-center rounded-[0.75rem] border",
                            isSelected
                              ? "border-primary/35 bg-primary text-primary-foreground"
                              : "border-border bg-card text-muted-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="text-sm font-semibold uppercase tracking-[0.12em]">{option.label}</div>
                          <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-4">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Filename Templates
                </p>
                <p className="text-sm text-muted-foreground">
                  Templates are saved locally in this browser. The export extension is added automatically.
                </p>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {([
                  {
                    kind: "movie",
                    label: "Movies",
                    description: "Used for film-style items and anything that is not a TV episode.",
                  },
                  {
                    kind: "episode",
                    label: "TV Shows",
                    description: "Used for episode exports with show and episode metadata.",
                  },
                ] as const).map((templateOption) => {
                  const isActive = activeTemplateKind === templateOption.kind;

                  return (
                    <div
                      key={templateOption.kind}
                      className={cn(
                        "rounded-[0.875rem] border p-4",
                        isActive
                          ? "border-primary bg-[color-mix(in_oklch,var(--primary)_12%,var(--card))]"
                          : "border-border bg-background/75"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-semibold uppercase tracking-[0.12em]">{templateOption.label}</div>
                            {isActive && (
                              <span className="rounded-full border border-primary/30 bg-primary px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary-foreground">
                                Used Now
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{templateOption.description}</p>
                        </div>

                        <button
                          type="button"
                          onClick={() => onResetFileNameTemplate(templateOption.kind)}
                          className="rounded-[0.625rem] border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          Reset
                        </button>
                      </div>

                      <label className="mt-4 block space-y-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Template
                        </span>
                        <input
                          type="text"
                          value={fileNameTemplates[templateOption.kind]}
                          onChange={(event) => onFileNameTemplateChange(templateOption.kind, event.target.value)}
                          className="h-11 w-full rounded-[0.75rem] border border-input bg-background px-3 font-mono text-sm text-foreground outline-none transition-colors focus:border-ring"
                          spellCheck={false}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-[0.875rem] border border-border bg-background/70 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Available Tokens
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {EXPORT_FILE_NAME_TEMPLATE_TOKENS.map((token) => (
                    <code
                      key={token}
                      className="rounded-[0.625rem] border border-border bg-card px-2.5 py-1 font-mono text-xs text-foreground"
                    >
                      {`{${token}}`}
                    </code>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <aside className="space-y-4 rounded-[1rem] border border-border bg-[linear-gradient(180deg,color-mix(in_oklch,var(--muted)_82%,var(--card)),var(--card))] p-5">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <FileVideo className="h-3.5 w-3.5" />
                Export Summary
              </div>
              <div className="space-y-2">
                <div className="text-lg font-semibold tracking-tight">{title}</div>
                <p className="text-sm text-muted-foreground">{selectedFormatOption.summary}</p>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="rounded-[0.875rem] border border-border bg-background/75 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Clip Range
                </div>
                <div className="mt-2 text-sm font-medium">
                  {formatTime(clipStart)} to {formatTime(clipEnd)}
                </div>
              </div>

              <div className="rounded-[0.875rem] border border-border bg-background/75 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Clip Length
                </div>
                <div className="mt-2 text-sm font-medium">{formatTime(clipLength)}</div>
              </div>

              <div className="rounded-[0.875rem] border border-border bg-background/75 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Output
                </div>
                <div className="mt-2 text-sm font-medium">
                  {selectedFormatOption.label} · {selectedResolution === "original" ? "Original size" : `${selectedResolution}p`}
                </div>
              </div>

              <div className="rounded-[0.875rem] border border-border bg-background/75 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Audio
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm font-medium">
                  {includeAudio ? <Volume2 className="h-4 w-4 text-muted-foreground" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
                  {includeAudio ? "Included when available" : "No audio track"}
                </div>
              </div>

              <div className="rounded-[0.875rem] border border-border bg-background/75 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Filename
                </div>
                <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {activeTemplateKind === "episode" ? "TV show template" : "Movie template"}
                </div>
                <div className="mt-2 break-all font-mono text-xs text-foreground">{fileNamePreview}</div>
              </div>
            </div>
          </aside>
        </div>

        <footer className="flex flex-col-reverse gap-3 border-t border-border bg-[linear-gradient(180deg,var(--card),color-mix(in_oklch,var(--muted)_78%,var(--card)))] px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className="inline-flex h-11 items-center justify-center rounded-[0.875rem] border border-border bg-background/80 px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[0.875rem] border border-primary bg-primary px-5 text-sm font-semibold uppercase tracking-[0.12em] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
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
