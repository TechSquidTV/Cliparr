import { createFileRoute } from "@tanstack/react-router";

import SourcesDialog from "@/components/sources/SourcesDialog";
import { useBackNavigation } from "@/lib/useBackNavigation";

function SourcesRouteComponent() {
  const navigateBack = useBackNavigation("/dashboard");

  return <SourcesDialog isOpen onClose={navigateBack} />;
}

export const Route = createFileRoute("/_app/sources")({
  component: SourcesRouteComponent,
});
