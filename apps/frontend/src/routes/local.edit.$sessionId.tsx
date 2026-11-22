import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { useAuth } from "#/auth";
import { LocalEditorSessionView } from "#/components/local-media/LocalEditorSessionView";
import { LocalVideoOpenDialog } from "#/components/local-media/LocalVideoOpenDialog";
import { resolveProxiedMediaUrl } from "#/lib/proxiedMediaSource";
import { useBackNavigation } from "#/lib/useBackNavigation";
import { router } from "#/router";
function LocalEditorRouteComponent() {
  const auth = useAuth();
  const { sessionId } = Route.useParams();
  const [openDialog, setOpenDialog] = useState(false);
  const onBack = useBackNavigation("/");
  return (
    <>
      <LocalEditorSessionView
        key={sessionId}
        sessionId={sessionId}
        onBack={onBack}
        onReopen={() => setOpenDialog(true)}
        resolveUrl={resolveProxiedMediaUrl}
      />
      <LocalVideoOpenDialog
        canOpenUrl={Boolean(auth.providerSession)}
        isOpen={openDialog}
        onClose={() => setOpenDialog(false)}
        onOpened={(nextSessionId) => {
          void router.navigate({
            to: "/local/edit/$sessionId",
            params: { sessionId: nextSessionId },
            replace: true,
          });
        }}
      />
    </>
  );
}

export const Route = createFileRoute("/local/edit/$sessionId")({
  component: LocalEditorRouteComponent,
});
