import { FileVideo, FolderOpen, Link, Upload, X } from "lucide-react";
import { useCallback, useRef, useState, type DragEvent, type FormEvent } from "react";
import {
  createLocalSessionFromFile,
  createLocalSessionFromPicker,
  createLocalSessionFromUrl,
  LOCAL_VIDEO_FILE_ACCEPT,
  localMediaPickerSupported,
} from "../lib/localMediaRegistry";
import { useModalFocusTrap } from "./useModalFocusTrap";

interface LocalVideoOpenModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpened: (sessionId: string) => void;
}

type LocalOpenTab = "file" | "url";

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function LocalVideoOpenModal({ isOpen, onClose, onOpened }: LocalVideoOpenModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const initialFocusRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeTab, setActiveTab] = useState<LocalOpenTab>("file");
  const [urlValue, setUrlValue] = useState("");
  const [opening, setOpening] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");

  useModalFocusTrap({
    isOpen,
    dialogRef,
    initialFocusRef,
    onEscape: opening ? undefined : onClose,
  });

  const completeOpen = useCallback((sessionId: string) => {
    setError("");
    setUrlValue("");
    onClose();
    onOpened(sessionId);
  }, [onClose, onOpened]);

  const openFile = useCallback(async (file: File | null | undefined) => {
    if (!file) {
      return;
    }

    setOpening(true);
    setError("");
    try {
      const session = await createLocalSessionFromFile(file);
      completeOpen(session.id);
    } catch (err) {
      setError(errorMessage(err, "Could not open that file."));
    } finally {
      setOpening(false);
    }
  }, [completeOpen]);

  const handleChooseFile = useCallback(async () => {
    setError("");

    if (!localMediaPickerSupported()) {
      fileInputRef.current?.click();
      return;
    }

    setOpening(true);
    try {
      const result = await createLocalSessionFromPicker();
      if (result.status === "ready") {
        completeOpen(result.session.id);
        return;
      }

      if (result.status === "unsupported") {
        fileInputRef.current?.click();
        return;
      }

      if (result.status === "error") {
        setError(result.message);
      }
    } catch (err) {
      setError(errorMessage(err, "Could not open that file."));
    } finally {
      setOpening(false);
    }
  }, [completeOpen]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    void openFile(event.dataTransfer.files.item(0));
  }, [openFile]);

  const handleUrlSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOpening(true);
    setError("");

    try {
      const result = await createLocalSessionFromUrl(urlValue);
      if (result.status === "ready") {
        completeOpen(result.session.id);
        return;
      }

      setError(result.message);
    } catch (err) {
      setError(errorMessage(err, "Could not open that URL."));
    } finally {
      setOpening(false);
    }
  }, [completeOpen, urlValue]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklch,var(--foreground)_40%,transparent)] p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => {
        if (!opening) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cliparr-local-open-title"
        tabIndex={-1}
        className="mx-auto flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="space-y-1">
            <h2 id="cliparr-local-open-title" className="text-sm font-semibold uppercase tracking-[var(--tracking-caps-md)] text-foreground">
              Open Video
            </h2>
            <p className="text-xs text-muted-foreground">
              Local files stay in your browser. URL media is read through Cliparr.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={opening}
            aria-label="Close local video dialog"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="border-b border-border px-4 pt-3">
          <div className="grid grid-cols-2 rounded-md border border-border bg-background p-1">
            <button
              ref={initialFocusRef}
              type="button"
              onClick={() => {
                setActiveTab("file");
                setError("");
              }}
              className={`inline-flex h-8 items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] transition-colors ${
                activeTab === "file"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <FileVideo className="h-4 w-4" />
              File
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("url");
                setError("");
              }}
              className={`inline-flex h-8 items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] transition-colors ${
                activeTab === "url"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Link className="h-4 w-4" />
              URL
            </button>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {activeTab === "file" ? (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`flex min-h-52 flex-col items-center justify-center border border-dashed p-6 text-center transition-colors ${
                dragActive
                  ? "border-primary bg-primary/8"
                  : "border-border bg-background"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={LOCAL_VIDEO_FILE_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  const file = event.currentTarget.files?.item(0) ?? null;
                  event.currentTarget.value = "";
                  void openFile(file);
                }}
              />
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
                <Upload className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Drop a video file here</p>
                <p className="text-xs text-muted-foreground">MP4, MOV, MKV, WebM, Ogg video, and MPEG-TS are supported when your browser can decode them.</p>
              </div>
              <button
                type="button"
                onClick={() => void handleChooseFile()}
                disabled={opening}
                className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-4 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FolderOpen className="h-4 w-4" />
                {opening ? "Opening" : "Choose File"}
              </button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={(event) => void handleUrlSubmit(event)}>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
                  Media URL
                </span>
                <input
                  type="url"
                  value={urlValue}
                  onChange={(event) => setUrlValue(event.target.value)}
                  placeholder="https://example.com/video.mp4"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/40"
                />
              </label>
              <p className="text-xs leading-5 text-muted-foreground">
                Direct media files and HLS playlists can work when the remote server permits server-side reads and byte-range requests.
              </p>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={opening}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-4 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Link className="h-4 w-4" />
                  {opening ? "Opening" : "Open URL"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
