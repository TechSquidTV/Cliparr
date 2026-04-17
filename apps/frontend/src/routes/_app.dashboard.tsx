import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "../auth";
import DashboardScreen from "../components/DashboardScreen";
import { router } from "../router";

function DashboardRouteComponent() {
  const auth = useAuth();

  return (
    <DashboardScreen
      onSelectSession={(session) => {
        void router.navigate({
          to: "/edit/$sessionId",
          params: {
            sessionId: session.id,
          },
        });
      }}
      onOpenSources={() => {
        void router.navigate({ to: "/sources" });
      }}
      onLogout={auth.logout}
    />
  );
}

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardRouteComponent,
});
