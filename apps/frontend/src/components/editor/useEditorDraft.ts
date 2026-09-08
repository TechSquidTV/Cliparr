import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fromSeconds, type TimelineEngine } from "@techsquidtv/canvas-timeline";
import type { EditorSession } from "@/lib/editorMedia";
import {
  editorDraftIdentity,
  editorDrafts,
  type EditorDraft,
} from "@/components/editor/editorDrafts";
import {
  EDITOR_SUBTITLE_TRACK_ID,
  synchronizeEditorTimelineSubtitles,
} from "@/components/editor/editorTimelineEngine";

interface Properties {
  engine: TimelineEngine;
  session: EditorSession;
  initialDraft: EditorDraft | null;
  ready: boolean;
  duration: number;
  startTime: number;
  endTime: number;
  subtitles: EditorDraft["subtitles"];
  onReset: () => void;
}

export function useEditorDraft({
  engine,
  session,
  initialDraft,
  ready,
  duration,
  startTime,
  endTime,
  subtitles,
  onReset,
}: Properties) {
  const restored = useRef(false);
  const discarded = useRef(false);
  const latest = useRef<EditorDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restorationComplete, setRestorationComplete] = useState(false);

  useLayoutEffect(() => {
    if (!ready || restored.current) {
      return;
    }
    restored.current = true;
    if (initialDraft) {
      synchronizeEditorTimelineSubtitles(engine, {
        cues: initialDraft.subtitles.cues,
      });
      engine.toggleTrackVisibility(
        EDITOR_SUBTITLE_TRACK_ID,
        initialDraft.subtitles.visible,
      );
      if (
        initialDraft.startTime < duration &&
        initialDraft.endTime <= duration + 0.5
      ) {
        engine.setInOutRange(
          fromSeconds(initialDraft.startTime),
          fromSeconds(Math.min(initialDraft.endTime, duration)),
        );
        engine.setTime(fromSeconds(initialDraft.startTime));
        setNotice("Draft restored on this device.");
      } else {
        setNotice(
          "Saved range is outside this video. Kept subtitle edits and started a new range.",
        );
      }
    }
    setRestorationComplete(true);
  }, [duration, engine, initialDraft, ready]);

  const selectedTrackKey = subtitles.selectedTrackKey;
  const importedTrackKey = subtitles.importedTrackKey;
  const enabled = subtitles.enabled;
  const visible = subtitles.visible;
  const cues = subtitles.cues;
  useEffect(() => {
    if (!ready || !restorationComplete || discarded.current) {
      return;
    }
    const draft: EditorDraft = {
      version: 1,
      identity: editorDraftIdentity(session),
      sessionId: session.id,
      updatedAt: Date.now(),
      duration,
      startTime,
      endTime,
      subtitles: { selectedTrackKey, importedTrackKey, enabled, visible, cues },
    };
    latest.current = draft;
    const timeout = setTimeout(() => {
      if (!editorDrafts.save(draft)) {
        setNotice(
          "Draft kept in this tab. Browser storage is unavailable or full; reopening the page may lose edits.",
        );
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [
    cues,
    duration,
    enabled,
    endTime,
    importedTrackKey,
    ready,
    restorationComplete,
    selectedTrackKey,
    session,
    startTime,
    visible,
  ]);

  useEffect(() => {
    const flush = () => {
      if (!discarded.current && latest.current) {
        editorDrafts.save(latest.current);
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  return {
    notice,
    reset: () => {
      discarded.current = true;
      editorDrafts.remove(session);
      onReset();
    },
  };
}
