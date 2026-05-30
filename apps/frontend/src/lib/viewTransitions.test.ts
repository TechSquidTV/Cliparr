/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import type { EditorSession } from "@/lib/editorMedia";
import {
  clearPendingEditorTransitionSession,
  EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME,
  getPendingEditorTransitionSession,
  setPendingEditorTransitionSession,
} from "@/lib/viewTransitions";

function buildEditorSession(id: string): EditorSession {
  return {
    id,
    source: {
      id: "source-1",
      name: "Plex",
      providerId: "plex",
    },
    title: "The End of All Things",
    type: "movie",
    duration: 120,
    playerTitle: "Living Room",
    playerState: "playing",
    thumbUrl: "/api/media/thumb.jpg",
    local: false,
  };
}

void test("uses a stable editor thumbnail view transition name", () => {
  assert.equal(
    EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME,
    "cliparr-editor-thumbnail",
  );
});

void test("stores the pending editor session for transition paint", () => {
  const session = buildEditorSession("session-1");

  setPendingEditorTransitionSession(session);

  assert.equal(getPendingEditorTransitionSession("session-1"), session);
  assert.equal(getPendingEditorTransitionSession("session-2"), null);

  clearPendingEditorTransitionSession("session-1");
  assert.equal(getPendingEditorTransitionSession("session-1"), null);
});
