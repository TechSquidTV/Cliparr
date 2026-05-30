import type { EditorSession } from "./editorMedia";

export const EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME = "cliparr-editor-thumbnail";

const PENDING_EDITOR_TRANSITION_TTL_MS = 5000;

interface BrowserViewTransition {
  finished: Promise<void>;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (
    updateCallback: () => Promise<void> | void,
  ) => BrowserViewTransition;
};

let pendingEditorTransitionSession: {
  createdAt: number;
  session: EditorSession;
} | null = null;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function setPendingEditorTransitionSession(session: EditorSession) {
  pendingEditorTransitionSession = {
    createdAt: Date.now(),
    session,
  };
}

export function clearPendingEditorTransitionSession(sessionId?: string) {
  if (!sessionId || pendingEditorTransitionSession?.session.id === sessionId) {
    pendingEditorTransitionSession = null;
  }
}

export function getPendingEditorTransitionSession(sessionId: string) {
  const pendingSession = pendingEditorTransitionSession;

  if (
    !pendingSession ||
    Date.now() - pendingSession.createdAt > PENDING_EDITOR_TRANSITION_TTL_MS
  ) {
    pendingEditorTransitionSession = null;
    return null;
  }

  return pendingSession.session.id === sessionId
    ? pendingSession.session
    : null;
}

export async function runViewTransition(
  updateCallback: () => Promise<void> | void,
) {
  const viewTransitionDocument =
    typeof document === "undefined"
      ? null
      : (document as ViewTransitionDocument);

  if (!viewTransitionDocument?.startViewTransition || prefersReducedMotion()) {
    await updateCallback();
    return;
  }

  const transition = viewTransitionDocument.startViewTransition(updateCallback);
  await transition.finished.catch(() => undefined);
}
