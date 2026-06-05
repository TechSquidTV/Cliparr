import { createFileRoute, useCanGoBack } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { cliparrClient } from "@/api/cliparrClient";
import EditorScreen from "@/components/editor/EditorScreen";
import {
  editorSessionFromCurrentlyPlaying,
  type EditorSession,
} from "@/lib/editorMedia";
import { getPendingEditorTransitionSession } from "@/lib/viewTransitions";
import { router } from "@/router";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function EditorRouteComponent() {
  const { sessionId } = Route.useParams();
  const canGoBack = useCanGoBack();
  const transitionSession = getPendingEditorTransitionSession(sessionId);
  const [session, setSession] = useState<EditorSession | null>(
    () => transitionSession,
  );
  const [loading, setLoading] = useState(() => !transitionSession);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const sessionReference = useRef(session);

  useEffect(() => {
    sessionReference.current = session;
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    const transitionSession = getPendingEditorTransitionSession(sessionId);
    const hasWarmSession =
      Boolean(transitionSession) || sessionReference.current?.id === sessionId;

    if (transitionSession) {
      setSession(transitionSession);
    }

    async function loadSession() {
      if (!hasWarmSession) {
        setLoading(true);
      }
      setError("");

      try {
        const playback = await cliparrClient.getCurrentlyPlaying();
        const activeSession = playback.viewers
          .flatMap((viewer) => viewer.items)
          .find((item) => item.id === sessionId);

        if (!activeSession) {
          if (!cancelled) {
            void router.navigate({
              to: "/dashboard",
              replace: true,
            });
          }
          return;
        }

        if (!cancelled) {
          setSession(editorSessionFromCurrentlyPlaying(activeSession));
        }
      } catch (error_: unknown) {
        if (!cancelled) {
          setSession(null);
          setError(errorMessage(error_, "Could not load this session."));
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
  }, [attempt, sessionId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        Loading editor...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <div className="max-w-md space-y-4 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={() => {
                if (canGoBack) {
                  globalThis.history.back();
                  return;
                }

                void router.navigate({
                  to: "/dashboard",
                  replace: true,
                });
              }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <EditorScreen
      session={session}
      onBack={() => {
        if (canGoBack) {
          globalThis.history.back();
          return;
        }

        void router.navigate({
          to: "/dashboard",
          replace: true,
        });
      }}
    />
  );
}

export const Route = createFileRoute("/_app/edit/$sessionId")({
  component: EditorRouteComponent,
});
