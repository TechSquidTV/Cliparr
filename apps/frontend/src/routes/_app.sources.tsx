import { createFileRoute } from "@tanstack/react-router";
import SourcesModal from "../components/SourcesModal";
import { router } from "../router";

function SourcesRouteComponent() {
  return (
    <SourcesModal
      isOpen
      onClose={() => {
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
