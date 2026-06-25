import {
  subtitleCueIdFromActionId,
  type SubtitleTimelineTrack,
  type SubtitleTimelineCue,
} from "@/components/editor/subtitleTimeline";

export type EditorTimelineSelection =
  | { kind: "clip" }
  | { kind: "subtitle-cue"; cueId: string };

export function defaultEditorTimelineSelection(): EditorTimelineSelection {
  return { kind: "clip" };
}

export function editorTimelineSelectionsEqual(
  left: EditorTimelineSelection,
  right: EditorTimelineSelection,
) {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "clip") {
    return true;
  }

  return right.kind === "subtitle-cue" && left.cueId === right.cueId;
}

export function editorTimelineSelectionForActionId(
  actionId: string,
): EditorTimelineSelection | null {
  if (actionId === "selected-clip") {
    return { kind: "clip" };
  }

  const cueId = subtitleCueIdFromActionId(actionId);
  return cueId ? { kind: "subtitle-cue", cueId } : null;
}

export function resolveSelectedSubtitleCue(
  track: SubtitleTimelineTrack | null | undefined,
  selection: EditorTimelineSelection,
): SubtitleTimelineCue | null {
  if (selection.kind !== "subtitle-cue") {
    return null;
  }

  return track?.cues.find((cue) => cue.id === selection.cueId) ?? null;
}

export function normalizeEditorTimelineSelection({
  selection,
  subtitleTimelineTrack,
}: {
  selection: EditorTimelineSelection;
  subtitleTimelineTrack: SubtitleTimelineTrack | null | undefined;
}): EditorTimelineSelection {
  if (selection.kind === "clip") {
    return selection;
  }

  return resolveSelectedSubtitleCue(subtitleTimelineTrack, selection)
    ? selection
    : defaultEditorTimelineSelection();
}
