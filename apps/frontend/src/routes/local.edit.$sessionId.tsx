import { createFileRoute, useCanGoBack } from "@tanstack/react-router";
import { FolderOpen, ShieldCheck, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/auth";
import { editorDrafts } from "@/components/editor/editorDrafts";
import EditorScreen from "@/components/editor/EditorScreen";
import { BarsLoader } from "@/components/ui/bars-loader";
import { LocalVideoOpenDialog } from "@/components/local-media/LocalVideoOpenDialog";
import {
  primaryButtonClasses,
  secondaryButtonClasses,
  subtleButtonClasses,
} from "@/components/ui/control-styles";
import {
  resolveLocalMediaSession,
  type LocalMediaResolution,
} from "@/lib/localMediaRegistry";
import { router } from "@/router";

function LocalEditorRouteComponent() {
  const auth = useAuth();
  const { sessionId } = Route.useParams();
  const canGoBack = useCanGoBack();
  const [resolution, setResolution] = useState<LocalMediaResolution | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);

  const navigateHome = useCallback(() => {
    if (canGoBack) {
      globalThis.history.back();
      return;
    }

    void router.navigate({ to: "/", replace: true });
  }, [canGoBack]);

  const loadSession = useCallback(
    async (requestPermission = false) => {
      setLoading(true);
      try {
        setResolution(
          await resolveLocalMediaSession(sessionId, { requestPermission }),
        );
      } finally {
        setLoading(false);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <BarsLoader label="Loading local video…" showLabel />
      </div>
    );
  }

  if (resolution?.status === "ready") {
    return <EditorScreen session={resolution.session} onBack={navigateHome} />;
  }

  const title = resolution?.title ?? "Local video";
  const message = resolution?.message ?? "Could not open this video.";
  const needsPermission = resolution?.status === "permission-needed";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
          {needsPermission ? (
            <ShieldCheck className="h-5 w-5" />
          ) : (
            <TriangleAlert className="h-5 w-5" />
          )}
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          <p className="text-sm leading-6 text-muted-foreground">{message}</p>
          {editorDrafts.hasSession(sessionId) && (
            <p className="text-sm leading-6 text-muted-foreground">
              Your draft is saved on this device. Reopen the same unchanged file
              to restore its clip range and subtitle edits.
            </p>
          )}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {needsPermission && (
            <button
              type="button"
              onClick={() => void loadSession(true)}
              className={primaryButtonClasses}
            >
              <ShieldCheck className="h-4 w-4" />
              Grant Access
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpenDialog(true)}
            className={secondaryButtonClasses}
          >
            <FolderOpen className="h-4 w-4" />
            Open Video
          </button>
          <button
            type="button"
            onClick={navigateHome}
            className={subtleButtonClasses}
          >
            Back
          </button>
        </div>
      </div>

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
    </div>
  );
}

export const Route = createFileRoute("/local/edit/$sessionId")({
  component: LocalEditorRouteComponent,
});
