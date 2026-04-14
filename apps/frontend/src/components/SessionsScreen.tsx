import { useEffect, useState } from "react";
import { LogOut, RefreshCw, Play, Video } from "lucide-react";
import { cliparrClient } from "../api/cliparrClient";
import type { MediaSession, ProviderSession } from "../providers/types";

interface Props {
  session: ProviderSession;
  onSelectSession: (session: MediaSession) => void;
  onLogout: () => void;
}

export default function SessionsScreen({ session, onSelectSession, onLogout }: Props) {
  const [sessions, setSessions] = useState<MediaSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchSessions = async () => {
    setLoading(true);
    setError("");
    try {
      setSessions(await cliparrClient.listMediaSessions());
    } catch (err: any) {
      setError(err.message || "Failed to fetch sessions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg">
              <Video className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Cliparr</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={fetchSessions}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin text-primary" : ""}`} />
            </button>
            <button
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
              {session.selectedResource?.name || "Selected server"} is ready. Select an active playback session.
            </p>
          </div>

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-xl text-sm">
              {error}
            </div>
          )}

          {!loading && sessions.length === 0 && !error && (
            <div className="bg-card text-card-foreground border border-border rounded-2xl p-12 text-center">
              <div className="bg-background w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Play className="w-6 h-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium mb-2">No active sessions</h3>
              <p className="text-muted-foreground text-sm max-w-sm mx-auto">
                Start playing a video on your Plex server, then refresh this page to see it here.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sessions.map((mediaSession) => {
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
                      <img src={mediaSession.thumbUrl} alt={mediaSession.title} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Video className="w-8 h-8 text-muted-foreground/50" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-card/90 via-card/10 to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3">
                      <div className="text-xs font-medium text-primary mb-1">{mediaSession.type.toUpperCase()}</div>
                      <h3 className="font-semibold truncate">{mediaSession.title}</h3>
                    </div>
                  </div>
                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-sm text-muted-foreground mb-4">
                      <span className="truncate mr-2">{mediaSession.userTitle}</span>
                      <span className="shrink-0">{mediaSession.playerTitle}</span>
                    </div>
                    <div className="flex items-center justify-center w-full py-2 bg-primary/10 text-primary rounded-lg text-sm font-medium group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      {canEdit ? "Edit Clip" : "No direct media file"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
