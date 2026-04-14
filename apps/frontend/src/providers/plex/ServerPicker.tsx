import { useEffect, useState } from "react";
import { Server, Wifi, WifiOff } from "lucide-react";
import { cliparrClient } from "../../api/cliparrClient";
import type { ProviderResource, ProviderSession } from "../types";

interface Props {
  providerId: string;
  onSelected: (session: ProviderSession) => void;
  onLogout: () => void;
}

export default function ServerPicker({ providerId, onSelected, onLogout }: Props) {
  const [resources, setResources] = useState<ProviderResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadResources() {
      setLoading(true);
      setError("");
      try {
        const data = await cliparrClient.listResources(providerId);
        if (!cancelled) {
          setResources(data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Failed to load Plex servers");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadResources();
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  const selectConnection = async (resourceId: string, connectionId: string) => {
    setSelecting(connectionId);
    setError("");
    try {
      onSelected(await cliparrClient.selectResource(providerId, resourceId, connectionId));
    } catch (err: any) {
      setError(err.message || "Cliparr could not reach that Plex server");
    } finally {
      setSelecting("");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg">
              <Server className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Choose a Plex server</h1>
              <p className="text-muted-foreground text-sm">
                Pick a connection. If it fails, Cliparr will try the other discovered URLs for that server.
              </p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
          >
            Sign out
          </button>
        </header>

        {error && (
          <div className="mb-6 bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-xl text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="bg-card border border-border rounded-lg p-8 text-muted-foreground">
            Loading Plex servers...
          </div>
        ) : (
          <div className="space-y-4">
            {resources.map((resource) => (
              <div key={resource.id} className="bg-card text-card-foreground border border-border rounded-lg p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-semibold text-lg">{resource.name}</h2>
                    <p className="text-sm text-muted-foreground">{resource.product || "Plex Media Server"}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{resource.platform || "Unknown platform"}</span>
                </div>

                <div className="grid gap-3">
                  {resource.connections.map((connection) => (
                    <button
                      key={connection.id}
                      onClick={() => selectConnection(resource.id, connection.id)}
                      disabled={Boolean(selecting)}
                      className="flex items-center justify-between text-left bg-background hover:bg-accent border border-border hover:border-primary/50 rounded-lg p-4 transition-colors disabled:opacity-60"
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        {connection.relay ? (
                          <WifiOff className="w-5 h-5 text-muted-foreground shrink-0" />
                        ) : (
                          <Wifi className="w-5 h-5 text-primary shrink-0" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{connection.uri}</span>
                          <span className="text-xs text-muted-foreground">
                            {connection.local ? "Local" : "Remote"} {connection.relay ? "relay" : "direct"}
                          </span>
                        </span>
                      </span>
                      <span className="text-sm text-primary">
                        {selecting === connection.id ? "Checking all routes..." : "Use this"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
