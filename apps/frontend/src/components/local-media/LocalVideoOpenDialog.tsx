import { FileVideo, FolderOpen, Link, Upload } from "lucide-react";
import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { DialogWindow } from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsPanels,
  TabsTab,
} from "@/components/ui/tabs";
import {
  destructiveAlertClasses,
  fieldLabelWideClasses,
  largeTextInputClasses,
  primaryButtonClasses,
} from "@/components/ui/control-styles";
import {
  createLocalSessionFromFile,
  createLocalSessionFromPicker,
  createLocalSessionFromUrl,
  LOCAL_VIDEO_FILE_ACCEPT,
  localMediaPickerSupported,
} from "@/lib/localMediaRegistry";
import { cn } from "@/lib/utils";

interface LocalVideoOpenDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onOpened: (sessionId: string) => void;
}

type LocalOpenTab = "file" | "url";

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function LocalVideoOpenDialog({
  isOpen,
  onClose,
  onOpened,
}: LocalVideoOpenDialogProps) {
  const initialFocusRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeTab, setActiveTab] = useState<LocalOpenTab>("file");
  const [urlValue, setUrlValue] = useState("");
  const [opening, setOpening] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");

  const completeOpen = useCallback(
    (sessionId: string) => {
      setError("");
      setUrlValue("");
      onClose();
      onOpened(sessionId);
    },
    [onClose, onOpened],
  );

  const openFile = useCallback(
    async (file: File | null | undefined) => {
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
    },
    [completeOpen],
  );

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

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      void openFile(event.dataTransfer.files.item(0));
    },
    [openFile],
  );

  const handleUrlSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
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
    },
    [completeOpen, urlValue],
  );

  return (
    <DialogWindow
      open={isOpen}
      onClose={onClose}
      closeDisabled={opening}
      closeLabel="Close local video dialog"
      title="Open Video"
      description="Local files stay in your browser. URLs stream through Cliparr."
      initialFocus={initialFocusRef}
      popupClassName="max-w-xl"
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const nextTab: LocalOpenTab | null =
            value === "file" ? "file" : value === "url" ? "url" : null;

          if (!nextTab) {
            return;
          }

          setActiveTab(nextTab);
          setError("");
        }}
      >
        <div className="border-b border-border px-4 py-3">
          <TabsList className="grid grid-cols-2">
            <TabsTab ref={initialFocusRef} value="file">
              <FileVideo className="h-4 w-4" />
              File
            </TabsTab>
            <TabsTab value="url">
              <Link className="h-4 w-4" />
              URL
            </TabsTab>
          </TabsList>
        </div>

        <div className="min-h-0 overflow-y-auto p-4">
          {error && (
            <div className={cn(destructiveAlertClasses, "mb-4")}>{error}</div>
          )}

          <TabsPanels>
            <TabsPanel value="file">
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
                  className={cn(primaryButtonClasses, "mt-5")}
                >
                  <FolderOpen className="h-4 w-4" />
                  {opening ? "Opening" : "Choose File"}
                </button>
              </div>
            </TabsPanel>
            <TabsPanel value="url">
              <form
                className="space-y-4"
                onSubmit={(event) => void handleUrlSubmit(event)}
              >
                <label className="block space-y-1.5">
                  <span className={fieldLabelWideClasses}>Media URL</span>
                  <input
                    type="url"
                    value={urlValue}
                    onChange={(event) => setUrlValue(event.target.value)}
                    placeholder="https://example.com/video.mp4"
                    className={largeTextInputClasses}
                  />
                </label>
                <p className="text-xs leading-5 text-muted-foreground">
                  Use a direct media file or HLS playlist URL.
                </p>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={opening}
                    className={primaryButtonClasses}
                  >
                    <Link className="h-4 w-4" />
                    {opening ? "Opening" : "Open URL"}
                  </button>
                </div>
              </form>
            </TabsPanel>
          </TabsPanels>
        </div>
      </Tabs>
    </DialogWindow>
  );
}
