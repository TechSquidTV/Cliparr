import { FileVideo, Link } from "lucide-react";
import { type SubmitEvent, useCallback, useRef, useState } from "react";

import { LocalFilePicker } from "#/components/local-media/LocalFilePicker";
import {
  buttonClassName,
  destructiveAlertClasses,
  fieldLabelWideClasses,
  textInputClassName,
} from "#/components/ui/control-styles";
import { DialogWindow } from "#/components/ui/dialog";
import { Spinner } from "#/components/ui/spinner";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsPanels,
  TabsTab,
} from "#/components/ui/tabs";
import { cn } from "#/lib/cn";
import { createLocalSessionFromUrl } from "#/lib/localMediaRegistry";
import { resolveProxiedMediaUrl } from "#/lib/proxiedMediaSource";
interface LocalVideoOpenDialogProperties {
  isOpen: boolean;
  canOpenUrl: boolean;
  onClose: () => void;
  onOpened: (sessionId: string) => void;
}

type LocalOpenTab = "file" | "url";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function LocalVideoOpenDialog({
  isOpen,
  canOpenUrl,
  onClose,
  onOpened,
}: LocalVideoOpenDialogProperties) {
  const initialFocusReference = useRef<HTMLElement | null>(null);
  const [activeTab, setActiveTab] = useState<LocalOpenTab>("file");
  const [urlValue, setUrlValue] = useState("");
  const [opening, setOpening] = useState(false);
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

  const handleUrlSubmit = useCallback(
    async (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canOpenUrl) {
        return;
      }
      setOpening(true);
      setError("");

      try {
        const result = await createLocalSessionFromUrl(
          urlValue,
          resolveProxiedMediaUrl,
        );
        if (result.status === "ready") {
          completeOpen(result.session.id);
          return;
        }

        setError(result.message);
      } catch (error_) {
        setError(errorMessage(error_, "Could not open that URL."));
      } finally {
        setOpening(false);
      }
    },
    [canOpenUrl, completeOpen, urlValue],
  );

  return (
    <DialogWindow
      open={isOpen}
      onClose={onClose}
      closeDisabled={opening}
      closeLabel="Close local video dialog"
      title="Open Video"
      description={
        canOpenUrl
          ? "Local files stay in your browser. URLs stream through Cliparr."
          : "Local files stay in your browser. Sign in to a provider to open a URL."
      }
      initialFocus={initialFocusReference}
      popupClassName="max-w-xl"
    >
      <Tabs
        value={canOpenUrl ? activeTab : "file"}
        onValueChange={(value) => {
          let nextTab: LocalOpenTab | null = null;
          if (value === "file") {
            nextTab = "file";
          } else if (value === "url") {
            nextTab = "url";
          }

          if (!nextTab) {
            return;
          }

          setActiveTab(nextTab);
          setError("");
        }}
      >
        <div className="border-b border-border px-4 py-3">
          <TabsList className="grid grid-cols-2">
            <TabsTab ref={initialFocusReference} value="file">
              <FileVideo className="h-4 w-4" />
              File
            </TabsTab>
            <TabsTab value="url" disabled={!canOpenUrl}>
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
              <LocalFilePicker
                onOpened={completeOpen}
                opening={opening}
                onOpeningChange={setOpening}
              />
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
                    disabled={!canOpenUrl}
                    value={urlValue}
                    onChange={(event) => setUrlValue(event.target.value)}
                    placeholder="https://example.com/video.mp4"
                    className={textInputClassName({ size: "large" })}
                  />
                </label>
                <p className="text-xs leading-5 text-muted-foreground">
                  Use a direct media file or HLS playlist URL.
                </p>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={opening || !canOpenUrl}
                    aria-busy={opening}
                    className={buttonClassName()}
                  >
                    {opening ? <Spinner /> : <Link className="h-4 w-4" />}
                    Open URL
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
