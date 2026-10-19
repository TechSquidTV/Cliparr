import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { cliparrClient } from "@/api/cliparrClient";
import {
  type EditorSession,
  editorSessionFromCurrentlyPlaying,
} from "@/components/editor/editorMedia";
import EditorScreen from "@/components/editor/EditorScreen";
import { BarsLoader } from "@/components/ui/bars-loader";
import { useBackNavigation } from "@/lib/useBackNavigation";
import { getPendingEditorTransitionSession } from "@/lib/viewTransitions";
import { router } from "@/router";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function EditorRouteComponent() {
  const navigateBack = useBackNavigation("/dashboard");
  const { sessionId } = Route.useParams();
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
      <div className="flex min-h-(--app-viewport-height) items-center justify-center bg-background text-foreground">
        <BarsLoader label="Loading editor…" showLabel />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-(--app-viewport-height) items-center justify-center bg-background px-6 text-foreground">
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
              onClick={navigateBack}
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

  return <EditorScreen session={session} onBack={navigateBack} />;
}

export const Route = createFileRoute("/_app/edit/$sessionId")({
  component: EditorRouteComponent,
});
