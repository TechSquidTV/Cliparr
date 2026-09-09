import {
  TimelineEngine,
  fromSeconds,
  toSeconds,
  type Clip,
  type Track,
  type TimelineReadonly,
  type TimelineEditCommand,
} from "@techsquidtv/canvas-timeline";
import { buildInitialClipRange } from "@/components/editor/initialClipRange";
import { EDITOR_MAX_ZOOM_SCALE } from "@/components/editor/editorTimelineZoom";
import type { EditorSession } from "@/lib/editorMedia";
import { normalizeSubtitleCueText } from "@/lib/subtitles/normalizeSubtitleCueText";
import type { SubtitleCue } from "@/lib/subtitles/types";

type EditorTimelineTrackKind = "media" | "subtitle";

export const EDITOR_MEDIA_SOURCE_ID = "editor-media-source";
export const EDITOR_MEDIA_TRACK_ID = "editor-media-track";
export const EDITOR_MEDIA_CLIP_ID = "editor-media-clip";
export const EDITOR_SUBTITLE_TRACK_ID = "editor-subtitle-track";
export const EDITOR_MEDIA_TRACK_NAME = "Source";
export const EDITOR_SUBTITLE_TRACK_NAME = "Sub 1";
const EDITOR_SUBTITLE_SOURCE_ID = "editor-subtitle-source";

const MINIMUM_MEDIA_DURATION_SECONDS = 0.01;
const DEFAULT_TIMELINE_ZOOM_SCALE = 74;

interface CenteredTimelineScrollOptions {
  maxScrollLeft: number;
  timeSeconds: number;
  viewportWidth: number;
  zoomScale: number;
}

export function timelineScrollLeftForCenteredTime({
  maxScrollLeft,
  timeSeconds,
  viewportWidth,
  zoomScale,
}: CenteredTimelineScrollOptions) {
  const centeredScrollLeft = timeSeconds * zoomScale - viewportWidth / 2;
  return Math.min(maxScrollLeft, Math.max(0, centeredScrollLeft));
}

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
      name: EDITOR_MEDIA_TRACK_NAME,
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
    createSubtitleTrack([], safeMediaDuration(duration)),
  ];
}

function createSubtitleTrack(
  cues: readonly SubtitleCue[],
  duration: number,
): Track<EditorTimelineTrackKind> {
  const clips = cues.flatMap<Clip>((cue, index) => {
    const startTime = Math.max(0, cue.startTime);
    const endTime = Math.min(duration, cue.endTime);
    if (
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      endTime <= startTime
    ) {
      return [];
    }

    return [
      {
        id: `editor-subtitle-cue-${index}`,
        sourceId: EDITOR_SUBTITLE_SOURCE_ID,
        timelineStart: fromSeconds(startTime),
        timelineEnd: fromSeconds(endTime),
        sourceStart: fromSeconds(startTime),
        minStart: fromSeconds(0),
        maxEnd: fromSeconds(duration),
        selected: false,
        movable: true,
        resizable: true,
        snap: false,
        label: cue.text,
        metadata: {
          ...(cue.id ? { cueId: cue.id } : {}),
        },
      },
    ];
  });

  return {
    id: EDITOR_SUBTITLE_TRACK_ID,
    kind: "subtitle",
    name: EDITOR_SUBTITLE_TRACK_NAME,
    locked: false,
    muted: false,
    visible: true,
    selected: false,
    targeted: false,
    height: 42,
    clips,
  };
}

export function createEditorTimelineEngine(session: EditorSession) {
  const duration = safeMediaDuration(session.duration);
  const initialRange = buildInitialClipRange(
    duration,
    session.initialPlayheadSeconds,
  );
  return new TimelineEngine({
    duration: fromSeconds(duration),
    playheadTime: fromSeconds(initialRange.startTime),
    inPoint: fromSeconds(initialRange.startTime),
    outPoint: fromSeconds(initialRange.endTime),
    zoomScale: DEFAULT_TIMELINE_ZOOM_SCALE,
    zoomConstraints: { maxZoomScale: EDITOR_MAX_ZOOM_SCALE },
    snapEnabled: false,
    tracks: createEditorTracks(duration, session.title),
  });
}

