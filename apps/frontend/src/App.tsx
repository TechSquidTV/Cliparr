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
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        Loading Cliparr...
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
