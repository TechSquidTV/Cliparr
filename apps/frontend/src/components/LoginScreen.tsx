import { useEffect, useState } from "react";
import { ExternalLink, Video } from "lucide-react";
import { cliparrClient } from "../api/cliparrClient";
import type { ProviderDefinition, ProviderSession } from "../providers/types";

interface Props {
  onLogin: (session: ProviderSession) => void;
}

export default function LoginScreen({ onLogin }: Props) {
  const [providers, setProviders] = useState<ProviderDefinition[]>([]);
  const [authId, setAuthId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [loading, setLoading] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadProviders() {
      try {
        const data = await cliparrClient.listProviders();
        if (!cancelled) {
          setProviders(data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Failed to load providers");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadProviders();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authId || !providerId) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      try {
        const status = await cliparrClient.pollAuth(providerId, authId);
        if (status.status === "complete") {
          window.clearInterval(intervalId);
          onLogin(await cliparrClient.getSession());
          return;
        }

        if (status.status === "expired") {
          window.clearInterval(intervalId);
          setAuthenticating(false);
          setAuthId("");
          setError("That Plex sign-in expired. Start again when you're ready.");
        }
      } catch (err: any) {
        window.clearInterval(intervalId);
        setAuthenticating(false);
        setError(err.message || "Failed to finish Plex sign-in");
      }
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authId, providerId, onLogin]);

  const startAuth = async (provider: ProviderDefinition) => {
    setError("");
    setAuthenticating(true);
    try {
      const auth = await cliparrClient.startAuth(provider.id);
      setAuthId(auth.authId);
      setProviderId(provider.id);
      window.open(auth.authUrl, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      setAuthenticating(false);
      setError(err.message || "Failed to start Plex sign-in");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="bg-card text-card-foreground border border-border p-8 rounded-lg w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-center mb-8">
          <div className="bg-primary/10 p-3 rounded-full">
            <Video className="w-8 h-8 text-primary" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-center mb-2">Welcome to Cliparr</h1>
        <p className="text-muted-foreground text-center mb-8 text-sm">Sign in with a media provider to export clips.</p>

        {error && (
          <div className="mb-4 bg-destructive/10 border border-destructive/20 text-destructive p-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {loading ? (
            <div className="text-center text-sm text-muted-foreground">Loading providers...</div>
          ) : (
            providers.map((provider) => (
              <button
                key={provider.id}
                onClick={() => startAuth(provider)}
                disabled={authenticating}
                className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed text-primary-foreground font-medium py-2.5 rounded-lg transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                {authenticating && providerId === provider.id ? "Waiting for Plex..." : `Continue with ${provider.name}`}
              </button>
            ))
          )}
        </div>

        {authenticating && (
          <p className="text-xs text-muted-foreground mt-4 text-center">
            Finish sign-in in the Plex tab. This tab will continue automatically.
          </p>
        )}
      </div>
    </div>
  );
}
