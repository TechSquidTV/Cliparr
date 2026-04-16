import { lazy, Suspense, useEffect, useState } from "react";
import { cliparrClient } from "./api/cliparrClient";
import LoginScreen from "./components/LoginScreen";
import SessionsScreen from "./components/SessionsScreen";
import type { CurrentlyPlayingItem, ProviderSession } from "./providers/types";

const EditorScreen = lazy(() => import("./components/EditorScreen"));

export default function App() {
  const [providerSession, setProviderSession] = useState<ProviderSession | null>(null);
  const [selectedSession, setSelectedSession] = useState<CurrentlyPlayingItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = async () => {
    await cliparrClient.logout().catch(() => undefined);
    setProviderSession(null);
    setSelectedSession(null);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        Loading Cliparr...
      </div>
    );
  }

  if (!providerSession) {
    return <LoginScreen onLogin={setProviderSession} />;
  }

  if (selectedSession) {
    return (
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
            Loading editor...
          </div>
        }
      >
        <EditorScreen
          session={selectedSession}
          onBack={() => setSelectedSession(null)}
        />
      </Suspense>
    );
  }

  return (
    <SessionsScreen
      onSelectSession={setSelectedSession}
      onLogout={logout}
    />
  );
}
