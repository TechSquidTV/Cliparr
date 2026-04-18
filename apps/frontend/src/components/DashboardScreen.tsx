import { useEffect, useState } from "react";
import { AlertTriangle, LogOut, Play, RefreshCw, Settings2, Video } from "lucide-react";
import { cliparrClient } from "../api/cliparrClient";
import { formatProviderName, ProviderGlyph } from "./ProviderGlyph";
import type { CurrentlyPlayingItem, SourcePlaybackError, ViewerPlaybackGroup } from "../providers/types";

interface Props {
  onSelectSession: (session: CurrentlyPlayingItem) => void;
  onOpenSources: () => void;
  onLogout: () => Promise<void> | void;
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function looksLikeGeneratedSourceName(value: string) {
  return /^[a-f0-9]{12,64}$/i.test(value.trim());
}

function formatSourceLabel(source: { name: string; providerId: string }) {
  if (!looksLikeGeneratedSourceName(source.name)) {
    return source.name;
  }

  return formatProviderName(source.providerId);
}

function ViewerAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const label = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center overflow-hidden text-lg font-semibold">
      {avatarUrl && !imageFailed ? (
        <img
          src={avatarUrl}
          alt={name}
          className="w-full h-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        label
      )}
    </div>
  );
}

function WarningBanner({ sourceErrors }: { sourceErrors: SourcePlaybackError[] }) {
  if (sourceErrors.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-[color-mix(in_oklch,var(--destructive)_24%,transparent)] bg-[color-mix(in_oklch,var(--destructive)_12%,var(--background))] p-4 text-[color-mix(in_oklch,var(--destructive)_72%,var(--foreground))]">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="space-y-2 text-sm">
          <p className="font-medium">Some sources could not be reached. Showing results from the sources that responded.</p>
          <div className="space-y-1">
            {sourceErrors.map((sourceError) => (
              <p key={sourceError.sourceId}>
                <span className="font-medium">
                  {formatSourceLabel({
                    name: sourceError.sourceName,
                    providerId: sourceError.providerId,
                  })}
                </span>: {sourceError.message}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardScreen({ onSelectSession, onOpenSources, onLogout }: Props) {
  const [viewers, setViewers] = useState<ViewerPlaybackGroup[]>([]);
  const [sourceErrors, setSourceErrors] = useState<SourcePlaybackError[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchSessions = async () => {
    setLoading(true);
    setError("");
    try {
      const playback = await cliparrClient.getCurrentlyPlaying();
      setViewers(playback.viewers);
      setSourceErrors(playback.sourceErrors);
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to fetch sessions"));
      setViewers([]);
      setSourceErrors([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchSessions();
  }, []);

  const hasPlayback = viewers.length > 0;
  const emptyMessage = sourceErrors.length > 0
    ? "No active playback was found on the sources that responded."
    : "No one is currently watching anything.";

  return (
    <div className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-10 flex flex-col gap-5 sm:mb-12 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-light.svg" alt="Cliparr Logo" className="w-8 h-8" />
            <h1 className="text-2xl font-bold tracking-tight">Cliparr</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:justify-end">
            <button
              type="button"
              onClick={onOpenSources}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Settings2 className="w-4 h-4" />
              Sources
            </button>
            <button
              type="button"
              onClick={fetchSessions}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin text-primary" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Disconnect
            </button>
          </div>
        </header>

        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-2">Currently Playing</h2>
            <p className="text-muted-foreground text-sm">
              See what everyone is watching across your enabled sources.
            </p>
          </div>

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-xl text-sm">
              {error}
            </div>
          )}

          {!error && <WarningBanner sourceErrors={sourceErrors} />}

          {!loading && !hasPlayback && !error && (
            <div className="bg-card text-card-foreground border border-border rounded-2xl p-12 text-center">
              <div className="bg-background w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Play className="w-6 h-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium mb-2">Nothing is playing right now</h3>
              <p className="text-muted-foreground text-sm max-w-sm mx-auto">
                {emptyMessage}
              </p>
            </div>
          )}

          <div className="space-y-8">
            {viewers.map((viewerGroup) => (
              <section key={viewerGroup.viewer.id} className="space-y-4">
                <div className="flex items-center gap-4">
                  <ViewerAvatar
                    name={viewerGroup.viewer.name}
                    avatarUrl={viewerGroup.viewer.avatarUrl}
                  />
                  <div>
                    <h3 className="text-lg font-semibold">{viewerGroup.viewer.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {viewerGroup.items.length} active {viewerGroup.items.length === 1 ? "session" : "sessions"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {viewerGroup.items.map((mediaSession) => {
                    const canEdit = Boolean(mediaSession.mediaUrl);
                    return (
                      <button
                        key={mediaSession.id}
                        onClick={() => {
                          if (canEdit) {
                            onSelectSession(mediaSession);
                          }
                        }}
                        disabled={!canEdit}
                        className="group relative bg-card text-card-foreground border border-border rounded-lg overflow-hidden hover:border-primary/50 transition-all text-left flex flex-col disabled:opacity-60 disabled:hover:border-border disabled:cursor-not-allowed"
                      >
                        <div className="aspect-video w-full bg-background relative">
                          {mediaSession.thumbUrl ? (
                            <img
                              src={mediaSession.thumbUrl}
                              alt={mediaSession.title}
                              className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Video className="w-8 h-8 text-muted-foreground/50" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-linear-to-t from-card/95 via-card/20 to-transparent" />
                          <div className="absolute top-3 left-3">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-card/90 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground shadow-sm backdrop-blur-sm">
                              <ProviderGlyph
                                providerId={mediaSession.source.providerId}
                                providerName={formatSourceLabel(mediaSession.source)}
                                className="h-3.5 w-3.5"
                              />
                              {formatSourceLabel(mediaSession.source)}
                            </span>
                          </div>
                          <div className="absolute bottom-3 left-3 right-3">
                            <div className="text-xs font-medium text-primary mb-1">{mediaSession.type.toUpperCase()}</div>
                            <h4 className="font-semibold truncate">{mediaSession.title}</h4>
                          </div>
                        </div>
                        <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                          <div className="space-y-2 text-sm text-muted-foreground">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate">{mediaSession.playerTitle}</span>
                              <span className="shrink-0 capitalize">{mediaSession.playerState}</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-center w-full py-2 bg-primary/10 text-primary rounded-lg text-sm font-medium group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                            {canEdit ? "Edit Clip" : "No direct media file"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
