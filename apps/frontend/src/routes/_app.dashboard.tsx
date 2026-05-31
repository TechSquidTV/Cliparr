import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useAuth } from "@/auth";
import DashboardScreen from "@/components/DashboardScreen";
import { LocalVideoOpenDialog } from "@/components/local-media/LocalVideoOpenDialog";
import { editorSessionFromCurrentlyPlaying } from "@/lib/editorMedia";
import {
  runViewTransition,
  setPendingEditorTransitionSession,
} from "@/lib/viewTransitions";
import { router } from "@/router";

function DashboardRouteComponent() {
  const auth = useAuth();
  const [localVideoOpen, setLocalVideoOpen] = useState(false);
  const [transitionSessionId, setTransitionSessionId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("openVideo") !== "1") {
      return;
    }

    setLocalVideoOpen(true);
    params.delete("openVideo");

    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${
      nextSearch ? `?${nextSearch}` : ""
    }${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, []);

  return (
    <>
      <DashboardScreen
        activeViewTransitionSessionId={transitionSessionId}
        onSelectSession={(session) => {
          flushSync(() => {
            setTransitionSessionId(session.id);
            setPendingEditorTransitionSession(
              editorSessionFromCurrentlyPlaying(session),
            );
          });

          void runViewTransition(() =>
            router.navigate({
              to: "/edit/$sessionId",
              params: {
                sessionId: session.id,
              },
            }),
          );
        }}
        onOpenLocalVideo={() => setLocalVideoOpen(true)}
        onOpenSources={() => {
          void router.navigate({ to: "/sources" });
        }}
        onLogout={auth.logout}
      />
      <LocalVideoOpenDialog
        isOpen={localVideoOpen}
        onClose={() => setLocalVideoOpen(false)}
        onOpened={(sessionId) => {
          void router.navigate({
            to: "/local/edit/$sessionId",
            params: { sessionId },
          });
        }}
      />
    </>
  );
}

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardRouteComponent,
});
