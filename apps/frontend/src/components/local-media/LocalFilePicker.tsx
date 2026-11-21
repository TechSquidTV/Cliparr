import { FolderOpen, Upload } from "lucide-react";
import { type DragEvent, useCallback, useRef, useState } from "react";

import {
  buttonClassName,
  destructiveAlertClasses,
} from "#/components/ui/control-styles";
import { Spinner } from "#/components/ui/spinner";
import { LOCAL_VIDEO_FILE_ACCEPT } from "#/lib/localMediaFormats";
import {
  createLocalSessionFromFile,
  createLocalSessionFromPicker,
  localMediaPickerSupported,
} from "#/lib/localMediaRegistry";

export function LocalFilePicker({
  onOpened,
  opening,
  onOpeningChange: setOpening,
}: {
  onOpened: (id: string) => void;
  opening: boolean;
  onOpeningChange: (value: boolean) => void;
}) {
  const fileInputReference = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const openFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file || opening) {
        return;
      }

      setOpening(true);
      setError("");
      try {
        const session = await createLocalSessionFromFile(file);
        onOpened(session.id);
      } catch (error_) {
        setError(
          error_ instanceof Error
            ? error_.message
            : "Could not open that file.",
        );
      } finally {
        setOpening(false);
      }
    },
    [onOpened, opening, setOpening],
  );

  const handleChooseFile = useCallback(async () => {
    setError("");

    if (!localMediaPickerSupported()) {
      fileInputReference.current?.click();
      return;
    }

    setOpening(true);
    try {
      const result = await createLocalSessionFromPicker();
      if (result.status === "ready") {
        onOpened(result.session.id);
        return;
      }

      if (result.status === "unsupported") {
        fileInputReference.current?.click();
        return;
      }

      if (result.status === "error") {
        setError(result.message);
      }
    } catch (error_) {
      setError(
        error_ instanceof Error ? error_.message : "Could not open that file.",
      );
    } finally {
      setOpening(false);
    }
  }, [onOpened, setOpening]);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      void openFile(event.dataTransfer.files.item(0));
    },
    [openFile],
  );

  return (
    <>
      {error && (
        <p role="alert" className={destructiveAlertClasses}>
          {error}
        </p>
      )}
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
          ref={fileInputReference}
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
          <p className="text-sm font-medium text-foreground">
            Drop a video file here
          </p>
          <p className="text-xs text-muted-foreground">
            MP4, MOV, MKV, WebM, Ogg video, and MPEG-TS are supported.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleChooseFile()}
          disabled={opening}
          aria-busy={opening}
          className={buttonClassName({ className: "mt-5" })}
        >
          {opening ? <Spinner /> : <FolderOpen className="h-4 w-4" />}
          Choose File
        </button>
      </div>
    </>
  );
}
