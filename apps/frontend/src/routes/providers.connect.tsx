import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "../auth";
import { LocalVideoOpenModal } from "../components/LocalVideoOpenModal";
import ProviderConnectScreen from "../components/ProviderConnectScreen";
import { router } from "../router";

function ProviderConnectRouteComponent() {
  const auth = useAuth();
  const [localVideoOpen, setLocalVideoOpen] = useState(false);

  return (
    <>
      <ProviderConnectScreen
        onConnected={auth.setProviderSession}
        onOpenLocalVideo={() => setLocalVideoOpen(true)}
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
