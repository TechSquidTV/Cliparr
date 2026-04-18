import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { cliparrClient, subscribeToAuthFailure } from "./api/cliparrClient";
import { AuthProvider } from "./auth";
import type { ProviderSession } from "./providers/types";
import { router } from "./router";

const PLEX_AUTH_COMPLETE_PATH = "/auth/plex/complete";

export default function App() {
  const [providerSession, setProviderSession] = useState<ProviderSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const normalizedPath = window.location.pathname.replace(/\/$/, "") || "/";
    if (normalizedPath === PLEX_AUTH_COMPLETE_PATH) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadSession() {
      try {
        const session = await cliparrClient.getSession();
        if (!cancelled) {
          setProviderSession(session);
        }
      } catch {
        if (!cancelled) {
          setProviderSession(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribeToAuthFailure(() => {
      setProviderSession(null);
    });
  }, []);

  useEffect(() => {
    if (loading) {
      return;
    }

    void router.invalidate();
  }, [loading, providerSession]);

  const logout = async () => {
    await cliparrClient.logout().catch(() => undefined);
    setProviderSession(null);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
        <div className="relative">
          <img src="/logo-light.svg" alt="Cliparr Logo" className="h-16 w-16" />
          <div className="absolute -inset-4 animate-pulse rounded-full bg-primary/10 blur-xl" />
        </div>
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-[var(--tracking-caps-2xl)]">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          Loading Cliparr
        </div>
      </div>
    );
  }

  return (
    <AuthProvider
      auth={{
        providerSession,
        setProviderSession,
        logout,
      }}
    >
      <RouterProvider
        router={router}
        context={{
          auth: {
            providerSession,
            setProviderSession,
            logout,
          },
        }}
      />
    </AuthProvider>
  );
}
