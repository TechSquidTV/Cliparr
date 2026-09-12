import { FolderOpen } from "lucide-react";
import ProviderConnectFlow from "@/components/provider-connect/ProviderConnectFlow";
import { primaryButtonClasses } from "@/components/ui/control-styles";
import type { ProviderSession } from "@/providers/types";

interface Properties {
  onConnected: (session: ProviderSession) => Promise<void> | void;
  onOpenLocalVideo: () => void;
}

export default function ProviderConnectScreen({
  onConnected,
  onOpenLocalVideo,
}: Properties) {
  return (
    <div className="flex min-h-(--app-viewport-height) items-start justify-center bg-background text-foreground sm:p-4 sm:pt-12">
      <div className="relative w-full max-w-2xl overflow-hidden text-card-foreground sm:rounded-4xl sm:border sm:border-border sm:bg-card sm:shadow-2xl">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-40 bg-linear-to-b from-primary/10 via-secondary/5 to-transparent" />
          <div className="absolute -left-10 top-24 h-40 w-40 rounded-full bg-secondary/10 blur-3xl" />
          <div className="absolute -right-10 top-16 h-44 w-44 rounded-full bg-primary/10 blur-3xl" />
        </div>

        <div className="relative border-b border-border px-5 py-6 sm:px-8 sm:py-8">
          <div className="mb-5 flex items-center justify-center">
            <img
              src="/logo-light.svg"
              alt="Cliparr Logo"
              className="h-12 w-12"
              width="48"
              height="48"
              decoding="async"
            />
          </div>
          <h1 className="text-center text-3xl font-semibold tracking-tight">
            Start a clip
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-6 text-muted-foreground">
            Open a video from your device or connect your media library.
          </p>
        </div>

        <div className="relative space-y-6 px-5 py-6 sm:px-8 sm:py-5">
          <section className="flex flex-wrap items-center justify-between gap-4 sm:rounded-2xl sm:border sm:border-border sm:bg-background/60 sm:p-5">
            <div className="min-w-0 flex-1 basis-56">
              <h2 className="text-lg font-semibold">Open a video</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Choose a file on this device. No account needed.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenLocalVideo}
              className={`${primaryButtonClasses} min-h-11 shrink-0`}
            >
              <FolderOpen className="h-4 w-4" />
              Open Video
            </button>
          </section>
          <section className="min-w-0 border-t border-border pt-6 sm:rounded-2xl sm:border sm:bg-background/60 sm:p-5">
            <h2 className="text-lg font-semibold">Connect Plex or Jellyfin</h2>
            <p className="mt-2 mb-5 text-sm leading-6 text-muted-foreground">
              Connect your server, then play a video in Plex or Jellyfin to find
              it here and start clipping.
            </p>
            <ProviderConnectFlow variant="screen" onConnected={onConnected} />
          </section>
        </div>
      </div>
    </div>
  );
}
