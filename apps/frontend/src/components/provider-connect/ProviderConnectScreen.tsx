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
    <div className="flex min-h-screen items-start justify-center bg-background p-4 pt-6 text-foreground sm:items-center">
      <div className="relative w-full max-w-5xl overflow-hidden rounded-4xl border border-border bg-card text-card-foreground shadow-2xl">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-40 bg-linear-to-b from-primary/10 via-secondary/5 to-transparent" />
          <div className="absolute -left-10 top-24 h-40 w-40 rounded-full bg-secondary/10 blur-3xl" />
          <div className="absolute -right-10 top-16 h-44 w-44 rounded-full bg-primary/10 blur-3xl" />
        </div>

        <div className="relative border-b border-border px-6 py-8 sm:px-8">
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

        <div className="relative grid gap-6 px-6 py-6 sm:px-8 lg:grid-cols-2">
          <section className="rounded-2xl border border-border bg-background/60 p-5">
            <FolderOpen
              className="mb-3 h-6 w-6 text-primary"
              aria-hidden="true"
            />
            <h2 className="text-lg font-semibold">Open a file</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Choose a video on this device and start trimming. Local files need
              no account or provider connection.
            </p>
            <button
              type="button"
              onClick={onOpenLocalVideo}
              className={`${primaryButtonClasses} mt-5`}
            >
              <FolderOpen className="h-4 w-4" />
              Open Video
            </button>
          </section>
          <section className="min-w-0 rounded-2xl border border-border bg-background/60 p-5">
            <h2 className="text-lg font-semibold">Connect a provider</h2>
            <p className="mt-2 mb-5 text-sm leading-6 text-muted-foreground">
              Connect Plex or Jellyfin, then play a video there to find it in
              Cliparr and create a clip.
            </p>
            <ProviderConnectFlow variant="screen" onConnected={onConnected} />
          </section>
        </div>
      </div>
    </div>
  );
}
