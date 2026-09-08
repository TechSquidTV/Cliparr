import { useEffect, useState, useSyncExternalStore } from "react";
import type { TimelineEngine } from "@techsquidtv/canvas-timeline";
import { createEditorHistory } from "@/components/editor/editorHistory";

const emptyHistory = { canUndo: false, canRedo: false };
const getEmptyHistory = () => emptyHistory;
const unsubscribeEmptyHistory = () => {};
const subscribeEmptyHistory = () => unsubscribeEmptyHistory;

export function useEditorHistory(engine: TimelineEngine, ready: boolean) {
  const [history, setHistory] = useState<ReturnType<
    typeof createEditorHistory
  > | null>(null);
  useEffect(() => {
    if (!ready) {
      setHistory(null);
      return;
    }
    const next = createEditorHistory(engine);
    setHistory(next);
    window.addEventListener("pointerdown", next.beginRangeGesture, {
      capture: true,
    });
    window.addEventListener("pointerup", next.endRangeGesture, {
      capture: true,
    });
    window.addEventListener("pointercancel", next.endRangeGesture, {
      capture: true,
    });
    window.addEventListener("blur", next.endRangeGesture);
    return () => {
      next.dispose();
      window.removeEventListener("pointerdown", next.beginRangeGesture, true);
      window.removeEventListener("pointerup", next.endRangeGesture, true);
      window.removeEventListener("pointercancel", next.endRangeGesture, true);
      window.removeEventListener("blur", next.endRangeGesture);
    };
  }, [engine, ready]);
  const state = useSyncExternalStore(
    history?.subscribe ?? subscribeEmptyHistory,
    history?.getSnapshot ?? getEmptyHistory,
    getEmptyHistory,
  );
  return {
    canUndo: ready && state.canUndo,
    canRedo: ready && state.canRedo,
    undo: () => {
      if (ready) {
        history?.undo();
      }
    },
    redo: () => {
      if (ready) {
        history?.redo();
      }
    },
  };
}
