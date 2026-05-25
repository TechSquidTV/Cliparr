import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "../auth";
import DashboardScreen from "../components/DashboardScreen";
import { LocalVideoOpenModal } from "../components/LocalVideoOpenModal";
import { router } from "../router";

function DashboardRouteComponent() {
  const auth = useAuth();
  const [localVideoOpen, setLocalVideoOpen] = useState(false);

  return (
    <>
      <DashboardScreen
        onSelectSession={(session) => {
          void router.navigate({
            to: "/edit/$sessionId",
            params: {
              sessionId: session.id,
            },
          });
        }}
        onOpenLocalVideo={() => setLocalVideoOpen(true)}
        onOpenSources={() => {
          void router.navigate({ to: "/sources" });
        }}
        onLogout={auth.logout}
      />
      <LocalVideoOpenModal
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
