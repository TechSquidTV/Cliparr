import { createFileRoute, useCanGoBack } from "@tanstack/react-router";
import SourcesModal from "../components/SourcesModal";
import { router } from "../router";

function SourcesRouteComponent() {
  const canGoBack = useCanGoBack();

  return (
    <SourcesModal
      isOpen
      onClose={() => {
        if (canGoBack) {
          window.history.back();
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

export const Route = createFileRoute("/_app/sources")({
  component: SourcesRouteComponent,
});
