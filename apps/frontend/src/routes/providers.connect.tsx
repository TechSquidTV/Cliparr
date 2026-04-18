import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAuth } from "../auth";
import ProviderConnectScreen from "../components/ProviderConnectScreen";

function ProviderConnectRouteComponent() {
  const auth = useAuth();

  return <ProviderConnectScreen onConnected={auth.setProviderSession} />;
}

export const Route = createFileRoute("/providers/connect")({
  beforeLoad: ({ context }): ReturnType<typeof redirect> | void => {
    if (context.auth.providerSession) {
      return redirect({
        to: "/dashboard",
        replace: true,
      });
    }
  },
  component: ProviderConnectRouteComponent,
});
