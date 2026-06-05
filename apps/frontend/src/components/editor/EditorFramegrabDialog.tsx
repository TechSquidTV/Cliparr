import { Copy, Download, LoaderCircle } from "lucide-react";
import type {
  FramegrabImageFormat,
  FramegrabImageQuality,
} from "@/lib/framegrab";
import {
  framegrabFormatOptionFor,
  framegrabImageFormatOptions,
  framegrabImageQualityOptions,
} from "@/lib/framegrab";
import { DialogFooter, DialogWindow } from "@/components/ui/dialog";
import {
  compactPrimaryButtonClasses,
  compactSecondaryButtonClasses,
  destructiveAlertClasses,
} from "@/components/ui/control-styles";
import {
  compactSelectTriggerClassName,
  sectionLabelClassName,
} from "@/components/editor/editorDialogStyles";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatTime } from "@/components/editor/editorUtilities";

type FramegrabAction = "copy" | "download";

interface EditorFramegrabDialogProperties {
  isOpen: boolean;
  title: string;
  frameTime: number;
  dimensions: {
    width: number;
    height: number;
  } | null;
  selectedFormat: FramegrabImageFormat;
  onFormatChange: (format: FramegrabImageFormat) => void;
  selectedQuality: FramegrabImageQuality;
  onQualityChange: (quality: FramegrabImageQuality) => void;
  fileNamePreview: string;
  processingAction: FramegrabAction | null;
  error: string | null;
  message: string | null;
  onClose: () => void;
  onCopy: () => void;
  onDownload: () => void;
}

export function EditorFramegrabDialog({
  isOpen,
  title,
  frameTime,
  dimensions,
  selectedFormat,
  onFormatChange,
  selectedQuality,
  onQualityChange,
  fileNamePreview,
  processingAction,
  error,
  message,
  onClose,
  onCopy,
  onDownload,
}: EditorFramegrabDialogProperties) {
  const selectedFormatOption = framegrabFormatOptionFor(selectedFormat);
  const busy = processingAction !== null;
  const hasFrame = dimensions !== null;
  const qualityDisabled = selectedFormat === "png";

  return (
    <DialogWindow
      open={isOpen}
      onClose={onClose}
      closeDisabled={busy}
      closeLabel="Close frame export dialog"
      title="Export Frame"
      description="Download or copy the current preview frame."
      popupClassName="max-w-lg"
      headerClassName="bg-card"
    >
      <div className="space-y-4 overflow-y-auto p-4">
        {error ? <div className={destructiveAlertClasses}>{error}</div> : null}

        <section className="rounded-md border border-border bg-card">
          <div className="border-b border-border px-3 py-2">
            <div className={sectionLabelClassName()}>Image</div>
          </div>
          <div className="space-y-3 p-3">
            <div className="text-sm font-medium text-foreground">{title}</div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className={sectionLabelClassName()}>Image Type</span>
                <Select
                  value={selectedFormat}
                  onValueChange={(value) =>
                    onFormatChange(value as FramegrabImageFormat)
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className={compactSelectTriggerClassName()}
                  >
                    <SelectValue placeholder="Select image type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Image Types</SelectLabel>
                      {framegrabImageFormatOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label} {option.extension}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>

              <label className="block space-y-1.5">
                <span className={sectionLabelClassName()}>Quality</span>
                <Select
                  value={selectedQuality}
                  onValueChange={(value) =>
                    onQualityChange(value as FramegrabImageQuality)
                  }
                  disabled={qualityDisabled}
                >
                  <SelectTrigger
                    size="sm"
                    className={compactSelectTriggerClassName()}
                  >
                    <SelectValue placeholder="Select quality" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Quality</SelectLabel>
                      {framegrabImageQualityOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>
            </div>

            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className={sectionLabelClassName()}>Time</dt>
                <dd className="mt-1 font-mono text-xs text-foreground">
                  {formatTime(frameTime)}
                </dd>
              </div>
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className={sectionLabelClassName()}>Size</dt>
                <dd className="mt-1 font-mono text-xs text-foreground">
                  {dimensions
                    ? `${dimensions.width} x ${dimensions.height}`
                    : "Unavailable"}
                </dd>
              </div>
            </dl>

            <div className="rounded-md border border-border bg-background px-3 py-2">
              <div className={sectionLabelClassName()}>Filename</div>
              <div className="mt-1 break-all font-mono text-ui-label text-foreground">
                {fileNamePreview}
              </div>
            </div>
          </div>
        </section>
      </div>

      <DialogFooter className="border-t border-border bg-card px-4 py-3">
        <span
          role="status"
          aria-live="polite"
          className="flex min-h-8 min-w-0 flex-1 items-center truncate text-xs text-muted-foreground"
        >
          {message}
        </span>

        <button
          type="button"
          onClick={onCopy}
          disabled={busy || !hasFrame}
          className={compactSecondaryButtonClasses}
        >
          {processingAction === "copy" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          Copy Image
        </button>

        <button
          type="button"
          onClick={onDownload}
          disabled={busy || !hasFrame}
          className={`${compactPrimaryButtonClasses} w-44`}
        >
          {processingAction === "download" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Download {selectedFormatOption.label}
        </button>
      </DialogFooter>
    </DialogWindow>
  );
}
