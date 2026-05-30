import { createFileRoute, useCanGoBack } from "@tanstack/react-router";
import SourcesDialog from "@/components/sources/SourcesDialog";
import { router } from "@/router";

function SourcesRouteComponent() {
  const canGoBack = useCanGoBack();

  return (
    <SourcesDialog
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
