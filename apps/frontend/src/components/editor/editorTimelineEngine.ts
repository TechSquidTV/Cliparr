import {
  TimelineEngine,
  fromSeconds,
  toSeconds,
  type Track,
} from "@techsquidtv/canvas-timeline";
import { buildInitialClipRange } from "@/components/editor/initialClipRange";
import type { EditorSession } from "@/lib/editorMedia";

export type EditorTimelineTrackKind = "media" | "subtitle";

export const EDITOR_MEDIA_SOURCE_ID = "editor-media-source";
export const EDITOR_MEDIA_TRACK_ID = "editor-media-track";
export const EDITOR_MEDIA_CLIP_ID = "editor-media-clip";
export const EDITOR_SUBTITLE_TRACK_ID = "editor-subtitle-track";

const MINIMUM_MEDIA_DURATION_SECONDS = 0.01;
const DEFAULT_TIMELINE_ZOOM_SCALE = 74;

function safeMediaDuration(duration: number) {
  return Math.max(
    Number.isFinite(duration) ? duration : 0,
    MINIMUM_MEDIA_DURATION_SECONDS,
  );
}

function createEditorTracks(
  duration: number,
  contentTitle: string,
): Track<EditorTimelineTrackKind>[] {
  const timelineEnd = fromSeconds(safeMediaDuration(duration));

  return [
    {
      id: EDITOR_MEDIA_TRACK_ID,
      kind: "media",
      name: "Media",
      locked: true,
      muted: false,
      visible: true,
      selected: false,
      targeted: false,
      height: 58,
      clips: [
        {
          id: EDITOR_MEDIA_CLIP_ID,
          sourceId: EDITOR_MEDIA_SOURCE_ID,
          timelineStart: fromSeconds(0),
          timelineEnd,
          sourceStart: fromSeconds(0),
          selected: false,
          movable: false,
          resizable: true,
          label: contentTitle,
        },
      ],
    },
    {
      id: EDITOR_SUBTITLE_TRACK_ID,
      kind: "subtitle",
      name: "Subtitles",
      locked: true,
      muted: false,
      visible: true,
      selected: false,
      targeted: false,
      height: 42,
      clips: [],
    },
  ];
}

export function createEditorTimelineEngine(session: EditorSession) {
  const duration = safeMediaDuration(session.duration);
  const initialRange = buildInitialClipRange(
    duration,
    session.initialPlayheadSeconds,
  );
  const engine = new TimelineEngine({
    duration: fromSeconds(duration),
    playheadTime: fromSeconds(initialRange.startTime),
    zoomScale: DEFAULT_TIMELINE_ZOOM_SCALE,
    snapEnabled: false,
    tracks: createEditorTracks(duration, session.title),
  });

  engine.setInPoint(fromSeconds(initialRange.startTime));
  engine.setOutPoint(fromSeconds(initialRange.endTime));

  return engine;
}

export function synchronizeEditorTimelineMedia(
  engine: TimelineEngine,
  options: {
    duration: number;
    sourceStart: number;
    initialDuration: number;
    initialPlayheadSeconds?: number;
  },
) {
  const duration = safeMediaDuration(options.duration);
  const mediaClip = engine
    .getState()
    .tracks.flatMap((track) => track.clips)
    .find((clip) => clip.id === EDITOR_MEDIA_CLIP_ID);

  if (mediaClip) {
    const sourceStartDelta =
      options.sourceStart - toSeconds(mediaClip.sourceStart);
    if (Math.abs(sourceStartDelta) > Number.EPSILON) {
      engine.slipClip(EDITOR_MEDIA_CLIP_ID, fromSeconds(sourceStartDelta));
    }
    engine.trimClip(EDITOR_MEDIA_CLIP_ID, "end", fromSeconds(duration));
  }

  engine.setDuration(fromSeconds(duration));
  if (options.initialDuration <= 0) {
    engine.setZoomScale(DEFAULT_TIMELINE_ZOOM_SCALE);
  }

  const currentState = engine.getState();
  const currentInPoint = currentState.inPoint
    ? toSeconds(currentState.inPoint)
    : undefined;
  const currentOutPoint = currentState.outPoint
    ? toSeconds(currentState.outPoint)
    : undefined;
  const rangeNeedsDiscovery =
    options.initialDuration <= 0 ||
    (currentInPoint !== undefined &&
      (currentInPoint < 0 || currentInPoint >= duration)) ||
    (currentOutPoint !== undefined &&
      (currentOutPoint <= 0 || currentOutPoint > duration)) ||
    (currentInPoint !== undefined &&
      currentOutPoint !== undefined &&
      currentOutPoint <= currentInPoint);

  if (rangeNeedsDiscovery) {
    const initialRange = buildInitialClipRange(
      duration,
      options.initialPlayheadSeconds,
    );
    engine.setInPoint(fromSeconds(initialRange.startTime));
    engine.setOutPoint(fromSeconds(initialRange.endTime));
    engine.updatePlayhead(fromSeconds(initialRange.startTime));
  }
}
