import { useCallback, useEffect, useRef, useState } from "react";

import {
  editorCropsEqual,
  type EditorCropState,
  EMPTY_EDITOR_CROP,
} from "#/components/editor/editorCropState";
import type { useEditorHistory } from "#/components/editor/useEditorHistory";

export function useEditorCrop(
  initial: EditorCropState | undefined,
  recordApplied: ReturnType<typeof useEditorHistory>["recordApplied"],
) {
  const [state, setState] = useState(initial ?? EMPTY_EDITOR_CROP);
  const current = useRef(state);
  const gestureStart = useRef<EditorCropState | null>(null);
  const restore = useCallback((next: EditorCropState) => {
    current.current = next;
    setState(next);
  }, []);
  const record = useCallback(
    (before: EditorCropState, after: EditorCropState) => {
      if (!editorCropsEqual(before, after)) {
        recordApplied({
          undo: () => restore(before),
          redo: () => restore(after),
        });
      }
    },
    [recordApplied, restore],
  );
  const finishGesture = useCallback(() => {
    const before = gestureStart.current;
    gestureStart.current = null;
    if (before) {
      record(before, current.current);
    }
  }, [record]);
  const beginGesture = useCallback(() => {
    finishGesture();
    gestureStart.current = current.current;
  }, [finishGesture]);
  const update = useCallback(
    (next: EditorCropState) => {
      const before = current.current;
      restore(next);
      if (!gestureStart.current) {
        record(before, next);
      }
    },
    [record, restore],
  );

  useEffect(() => {
    // Keep the last visible region on interruption, as one undoable gesture.
    window.addEventListener("blur", finishGesture);
    return () => {
      window.removeEventListener("blur", finishGesture);
    };
  }, [finishGesture]);

  return { state, update, beginGesture, finishGesture };
}