export function synchronizeEditorTimelineSession(
  engine: TimelineEngine,
  previousSession: EditorSession,
  session: EditorSession,
) {
  if (previousSession.id !== session.id) {
    return;
  }

  const mediaClip = engine.geometry.getClip(EDITOR_MEDIA_CLIP_ID)?.clip;
  if (mediaClip?.label !== session.title) {
    engine.updateClipProperties(EDITOR_MEDIA_CLIP_ID, {
      label: session.title,
    });
  }

  if (
    session.duration <= 0 ||
    Math.abs(session.duration - previousSession.duration) <= Number.EPSILON
  ) {
    return;
  }

  synchronizeEditorTimelineMedia(engine, {
    duration: session.duration,
    sourceStart: mediaClip ? toSeconds(mediaClip.sourceStart) : 0,
    initialDuration: previousSession.duration,
    initialPlayheadSeconds: session.initialPlayheadSeconds,
  });
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
  const mediaEntry = engine.geometry.getClip(EDITOR_MEDIA_CLIP_ID);
  const mediaClip = mediaEntry?.clip;

  if (mediaClip) {
    const sourceStartDelta =
      options.sourceStart - toSeconds(mediaClip.sourceStart);
    const commands: TimelineEditCommand[] = [];
    if (Math.abs(sourceStartDelta) > Number.EPSILON) {
      commands.push({
        type: "slip",
        clipId: EDITOR_MEDIA_CLIP_ID,
        deltaTime: fromSeconds(sourceStartDelta),
      });
    }
    if (
      Math.abs(duration - toSeconds(mediaClip.timelineEnd)) > Number.EPSILON
    ) {
      commands.push({
        type: "trim",
        clipId: EDITOR_MEDIA_CLIP_ID,
        edge: "end",
        // eslint-disable-next-line unicorn/no-keyword-prefix -- Canvas Timeline command field.
        newTime: fromSeconds(duration),
        snap: false,
      });
    }
    if (commands.length > 0) {
      // Metadata discovery must update the source clip even though its row is
      // locked against user edits. Restore the lock after the atomic edit.
      const locked = mediaEntry.track.locked;
      if (locked) {
        engine.toggleLockTrack(EDITOR_MEDIA_TRACK_ID, false);
      }
      try {
        const failure = engine
          .commitEdits(commands)
          .find((result) => !result.preview.valid);
        if (failure) {
          throw new Error(
            `Could not synchronize media timeline: ${failure.preview.reason}`,
          );
        }
      } finally {
        if (locked) {
          engine.toggleLockTrack(EDITOR_MEDIA_TRACK_ID, true);
        }
      }
    }
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
    engine.setInOutRange(
      fromSeconds(initialRange.startTime),
      fromSeconds(initialRange.endTime),
    );
    engine.updatePlayhead(fromSeconds(initialRange.startTime));
  }
}

export function synchronizeEditorTimelineSubtitles(
  engine: TimelineEngine,
  options: {
    cues: readonly SubtitleCue[];
  },
) {
  const duration = toSeconds(engine.getState().duration ?? fromSeconds(0));
  engine.removeTrack(EDITOR_SUBTITLE_TRACK_ID);
  engine.addTrack(createSubtitleTrack(options.cues, duration));
}

export function subtitleCuesFromTimeline(
  tracks: readonly TimelineReadonly<Track>[],
): SubtitleCue[] {
  const subtitleTrack = tracks.find(
    (track) => track.id === EDITOR_SUBTITLE_TRACK_ID,
  );
  if (!subtitleTrack) {
    return [];
  }

  return subtitleTrack.clips.flatMap<SubtitleCue>((clip) => {
    const cue = subtitleCueFromTimelineClip(clip);
    return cue ? [cue] : [];
  });
}

export function subtitleCueFromTimelineClip(
  clip: TimelineReadonly<Clip>,
): SubtitleCue | null {
  const normalizedText = normalizeSubtitleCueText(clip.label ?? "");
  if (!normalizedText) {
    return null;
  }

  const cueId = clip.metadata?.cueId;
  return {
    ...(typeof cueId === "string" && cueId ? { id: cueId } : {}),
    startTime: toSeconds(clip.timelineStart),
    endTime: toSeconds(clip.timelineEnd),
    ...normalizedText,
  };
}
