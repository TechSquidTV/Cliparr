import { Copy, Download, LoaderCircle } from "lucide-react";
import type { FramegrabImageFormat } from "@/lib/framegrab";
import {
  framegrabFormatOptionFor,
  framegrabImageFormatOptions,
} from "@/lib/framegrab";
import {
  DialogClose,
  DialogFooter,
  DialogWindow,
} from "@/components/ui/dialog";
import {
  compactPrimaryButtonClasses,
  compactSecondaryButtonClasses,
  destructiveAlertClasses,
  primaryAlertClasses,
} from "@/components/ui/control-styles";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatTime } from "@/components/editor/editorUtils";

type FramegrabAction = "copy" | "download";

interface EditorFramegrabDialogProps {
  isOpen: boolean;
  title: string;
  frameTime: number;
  dimensions: {
    width: number;
    height: number;
  };
  selectedFormat: FramegrabImageFormat;
  onFormatChange: (format: FramegrabImageFormat) => void;
  fileNamePreview: string;
  processingAction: FramegrabAction | null;
  error: string | null;
  message: string | null;
  onClose: () => void;
  onCopy: () => void;
  onDownload: () => void;
}

function sectionLabelClassName() {
  return "text-ui-label font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground";
}

function compactSelectTriggerClassName() {
  return "h-8 w-full min-w-0 rounded-md border-border bg-background px-2.5 text-xs font-medium shadow-none focus-visible:ring-2";
}

export function EditorFramegrabDialog({
  isOpen,
  title,
  frameTime,
  dimensions,
  selectedFormat,
  onFormatChange,
  fileNamePreview,
  processingAction,
  error,
  message,
  onClose,
  onCopy,
  onDownload,
}: EditorFramegrabDialogProps) {
  const selectedFormatOption = framegrabFormatOptionFor(selectedFormat);
  const busy = processingAction !== null;

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
        {message ? <div className={primaryAlertClasses}>{message}</div> : null}

        <section className="rounded-md border border-border bg-card">
          <div className="border-b border-border px-3 py-2">
            <div className={sectionLabelClassName()}>Image</div>
          </div>
          <div className="space-y-3 p-3">
            <div className="text-sm font-medium text-foreground">{title}</div>

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

            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className={sectionLabelClassName()}>Frame</dt>
                <dd className="mt-1 font-mono text-xs text-foreground">
                  {formatTime(frameTime)}
                </dd>
              </div>
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <dt className={sectionLabelClassName()}>Size</dt>
                <dd className="mt-1 font-mono text-xs text-foreground">
                  {dimensions.width} x {dimensions.height}
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
        <DialogClose disabled={busy} className={compactSecondaryButtonClasses}>
          Cancel
        </DialogClose>

        <button
          type="button"
          onClick={onCopy}
          disabled={busy}
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
          disabled={busy}
          className={compactPrimaryButtonClasses}
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
